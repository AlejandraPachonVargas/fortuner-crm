"""Entrega de las fotos de producto ya importadas (``crm imagenes importar``).

* ``GET /api/productos/imagenes`` (con clave): qué productos tienen foto y la versión, para no pedir fotos que no existen.
* ``GET /media/productos/{producto_id}.webp`` (pública): la foto. Es pública a propósito: un ``<img>`` no puede mandar la
  clave en una cabecera, son fotos de catálogo del fabricante (sin datos personales) y más adelante los mensajes de
  WhatsApp o correo necesitarán enlazarlas. Solo acepta códigos numéricos y archivos dentro de ``data/imagenes``.
"""

from __future__ import annotations

import asyncio
import re
import threading

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from ...config import get_settings
from ...security import require_api_key
from . import banners as ban
from .importador import MANIFIESTO, carpetas, leer_manifiesto

router = APIRouter(tags=["imágenes"])
_ID = re.compile(r"^[0-9]{1,20}$")
_cache: dict = {"mtime": None, "datos": {"version": 0, "ids": []}}
_lock = threading.Lock()


def base():
    return get_settings().data_dir / "imagenes"


def disponibles() -> dict:
    """{version, ids}; se relee solo cuando cambia el manifiesto (p. ej. tras importar con el CRM encendido)."""
    ruta = base() / MANIFIESTO
    try:
        mtime = ruta.stat().st_mtime
    except OSError:
        return {"version": 0, "ids": []}
    with _lock:
        if _cache["mtime"] != mtime:
            man = leer_manifiesto(base())
            _cache["datos"] = {"version": man.get("version", 0), "ids": sorted(man.get("productos", {}))}
            _cache["mtime"] = mtime
        return _cache["datos"]


@router.get("/api/productos/imagenes", dependencies=[Depends(require_api_key)])
def imagenes_disponibles():
    return disponibles()


@router.get("/media/productos/{nombre}", include_in_schema=False)
def imagen(nombre: str, t: str = Query("g", pattern="^(g|mini)$"), v: str | None = Query(None, max_length=20)):
    pid, _, ext = nombre.partition(".")
    if ext != "webp" or not _ID.match(pid):
        raise HTTPException(404, "No encontrado.")
    grande, mini = carpetas(base())
    archivo = (mini if t == "mini" else grande) / f"{pid}.webp"
    if not archivo.is_file():
        raise HTTPException(404, "Este producto no tiene foto.")
    # Con ?v=<versión> la URL cambia en cada importación: el navegador puede guardarla un año sin volver a pedirla.
    cache = "public, max-age=31536000, immutable" if v else "public, max-age=3600"
    return FileResponse(archivo, media_type="image/webp", headers={"Cache-Control": cache})


# ------------------------------------------------------------------------------------------ banners
@router.post("/api/campanas/banners", dependencies=[Depends(require_api_key)], status_code=201)
async def subir_banner(request: Request):
    """El cuerpo es la imagen tal cual (Content-Type image/jpeg, image/png o image/webp). Devuelve {id, ancho, alto}."""
    if not request.headers.get("content-type", "").startswith("image/"):
        raise HTTPException(415, "Envíe una imagen JPG, PNG o WebP.")
    largo = request.headers.get("content-length")
    if largo and largo.isdigit() and int(largo) > ban.MAX_BYTES:
        raise HTTPException(413, "La imagen pesa más de 8 MB. Exporte una versión más liviana.")
    datos = bytearray()
    async for parte in request.stream():
        datos += parte
        if len(datos) > ban.MAX_BYTES:
            raise HTTPException(413, "La imagen pesa más de 8 MB. Exporte una versión más liviana.")
    try:
        return await asyncio.to_thread(ban.guardar, bytes(datos), base())
    except ban.BannerInvalido as e:
        raise HTTPException(422, str(e)) from e


@router.get("/media/banners/{nombre}", include_in_schema=False)
def banner(nombre: str):
    bid, _, ext = nombre.partition(".")
    archivo = ban.ruta(base(), bid) if ext == "webp" else None
    if archivo is None:
        raise HTTPException(404, "No encontrado.")
    # El id es aleatorio y el archivo nunca cambia: se puede guardar en caché un año.
    return FileResponse(archivo, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable"})
