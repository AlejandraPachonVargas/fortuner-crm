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
        return {"version": 0, "ids": [], "versiones": {}}
    with _lock:
        if _cache["mtime"] != mtime:
            man = leer_manifiesto(base())
            prods = man.get("productos", {})
            _cache["datos"] = {"version": man.get("version", 0), "ids": sorted(prods),
                               # fotos cambiadas a mano: su propia versión, para que el navegador no muestre la anterior
                               "versiones": {p: i["v"] for p, i in prods.items() if i.get("v")}}
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


# ------------------------------------------------------------------------------------------ fotos una a una
from ...security import require_admin  # noqa: E402
from . import fotos as ft  # noqa: E402


def _quien(request: Request) -> str:
    nombre = re.sub(r"[^\w .@-]", "", request.headers.get("x-crm-usuario", ""), flags=re.UNICODE).strip()[:30]
    return nombre or "administrador"


def _wh():
    from ...warehouse import get_warehouse
    return get_warehouse()


def _producto(pid: str) -> None:
    if not _ID.match(pid) or not _wh().scalar("SELECT COUNT(*) FROM producto WHERE producto_id = ?", [pid]):
        raise HTTPException(404, "Producto no encontrado en el catálogo.")


@router.get("/api/configuracion/fotos", dependencies=[Depends(require_api_key)])
def listar_fotos(filtro: str = Query("sin_foto", pattern="^(sin_foto|sin_verificar|verificadas|todas)$"),
                 q: str = Query("", max_length=80), pagina: int = Query(1, ge=1, le=10_000)):
    return ft.listar(_wh(), base(), filtro, q, pagina)


@router.post("/api/configuracion/fotos/{pid}", dependencies=[Depends(require_admin)])
async def subir_foto(pid: str, request: Request):
    _producto(pid)
    datos = bytearray()
    async for parte in request.stream():
        datos += parte
        if len(datos) > ft.MAX_BYTES:
            raise HTTPException(413, "La foto debe pesar menos de 8 MB.")
    try:
        info = await asyncio.to_thread(ft.subir, base(), pid, bytes(datos), _quien(request))
    except ft.FotoInvalida as e:
        raise HTTPException(422, str(e)) from None
    _auditar(f"foto subida · producto {pid}", request)
    return info


@router.delete("/api/configuracion/fotos/{pid}", dependencies=[Depends(require_admin)], status_code=204)
def borrar_foto(pid: str, request: Request):
    _producto(pid)
    if ft.borrar(base(), pid):
        _auditar(f"foto quitada · producto {pid}", request)


@router.post("/api/configuracion/fotos/{pid}/verificar", dependencies=[Depends(require_admin)])
def verificar_foto(pid: str, request: Request, ok: bool = True):
    _producto(pid)
    try:
        info = ft.verificar(base(), pid, _quien(request), ok)
    except ft.FotoInvalida as e:
        raise HTTPException(404, str(e)) from None
    _auditar(f"foto {'verificada' if ok else 'marcada sin verificar'} · producto {pid}", request)
    return info


def _auditar(detalle: str, request: Request) -> None:
    from ...store import get_store
    get_store().auditar("fotos", None, detalle, f"{_quien(request)}@{request.client.host if request.client else '?'}")
