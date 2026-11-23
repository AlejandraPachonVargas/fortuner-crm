"""Banners de campaña: la pieza que hace el publicista y reemplaza a las fotos de producto en WhatsApp y en el correo.

Seguridad: el archivo subido NUNCA se guarda tal cual. Se abre con Pillow (solo JPEG, PNG o WebP; tope de tamaño y de
píxeles), se vuelve a dibujar en RGB y se guarda como WebP nuevo con un nombre aleatorio. Así se descartan metadatos
(GPS de la cámara, etc.) y cualquier contenido que no sea imagen. Un banner que ninguna campaña usa se borra a las 24 h.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path

from PIL import Image, ImageOps

log = logging.getLogger("crm.imagenes")

MAX_BYTES = 8 * 1024 * 1024          # 8 MB de archivo
MAX_PIXELES = 40_000_000             # p. ej. 8000 × 5000
ANCHO_MAX = 1200                     # 600 px del correo en pantallas de alta densidad; WhatsApp lo recorta a su gusto
FORMATOS = {"JPEG", "PNG", "WEBP"}
ID = re.compile(r"^[0-9a-f]{32}$")
GRACIA_SEG = 24 * 3600               # un banner recién subido se conserva un día aunque aún no se haya guardado la campaña


class BannerInvalido(ValueError):
    """El archivo no es una imagen aceptada."""


def carpeta(base: Path) -> Path:
    return base / "banners"


def guardar(datos: bytes, base: Path) -> dict:
    if not datos:
        raise BannerInvalido("El archivo está vacío.")
    if len(datos) > MAX_BYTES:
        raise BannerInvalido(f"La imagen pesa más de {MAX_BYTES // (1024 * 1024)} MB. Exporte una versión más liviana.")
    try:
        with Image.open(io.BytesIO(datos)) as im:
            if im.format not in FORMATOS:
                raise BannerInvalido("Formato no admitido: use JPG, PNG o WebP.")
            if im.width * im.height > MAX_PIXELES:
                raise BannerInvalido("La imagen es demasiado grande (más de 40 megapíxeles).")
            im.seek(0)          # GIF/WebP animado: solo el primer cuadro
            im.load()
            im = ImageOps.exif_transpose(im)
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                fondo = Image.new("RGB", im.size, "white")
                fondo.paste(im, mask=im.split()[-1])
                im = fondo
            elif im.mode != "RGB":
                im = im.convert("RGB")
    except BannerInvalido:
        raise
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as e:
        raise BannerInvalido("El archivo no es una imagen válida.") from e
    if im.width > ANCHO_MAX:
        im = im.resize((ANCHO_MAX, round(im.height * ANCHO_MAX / im.width)), Image.Resampling.LANCZOS)
    bid = secrets.token_hex(16)
    d = carpeta(base)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{bid}.tmp"
    im.save(tmp, "WEBP", quality=85, method=4)
    os.replace(tmp, d / f"{bid}.webp")
    return {"id": bid, "ancho": im.width, "alto": im.height, "bytes": (d / f"{bid}.webp").stat().st_size}


def ruta(base: Path, bid: str) -> Path | None:
    if not ID.match(bid or ""):
        return None
    p = carpeta(base) / f"{bid}.webp"
    return p if p.is_file() else None


def banner_de(mensaje: dict | None) -> dict | None:
    """Valida el banner dentro del mensaje de una campaña: solo {id, ancho, alto, nombre}, con id aleatorio válido."""
    b = (mensaje or {}).get("banner")
    if b in (None, {}):
        return None
    if not isinstance(b, dict) or not ID.match(str(b.get("id", ""))):
        raise ValueError("Banner inválido")
    out = {"id": b["id"]}
    for k in ("ancho", "alto"):
        if isinstance(b.get(k), int) and 0 < b[k] <= 20_000:
            out[k] = b[k]
    if isinstance(b.get("nombre"), str):
        out["nombre"] = b["nombre"][:120]
    return out


def depurar(base: Path, usados: set[str], ahora: float | None = None) -> int:
    """Borra los banners que ninguna campaña usa y que tienen más de 24 h. Devuelve cuántos borró."""
    d = carpeta(base)
    if not d.is_dir():
        return 0
    ahora = ahora or time.time()
    n = 0
    for f in d.iterdir():
        if not f.is_file():
            continue
        viejo = ahora - f.stat().st_mtime > GRACIA_SEG
        if (f.suffix == ".webp" and f.stem not in usados and viejo) or (f.suffix != ".webp" and viejo):
            f.unlink()
            n += 1
    if n:
        log.info("Banners sin uso borrados: %s", n)
    return n


def usados_en(mensajes: list[str]) -> set[str]:
    """Ids de banner que aparecen en los mensajes guardados (JSON en texto)."""
    out = set()
    for m in mensajes:
        try:
            b = (json.loads(m or "{}") or {}).get("banner") or {}
        except ValueError:
            continue
        if isinstance(b, dict) and ID.match(str(b.get("id", ""))):
            out.add(b["id"])
    return out
