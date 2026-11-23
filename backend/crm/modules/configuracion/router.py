"""API de Configuración (prefijo ``/api/configuracion``).

* Leer (con la clave normal): estado de cada canal, sin secretos; qué canales están disponibles; si se puede editar.
* Cambiar, probar la conexión y sincronizar plantillas: SOLO con la clave de administración.
"""

from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ...security import require_admin
from . import catalogo as cat
from . import pruebas
from .servicio import get_configuracion, modo_desarrollo, motivos_bloqueo

log = logging.getLogger("crm.configuracion.api")
router = APIRouter(prefix="/api/configuracion", tags=["configuración"])


def _origen(request: Request) -> str:
    nombre = re.sub(r"[^\w .@-]", "", request.headers.get("x-crm-usuario", ""), flags=re.UNICODE).strip()[:30]
    return f"{nombre or 'web'}@{request.client.host if request.client else '?'}"


def _canal(canal: str) -> str:
    if canal not in cat.CANALES:
        raise HTTPException(404, "Canal desconocido.")
    return canal


class CanalIn(BaseModel):
    proveedor: str = Field(min_length=1, max_length=30)
    activo: bool = True
    datos: dict = Field(default_factory=dict)
    secretos: dict = Field(default_factory=dict, description="Solo los secretos que se quieren cambiar; vacío = conservar.")
    borrar_secretos: list[str] = Field(default_factory=list, max_length=20)


@router.get("")
def leer(request: Request):
    rol = getattr(request.state, "rol", None)
    return {"canales": get_configuracion().todos(), "catalogo": {k: {p: {"nombre": v["nombre"], "ayuda": v["ayuda"], "campos": v["campos"]}
                                                                     for p, v in provs.items()} for k, provs in cat.PROVEEDORES.items()},
            "fuentes_variable": cat.FUENTES_VARIABLE, "puede_editar": rol in ("admin", "abierto")}


@router.get("/disponibles")
def disponibles():
    """Qué canales se pueden usar en campañas y automatizaciones (y su costo por mensaje)."""
    cfg = get_configuracion()
    motivos = motivos_bloqueo()
    return {"canales": {c: motivos[c] is None for c in cat.CANALES}, "motivos": motivos, "costos": cfg.costos(),
            "desarrollo": modo_desarrollo()}


class DesarrolloIn(BaseModel):
    activo: bool


@router.put("/desarrollo", dependencies=[Depends(require_admin)])
def cambiar_desarrollo(b: DesarrolloIn, request: Request):
    """TEMPORAL: modo desarrollo (canales habilitados aunque no estén configurados)."""
    from .general import get_general
    g = get_general()
    g.fijar_interno("modo_desarrollo", b.activo)
    g.store.auditar("configuracion", None, f"modo desarrollo {'ACTIVADO' if b.activo else 'desactivado'}", _origen(request))
    return {"desarrollo": b.activo}


@router.put("/canales/{canal}", dependencies=[Depends(require_admin)])
def guardar(canal: str, b: CanalIn, request: Request):
    try:
        return get_configuracion().guardar(_canal(canal), b.proveedor, b.datos, b.secretos, b.borrar_secretos, b.activo,
                                           _origen(request))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@router.post("/canales/{canal}/probar", dependencies=[Depends(require_admin)])
async def probar(canal: str, request: Request):
    cfg = get_configuracion()
    _canal(canal)
    falt = cfg.faltantes(canal)
    if falt:
        raise HTTPException(422, "Faltan datos obligatorios: " + ", ".join(falt) + ".")
    try:
        proveedor, datos, secretos = cfg.credenciales(canal)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    try:
        detalle = await asyncio.to_thread(pruebas.probar, canal, proveedor, datos, secretos)
        ok = True
    except pruebas.PruebaFallida as e:
        detalle, ok = str(e), False
    cfg.registrar_prueba(canal, ok, detalle)
    cfg.store.auditar("configuracion_prueba", None, f"{canal} · {'ok' if ok else 'falló'}", _origen(request))
    return {"ok": ok, "detalle": detalle, "canal": cfg.estado(canal)}


