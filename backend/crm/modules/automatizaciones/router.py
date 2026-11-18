"""API de Automatizaciones (``/api/automatizaciones``, requiere clave).

Cualquier rol con clave crea, edita, prueba, activa y pausa. Ejecutar a mano (registra envíos fuera de la hora
programada) requiere la clave de administración. Las funciones son normales (no ``async``): corren en el grupo de hilos.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ...security import require_admin
from ...store import get_store
from ..clientes.indice import IndiceNoListo
from . import catalogo, motor
from .almacen import NoEncontrada, get_almacen

log = logging.getLogger("crm.automatizaciones.api")
router = APIRouter(prefix="/api/automatizaciones", tags=["automatizaciones"])


def _origen(request: Request) -> str:
    nombre = re.sub(r"[^\w .@-]", "", request.headers.get("x-crm-usuario", ""), flags=re.UNICODE).strip()[:30]
    return f"{nombre or 'web'}@{request.client.host if request.client else '?'}"


def _err(e: Exception) -> HTTPException:
    if isinstance(e, NoEncontrada):
        return HTTPException(404, str(e))
    if isinstance(e, ValueError):
        return HTTPException(422, str(e))
    if isinstance(e, motor.Ocupada):
        return HTTPException(409, str(e))
    if isinstance(e, IndiceNoListo):
        return HTTPException(503, f"No se puede verificar el consentimiento de los clientes contra el ERP en este momento: {e}")
    if isinstance(e, motor.SinDatos):
        return HTTPException(503, str(e))
    log.exception("Error en Automatizaciones")
    return HTTPException(500, "No se pudo completar la operación. Intente de nuevo.")


def _auditar(accion: str, aid: str, detalle: str, request: Request) -> None:
    get_store().auditar(f"automatizacion_{accion}", aid, detalle, _origen(request))


def _proxima(a: dict, ahora: datetime) -> str | None:
    """Cuándo vuelve a evaluarse sola (hora del servidor)."""
    if not a["activa"]:
        return None
    h, m = (int(x) for x in a["hora"].split(":"))
    hoy = ahora.replace(hour=h, minute=m, second=0, microsecond=0)
    if a.get("ultima_ref") == ahora.date().isoformat():
        return (hoy + timedelta(days=1)).isoformat(timespec="minutes")
    return max(hoy, ahora).isoformat(timespec="minutes")


def _vista(a: dict, detalle: bool = False) -> dict:
    alm, ahora = get_almacen(), datetime.now()
    hoy = ahora.date()
    vig = alm.vigente(a, hoy)
    futuras = [e for e in a["ediciones"] if e["desde"] > hoy.isoformat()]
    out = {**a, "vigente": vig["id"] if vig else None, "proxima_edicion": futuras[0]["id"] if futuras else None,
           "proxima_ejecucion": _proxima(a, ahora), "ultima": alm.ultima_ejecucion(a["id"]),
           "envios": alm.resumen_envios(a["id"], 30), "tipo_nombre": catalogo.TIPOS[a["tipo"]]["nombre"],
           "disparo": catalogo.TIPOS[a["tipo"]]["disparo"]}
    if detalle:
        out["ejecuciones"] = alm.ejecuciones(a["id"], 30)
    return out


# ------------------------------------------------------------------------------------------ esquemas
class CrearIn(BaseModel):
    tipo: str = Field(pattern="^(cumpleanos|bienvenida|segunda_compra|reactivacion)$")
    nombre: str = Field("", max_length=80)


class ActualizarIn(BaseModel):
    nombre: str | None = Field(None, max_length=80)
    hora: str | None = Field(None, max_length=5)
    params: dict | None = None
    filtros: dict | None = None


class OfertaIn(BaseModel):
    tipo: str = Field(max_length=20)
    valor: float | None = Field(None, ge=0, le=100_000_000)
    descripcion: str = Field("", max_length=200)
    productos: list[dict] = Field(default_factory=list, max_length=20)
    restringido: bool = False


class EdicionIn(BaseModel):
    nombre: str = Field(max_length=60)
    desde: date
    hasta: date
    oferta: OfertaIn
    validez_dias: int = Field(ge=1, le=90)
    canales: list[str] = Field(default_factory=list, max_length=3)
    textos: dict = Field(default_factory=dict)


class ProbarIn(BaseModel):
    fecha: date | None = None
    edicion_id: str | None = Field(None, max_length=20)


# ------------------------------------------------------------------------------------------ rutas
@router.get("/tipos")
def tipos():
    return {"tipos": catalogo.catalogo_publico(), "ofertas": catalogo.TIPOS_OFERTA, "motivos": motor.MOTIVOS}


@router.get("")
def listar():
    try:
        alm = get_almacen()
        return {"items": [_vista(a) for a in alm.listar()], "resumen": alm.resumen_envios(None, 30)}
    except Exception as e:
        raise _err(e) from None


@router.post("", status_code=201)
def crear(b: CrearIn, request: Request):
    try:
        a = get_almacen().crear(b.tipo, b.nombre)
        _auditar("crear", a["id"], a["nombre"], request)
        return _vista(a, True)
    except Exception as e:
        raise _err(e) from None


@router.get("/{aid}")
def obtener(aid: str):
    try:
        return _vista(get_almacen().exigir(aid), True)
    except Exception as e:
        raise _err(e) from None


@router.put("/{aid}")
def actualizar(aid: str, b: ActualizarIn, request: Request):
    try:
        a = get_almacen().actualizar(aid, b.model_dump(exclude_none=True))
        _auditar("editar", aid, "reglas", request)
        return _vista(a, True)
    except Exception as e:
        raise _err(e) from None


@router.post("/{aid}/activar")
def activar(aid: str, request: Request):
    try:
        a = get_almacen().activar(aid, True)
        _auditar("activar", aid, "", request)
        return _vista(a, True)
    except Exception as e:
        raise _err(e) from None


@router.post("/{aid}/pausar")
def pausar(aid: str, request: Request):
    try:
        a = get_almacen().activar(aid, False)
        _auditar("pausar", aid, "", request)
        return _vista(a, True)
    except Exception as e:
        raise _err(e) from None


@router.delete("/{aid}", status_code=204)
def eliminar(aid: str, request: Request):
    try:
        get_almacen().eliminar(aid)
        _auditar("eliminar", aid, "", request)
    except Exception as e:
        raise _err(e) from None


@router.post("/{aid}/ediciones", status_code=201)
def crear_edicion(aid: str, b: EdicionIn, request: Request):
    try:
        e = get_almacen().crear_edicion(aid, b.model_dump())
        _auditar("crear_edicion", aid, e["nombre"], request)
        return e
    except Exception as e:
        raise _err(e) from None


@router.put("/{aid}/ediciones/{eid}")
def actualizar_edicion(aid: str, eid: str, b: EdicionIn, request: Request):
    try:
        e = get_almacen().actualizar_edicion(aid, eid, b.model_dump())
        _auditar("editar_edicion", aid, e["nombre"], request)
        return e
    except Exception as e:
        raise _err(e) from None


@router.post("/{aid}/ediciones/{eid}/duplicar", status_code=201)
def duplicar_edicion(aid: str, eid: str, request: Request):
    try:
        e = get_almacen().duplicar_edicion(aid, eid, 1)
        _auditar("duplicar_edicion", aid, e["nombre"], request)
        return e
    except Exception as e:
        raise _err(e) from None


@router.delete("/{aid}/ediciones/{eid}", status_code=204)
def eliminar_edicion(aid: str, eid: str, request: Request):
    try:
        get_almacen().eliminar_edicion(aid, eid)
        _auditar("eliminar_edicion", aid, eid, request)
    except Exception as e:
        raise _err(e) from None


@router.post("/{aid}/probar")
def probar(aid: str, b: ProbarIn):
    """¿A quién le tocaría ese día? Solo calcula: no registra envíos ni marca el día como evaluado."""
    try:
        return motor.ejecutar(aid, fecha=b.fecha, probar=True, edicion_id=b.edicion_id)
    except Exception as e:
        raise _err(e) from None


@router.post("/{aid}/ejecutar", dependencies=[Depends(require_admin)])
def ejecutar(aid: str, request: Request):
    """Ejecuta hoy, ya, sin esperar la hora (envíos SIMULADOS). Repetirlo el mismo día no duplica envíos."""
    try:
        res = motor.ejecutar(aid, fecha=date.today(), origen=_origen(request))
        _auditar("ejecutar", aid, f"{res.get('enviados', 0)} envíos simulados", request)
        return res
    except Exception as e:
        raise _err(e) from None
