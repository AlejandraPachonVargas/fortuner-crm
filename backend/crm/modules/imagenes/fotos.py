"""Fotos de producto una a una (Configuración › Fotos de productos).

Los dueños del CRM revisan producto por producto: ven el nombre, el código de barras y la foto, y pueden
**verificarla** (es el producto correcto), **cambiarla** por otra que suban o **quitarla**. Una foto subida a mano queda
verificada por quien la subió y la importación masiva (``crm imagenes importar``) nunca la reemplaza.
"""

from __future__ import annotations

import io
import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path

from PIL import Image

from .importador import MANIFIESTO, carpetas, convertir, leer_manifiesto

MAX_BYTES = 8 * 1024 * 1024
_lock = threading.Lock()


class FotoInvalida(ValueError):
    pass


def _escribir(base: Path, man: dict) -> None:
    tmp = base / (MANIFIESTO + ".tmp")
    tmp.write_text(json.dumps(man, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, base / MANIFIESTO)


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def subir(base: Path, pid: str, datos: bytes, quien: str) -> dict:
    if not datos or len(datos) > MAX_BYTES:
        raise FotoInvalida("La foto debe pesar menos de 8 MB.")
    try:
        with Image.open(io.BytesIO(datos)) as im:
            if im.format not in ("JPEG", "PNG", "WEBP"):
                raise FotoInvalida("Formato no admitido: use JPG, PNG o WebP.")
            if im.width * im.height > 40_000_000:
                raise FotoInvalida("La imagen es demasiado grande.")
            im.verify()
    except FotoInvalida:
        raise
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as e:
        raise FotoInvalida("El archivo no es una imagen válida.") from e
    grande, mini = carpetas(base)
    mini.mkdir(parents=True, exist_ok=True)
    convertir(io.BytesIO(datos), grande / f"{pid}.webp", mini / f"{pid}.webp")   # se vuelve a dibujar como WebP
    with _lock:
        man = leer_manifiesto(base)
        ahora = _ahora()
        man.setdefault("productos", {})[pid] = {"metodo": "manual", "origen": "subida", "subida_por": quien, "fecha": ahora,
                                                "verificada_por": quien, "verificada_en": ahora, "v": int(time.time())}
        man["version"] = man.get("version") or int(time.time())
        _escribir(base, man)
    return man["productos"][pid]


def borrar(base: Path, pid: str) -> bool:
    grande, mini = carpetas(base)
    with _lock:
        man = leer_manifiesto(base)
        if pid not in man.get("productos", {}):
            return False
        del man["productos"][pid]
        _escribir(base, man)
    for d in (grande, mini):
        (d / f"{pid}.webp").unlink(missing_ok=True)
    return True


def verificar(base: Path, pid: str, quien: str, ok: bool) -> dict:
    with _lock:
        man = leer_manifiesto(base)
        info = man.get("productos", {}).get(pid)
        if info is None:
            raise FotoInvalida("Este producto no tiene foto.")
        if ok:
            info.update(verificada_por=quien, verificada_en=_ahora())
        else:
            info.pop("verificada_por", None)
            info.pop("verificada_en", None)
        _escribir(base, man)
    return info


FILTROS = ("sin_foto", "sin_verificar", "verificadas", "todas")


def listar(wh, base: Path, filtro: str, q: str, pagina: int, por_pagina: int = 24) -> dict:
    """Productos para revisar. ``sin_foto`` = vendidos en los últimos 90 días y sin foto (los más vendidos primero)."""
    man = leer_manifiesto(base).get("productos", {})
    con_foto = list(man)
    verificadas = [p for p, i in man.items() if i.get("verificada_en")]
    # Las listas de códigos van como tablas (unnest) y se cruzan con JOIN: con list_contains por fila tardaba segundos.
    params: list = [con_foto, verificadas]
    where = ["TRUE"]
    if filtro == "sin_foto":
        where.append("COALESCE(s.unidades_90d, 0) > 0 AND cf.pid IS NULL")
    elif filtro == "sin_verificar":
        where.append("cf.pid IS NOT NULL AND ve.pid IS NULL")
    elif filtro == "verificadas":
        where.append("ve.pid IS NOT NULL")
    texto = (q or "").strip()
    if texto:
        where.append("(p.producto ILIKE ? OR p.producto_id = ? OR p.ean = ?)")
        params += [f"%{texto}%", texto, texto]
    sql_base = (" FROM producto p LEFT JOIN producto_stats s USING (producto_id)"
                " LEFT JOIN (SELECT DISTINCT unnest(?::VARCHAR[]) AS pid) cf ON cf.pid = p.producto_id"
                " LEFT JOIN (SELECT DISTINCT unnest(?::VARCHAR[]) AS pid) ve ON ve.pid = p.producto_id"
                " WHERE " + " AND ".join(where))
    total = wh.scalar("SELECT COUNT(*)" + sql_base, params)
    filas = wh.query("SELECT p.producto_id, p.producto, p.ean, p.marca, p.grupo, p.precio_venta, p.activo, "
                     "COALESCE(s.unidades_90d, 0) AS unidades_90d" + sql_base +
                     " ORDER BY COALESCE(s.unidades_90d, 0) DESC, p.producto LIMIT ? OFFSET ?",
                     [*params, por_pagina, max(0, pagina - 1) * por_pagina])
    for f in filas:
        i = man.get(f["producto_id"])
        f["foto"] = ({"origen": "subida" if i.get("metodo") == "manual" else "importada", "codigo_archivo": i.get("codigo"),
                      "verificada_por": i.get("verificada_por"), "verificada_en": i.get("verificada_en"),
                      "subida_por": i.get("subida_por"), "v": i.get("v")} if i else None)
    return {"total": total, "pagina": pagina, "por_pagina": por_pagina, "items": filas,
            "resumen": {"con_foto": len(con_foto), "verificadas": len(verificadas)}}