@router.post("/canales/whatsapp/plantillas", dependencies=[Depends(require_admin)])
async def sincronizar_plantillas():
    """Trae de Meta las plantillas de la cuenta (para elegir la de campañas y ver cuántas variables tiene)."""
    cfg = get_configuracion()
    try:
        proveedor, datos, secretos = cfg.credenciales("whatsapp")
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    if not (secretos.get("access_token") and datos.get("waba_id") and datos.get("api_version")):
        raise HTTPException(422, "Para traer las plantillas guarde primero el token, el identificador de la cuenta y la versión.")
    try:
        lista = await asyncio.to_thread(pruebas.plantillas_whatsapp, datos, secretos)
    except pruebas.PruebaFallida as e:
        raise HTTPException(502, str(e)) from None
    cfg.guardar_plantillas("whatsapp", lista)
    return {"plantillas": lista, "aprobadas": sum(1 for p in lista if p["estado"] == "APPROVED")}


# ================================================================================ configuración general
from ...config import get_settings  # noqa: E402
from . import archivos  # noqa: E402
from .general import ESQUEMA, get_general  # noqa: E402
from .legal import get_legal  # noqa: E402
from .presupuesto import consumo  # noqa: E402

MAX_RNE = 30 * 1024 * 1024


async def _cuerpo(request: Request, maximo: int) -> bytes:
    largo = request.headers.get("content-length")
    if largo and largo.isdigit() and int(largo) > maximo:
        raise HTTPException(413, "El archivo es demasiado grande.")
    datos = bytearray()
    async for parte in request.stream():
        datos += parte
        if len(datos) > maximo:
            raise HTTPException(413, "El archivo es demasiado grande.")
    return bytes(datos)


@router.get("/general")
def leer_general(request: Request):
    d = get_settings().data_dir
    g = get_general().todo()
    from ...etl import pipeline
    gen = get_general()
    etl = {"ultima_automatica": gen.interno("etl_ultima"), "resultado": gen.interno("etl_resultado"),
           "estado": pipeline.estado(), "ads_configurado": bool(get_settings().ads_data_directory)}
    return {**g, "esquema": ESQUEMA, "logo": archivos.ruta_logo(d).is_file(), "politica_pdf": archivos.ruta_politica(d).is_file(),
            "etl": etl,
            "puede_editar": getattr(request.state, "rol", None) in ("admin", "abierto")}


@router.put("/general/{seccion}", dependencies=[Depends(require_admin)])
def guardar_general(seccion: str, datos: dict, request: Request):
    if seccion not in ESQUEMA:
        raise HTTPException(404, "Sección desconocida.")
    try:
        return get_general().guardar(seccion, datos, _origen(request))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@router.post("/empresa/logo", dependencies=[Depends(require_admin)])
async def subir_logo(request: Request):
    try:
        r = await asyncio.to_thread(archivos.guardar_logo, await _cuerpo(request, archivos.MAX_LOGO), get_settings().data_dir)
    except archivos.ArchivoInvalido as e:
        raise HTTPException(422, str(e)) from None
    get_general().store.auditar("configuracion", None, "empresa · logo cargado", _origen(request))
    return r


@router.delete("/empresa/logo", dependencies=[Depends(require_admin)], status_code=204)
def borrar_logo(request: Request):
    archivos.ruta_logo(get_settings().data_dir).unlink(missing_ok=True)
    get_general().store.auditar("configuracion", None, "empresa · logo borrado", _origen(request))


@router.post("/legal/politica", dependencies=[Depends(require_admin)])
async def subir_politica(request: Request):
    try:
        r = archivos.guardar_politica(await _cuerpo(request, archivos.MAX_PDF), get_settings().data_dir)
    except archivos.ArchivoInvalido as e:
        raise HTTPException(422, str(e)) from None
    get_general().store.auditar("configuracion", None, "legal · PDF de la política cargado", _origen(request))
    return r


@router.delete("/legal/politica", dependencies=[Depends(require_admin)], status_code=204)
def borrar_politica(request: Request):
    archivos.ruta_politica(get_settings().data_dir).unlink(missing_ok=True)
    get_general().store.auditar("configuracion", None, "legal · PDF de la política borrado", _origen(request))


@router.get("/legal/estado")
def estado_legal():
    lg = get_legal()
    return {"rne": lg.estado_rne(), "bajas": lg.resumen_bajas()}


def _texto(datos: bytes) -> str:
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return datos.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


@router.post("/legal/rne", dependencies=[Depends(require_admin)])
async def importar_rne(request: Request):
    """El cuerpo es el archivo descargado de la plataforma de la CRC (CSV o TXT). Reemplaza la lista anterior."""
    texto = _texto(await _cuerpo(request, MAX_RNE))
    try:
        return await asyncio.to_thread(get_legal().importar_rne, texto, _origen(request))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


class ConsultaRne(BaseModel):
    valor: str = Field(min_length=3, max_length=200)


