"""Importa las fotos de producto a ``data/imagenes`` quedándose SOLO con las que corresponden a un producto del catálogo.

La carpeta de origen (p. ej. ``D:\\images_static``) trae de todo: fotos reales, archivos vacíos (0 bytes), imágenes de
otras aplicaciones y fotos de productos que no existen en el ERP. El nombre del archivo es el código del producto:

1. código de barras (``producto.ean``), también con ceros de más a la izquierda (``0033844006648`` = ``33844006648``);
2. código del ERP completo (``producto_id``, 15 dígitos);
3. código interno corto: los últimos 6 dígitos del código del ERP (``119695.jpeg`` → ``101…0119695``), solo si es único.

Por cada producto se elige una sola imagen (la de coincidencia más fuerte y, a igualdad, la más pesada), se valida, se
convierte a WebP (600 px para ver y 160 px de miniatura) y se guarda como ``<producto_id>.webp``. Se puede volver a
correr: solo procesa lo nuevo o lo que cambió, y borra las imágenes de productos que ya no están en el catálogo.
Nunca modifica ni borra nada de la carpeta de origen.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageOps

log = logging.getLogger("crm.imagenes")

EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}
LADO_GRANDE, CALIDAD_GRANDE = 600, 80
LADO_MINI, CALIDAD_MINI = 160, 75
MANIFIESTO = "manifiesto.json"
_RANGO = {"ean": 0, "ean_sin_ceros": 1, "producto_id": 2, "codigo_corto": 3}


@dataclass
class Resultado:
    archivos_revisados: int = 0
    vacios: int = 0
    sin_producto: int = 0
    productos_con_imagen: int = 0
    nuevas: int = 0
    actualizadas: int = 0
    sin_cambios: int = 0
    descartadas: list[dict] = field(default_factory=list)   # archivos dañados o ilegibles
    borradas: int = 0                                         # imágenes de productos que ya no están en el catálogo
    por_metodo: dict = field(default_factory=dict)
    mb_destino: float = 0.0
    segundos: float = 0.0

    def resumen(self) -> dict:
        d = dict(self.__dict__)
        d["descartadas"] = self.descartadas[:20]
        d["n_descartadas"] = len(self.descartadas)
        return d


def carpetas(base: Path) -> tuple[Path, Path]:
    return base / "productos", base / "productos" / "mini"


class Indice:
    """Busca el producto que corresponde a un código (nombre de archivo sin extensión)."""

    def __init__(self, productos: list[tuple[str, str | None]]):
        self.ids = {pid for pid, _ in productos}
        self.ean: dict[str, set[str]] = defaultdict(set)
        self.ean_nz: dict[str, set[str]] = defaultdict(set)
        self.corto: dict[str, set[str]] = defaultdict(set)
        for pid, ean in productos:
            self.corto[pid[-6:]].add(pid)
            if ean:
                self.ean[ean].add(pid)
                if ean.lstrip("0"):
                    self.ean_nz[ean.lstrip("0")].add(pid)

    def buscar(self, codigo: str) -> tuple[str | None, set[str]]:
        if not codigo.isdigit():
            return None, set()
        if codigo in self.ean:
            return "ean", self.ean[codigo]
        if codigo.lstrip("0") and codigo.lstrip("0") in self.ean_nz:
            return "ean_sin_ceros", self.ean_nz[codigo.lstrip("0")]
        if codigo in self.ids:
            return "producto_id", {codigo}
        if len(codigo) <= 6 and len(self.corto.get(codigo.zfill(6), ())) == 1:
            return "codigo_corto", set(self.corto[codigo.zfill(6)])
        return None, set()


def codigo_de(nombre: str) -> str:
    """``7702057072193.JPEG`` → ``7702057072193``; ``.7702113043204.jpeg.JJC9P3`` (temporal de descarga) → ``''``."""
    if nombre.startswith("."):
        return ""
    return nombre.split(".", 1)[0].strip()


def elegir(origen: Path, indice: Indice, res: Resultado) -> dict[str, dict]:
    """Recorre la carpeta y devuelve {producto_id: archivo elegido}. No abre las imágenes (eso viene después)."""
    mejor: dict[str, dict] = {}
    for dp, _, archivos in os.walk(origen):
        for f in archivos:
            p = Path(dp) / f
            if p.suffix.lower() not in EXTENSIONES:
                continue
            res.archivos_revisados += 1
            st = p.stat()
            if st.st_size == 0:
                res.vacios += 1
                continue
            metodo, pids = indice.buscar(codigo_de(f))
            if not metodo:
                res.sin_producto += 1
                continue
            cand = {"ruta": str(p), "bytes": st.st_size, "mtime": int(st.st_mtime), "metodo": metodo, "codigo": codigo_de(f)}
            for pid in pids:
                actual = mejor.get(pid)
                if actual is None or (_RANGO[metodo], -st.st_size) < (_RANGO[actual["metodo"]], -actual["bytes"]):
                    mejor[pid] = cand
    return mejor


def _guardar(im: Image.Image, lado: int, calidad: int, destino: Path) -> None:
    copia = im.copy()
    copia.thumbnail((lado, lado), Image.Resampling.LANCZOS)
    tmp = destino.with_suffix(".tmp")
    copia.save(tmp, "WEBP", quality=calidad, method=4)
    os.replace(tmp, destino)   # atómico: nunca queda una imagen a medio escribir


def convertir(origen, grande: Path, mini: Path) -> None:
    with Image.open(origen) as im:
        im.load()
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            fondo = Image.new("RGB", im.size, "white")
            fondo.paste(im, mask=im.split()[-1])
            im = fondo
        elif im.mode != "RGB":
            im = im.convert("RGB")
        _guardar(im, LADO_GRANDE, CALIDAD_GRANDE, grande)
        _guardar(im, LADO_MINI, CALIDAD_MINI, mini)


def leer_manifiesto(base: Path) -> dict:
    try:
        return json.loads((base / MANIFIESTO).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": 0, "productos": {}}


def importar(origen: Path, base: Path, productos: list[tuple[str, str | None]], hilos: int | None = None) -> Resultado:
    """``productos`` = [(producto_id, ean)] del catálogo. ``base`` = ``data/imagenes``."""
    t0 = time.time()
    origen = Path(origen)
    if not origen.is_dir():
        raise FileNotFoundError(f"No existe la carpeta de origen: {origen}")
    res = Resultado()
    grande_dir, mini_dir = carpetas(base)
    mini_dir.mkdir(parents=True, exist_ok=True)
    man = leer_manifiesto(base)
    previos: dict = man.get("productos", {})
    indice = Indice(productos)

    elegidos = elegir(origen, indice, res)
    tareas, nuevo = [], {}
    for pid, a in elegidos.items():
        firma = {"origen": a["ruta"], "bytes": a["bytes"], "mtime": a["mtime"]}
        prev = previos.get(pid)
        if prev and prev.get("metodo") == "manual" and (grande_dir / f"{pid}.webp").is_file():
            res.sin_cambios += 1          # foto subida a mano en Configuración: la importación nunca la reemplaza
            nuevo[pid] = prev
            continue
        listo = (grande_dir / f"{pid}.webp").is_file() and (mini_dir / f"{pid}.webp").is_file()
        if prev and listo and all(prev.get(k) == v for k, v in firma.items()):
            res.sin_cambios += 1
            nuevo[pid] = prev
        else:
            tareas.append((pid, a, firma, bool(prev and listo)))

    def _una(t):
        pid, a, firma, existia = t
        try:
            convertir(a["ruta"], grande_dir / f"{pid}.webp", mini_dir / f"{pid}.webp")
            return pid, {**firma, "metodo": a["metodo"], "codigo": a["codigo"]}, existia, None
        except Exception as e:   # archivo dañado o que no es imagen: se descarta y se sigue
            return pid, None, existia, f"{type(e).__name__}: {e}"[:160]

    with ThreadPoolExecutor(max_workers=hilos or min(8, os.cpu_count() or 2)) as ex:
        for pid, info, existia, error in ex.map(_una, tareas):
            if info:
                nuevo[pid] = info
                if existia:
                    res.actualizadas += 1
                else:
                    res.nuevas += 1
            else:
                res.descartadas.append({"producto_id": pid, "archivo": elegidos[pid]["ruta"], "error": error})
                if pid in previos:          # la anterior sigue sirviendo
                    nuevo[pid] = previos[pid]

    # Lo que ya se había importado y la carpeta nueva no trae se conserva, siempre que el producto siga en el catálogo.
    for pid, info in previos.items():
        if pid not in nuevo and pid in indice.ids and (grande_dir / f"{pid}.webp").is_file():
            nuevo[pid] = info

    # Solo quedan imágenes de productos del catálogo: el resto (y cualquier archivo ajeno) se borra.
    for d in (grande_dir, mini_dir):
        for f in d.iterdir():
            if f.is_file() and (f.suffix != ".webp" or f.stem not in nuevo):
                f.unlink()
                if d == grande_dir and f.suffix == ".webp":
                    res.borradas += 1

    cambio = res.nuevas or res.actualizadas or res.borradas or set(nuevo) != set(previos)
    man = {"version": int(time.time()) if cambio else man.get("version", 0) or int(time.time()), "productos": nuevo}
    tmp = base / (MANIFIESTO + ".tmp")
    tmp.write_text(json.dumps(man, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, base / MANIFIESTO)

    res.productos_con_imagen = len(nuevo)
    cuenta: dict[str, int] = defaultdict(int)
    for info in nuevo.values():
        cuenta[info.get("metodo", "?")] += 1
    res.por_metodo = dict(cuenta)
    res.mb_destino = round(sum(f.stat().st_size for d in (grande_dir, mini_dir) for f in d.glob("*.webp")) / 1e6, 1)
    res.segundos = round(time.time() - t0, 1)
    log.info("Imágenes importadas: %s", res.resumen())
    return res