@router.post("/legal/rne/consultar")
def consultar_rne(b: ConsultaRne):
    return {"en_rne": get_legal().en_rne(b.valor)}


@router.get("/presupuesto/consumo")
def consumo_presupuesto():
    return consumo()


# ================================================================================ páginas públicas (sin clave)
publico = APIRouter(tags=["público"])
_NOMBRE_CANAL = {"email": "correos", "sms": "mensajes de texto", "whatsapp": "mensajes de WhatsApp"}


def _pagina(titulo: str, cuerpo: str):
    from html import escape

    from fastapi.responses import HTMLResponse
    emp = get_general().seccion("empresa")
    color = emp["color"] or "#003760"
    nombre = escape(emp["nombre"] or "")
    cabeza = ('<img src="/media/empresa/logo.webp" alt="" style="max-height:56px;max-width:220px">'
              if archivos.ruta_logo(get_settings().data_dir).is_file() else f"<b style='font-size:20px'>{nombre}</b>")
    html = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(titulo)} · {nombre}</title><style>body{{margin:0;font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f4f6f9;color:#1f2937}}
.c{{max-width:480px;margin:40px auto;padding:0 16px}}.k{{background:#fff;border-radius:16px;box-shadow:0 10px 30px -12px rgba(0,0,0,.2);overflow:hidden}}
.h{{background:{color};padding:20px;text-align:center;color:#fff}}.b{{padding:24px;line-height:1.5}}button{{background:{color};color:#fff;border:0;
border-radius:999px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer}}a{{color:{color}}}</style></head>
<body><div class="c"><div class="k"><div class="h">{cabeza}</div><div class="b">{cuerpo}</div></div></div></body></html>"""
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@publico.get("/baja", include_in_schema=False)
def pagina_baja(t: str = ""):
    from html import escape
    try:
        _, canal = get_legal().leer_token(t)
    except ValueError as e:
        return _pagina("Enlace no válido", f"<h2>Enlace no válido</h2><p>{escape(str(e))}</p>")
    nombre = escape(get_general().seccion("empresa")["nombre"] or "")
    return _pagina("Cancelar suscripción", f"""<h2>Cancelar suscripción</h2>
<p>¿Quiere dejar de recibir {_NOMBRE_CANAL[canal]} promocionales de <b>{nombre}</b>?</p>
<form method="post" action="/baja"><input type="hidden" name="t" value="{escape(t)}"><button type="submit">Sí, cancelar mi suscripción</button></form>
<p style="font-size:13px;color:#6b7280">Seguirá recibiendo los mensajes que no son publicitarios (por ejemplo, facturas).</p>""")


@publico.post("/baja", include_in_schema=False)
async def confirmar_baja(request: Request):
    from html import escape
    from urllib.parse import parse_qs
    cuerpo = (await _cuerpo(request, 8192)).decode("utf-8", "replace")
    t = (parse_qs(cuerpo).get("t") or [""])[0]
    try:
        doc, canal = get_legal().leer_token(t)
    except ValueError as e:
        return _pagina("Enlace no válido", f"<h2>Enlace no válido</h2><p>{escape(str(e))}</p>")
    await asyncio.to_thread(get_legal().registrar_baja, doc, canal, f"enlace@{request.client.host if request.client else '?'}")
    pol = get_general().seccion("legal")["politica_url"] or (
        "/media/legal/politica.pdf" if archivos.ruta_politica(get_settings().data_dir).is_file() else "")
    enlace = f'<p><a href="{escape(pol)}">Política de Tratamiento de Datos</a></p>' if pol else ""
    return _pagina("Suscripción cancelada", f"<h2>Listo</h2><p>Ya no le enviaremos {_NOMBRE_CANAL[canal]} promocionales.</p>{enlace}")


@publico.get("/media/empresa/logo.webp", include_in_schema=False)
def logo_publico():
    from fastapi.responses import FileResponse
    p = archivos.ruta_logo(get_settings().data_dir)
    if not p.is_file():
        raise HTTPException(404, "Sin logo.")
    return FileResponse(p, media_type="image/webp", headers={"Cache-Control": "public, max-age=300"})


@publico.get("/media/legal/politica.pdf", include_in_schema=False)
def politica_publica():
    from fastapi.responses import FileResponse
    p = archivos.ruta_politica(get_settings().data_dir)
    if not p.is_file():
        raise HTTPException(404, "Sin política cargada.")
    return FileResponse(p, media_type="application/pdf", headers={
        "Cache-Control": "public, max-age=300", "Content-Disposition": 'inline; filename="politica-tratamiento-datos.pdf"'})
