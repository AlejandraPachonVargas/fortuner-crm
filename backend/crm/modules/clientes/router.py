"""API de Clientes 360°.

Permisos (los decide el servidor, no la pantalla):

* clave ``CRM_API_KEY``   → rol **mercadeo**: consulta, crea y edita clientes, mascotas, vehículos, clubes y notas.
* clave ``CRM_ADMIN_KEY`` → rol **admin**: además anonimiza, elimina, fusiona, importa, desactiva en lote y borra clubes.
* sin claves (solo desarrollo) → admin.
* ``CRM_CLIENTES_ESCRITURA=false`` → todo queda en solo lectura, sin importar la clave.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ...config import get_settings
from . import consultas, esquema, servicio
from .catalogos import get_catalogos
from .conexion import AdsNoConfigurado, configurado
from .indice import IndiceNoListo, get_indice
from .mapeo import DatoInvalido

log = logging.getLogger("crm.clientes.api")
router = APIRouter(prefix="/api/clientes", tags=["clientes"])

PERMISOS = {
    "admin": {"editar": True, "eliminar": True, "importar": True, "verContacto": True, "fusionar": True},
    "mercadeo": {"editar": True, "eliminar": False, "importar": False, "verContacto": True, "fusionar": False},
}


def actor(request: Request) -> servicio.Actor:
    rol = getattr(request.state, "rol", None)
    rol = "admin" if rol in ("admin", "abierto") else "mercadeo"
    nombre = re.sub(r"[^\w .@-]", "", request.headers.get("x-crm-usuario", ""), flags=re.UNICODE).strip()[:30]
    ip = request.client.host if request.client else "?"
    return servicio.Actor(usuario=f"{nombre or 'web'}@{ip}"[:40], rol=rol)


def _err(e: Exception) -> HTTPException:
    if isinstance(e, DatoInvalido):
        return HTTPException(422, {"mensaje": str(e), "campo": e.campo})
    if isinstance(e, servicio.NoEncontrado):
        return HTTPException(404, str(e))
    if isinstance(e, servicio.Conflicto):
        return HTTPException(409, str(e))
    if isinstance(e, servicio.SinPermiso):
        return HTTPException(403, str(e))
    if isinstance(e, IndiceNoListo):
        return HTTPException(503, str(e))
    if isinstance(e, AdsNoConfigurado):
        return HTTPException(503, f"Clientes 360° no está configurado: {e}")
    log.exception("Error en Clientes 360°")
    return HTTPException(500, "No se pudo completar la operación con la base de datos. El detalle quedó en el log del servidor.")


def _hacer(fn, *a, **k):
    try:
        return fn(*a, **k)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - se traduce a un mensaje claro
        raise _err(e) from e


# ------------------------------------------------------------------------------------------ sesión y estado
@router.get("/sesion")
def sesion(request: Request):
    a = actor(request)
    s = get_settings()
    escritura = s.clientes_escritura
    permisos = {k: (v and escritura) if k != "verContacto" else v for k, v in PERMISOS[a.rol].items()}
    return {"rol": a.rol, "usuario": a.usuario, "escritura": escritura, "permisos": permisos,
            "origenes": configurado(s), "indice": get_indice().estado()}


@router.get("/instalacion")
def instalacion():
    return _hacer(esquema.estado)


@router.post("/indice/recargar", status_code=202)
def recargar():
    get_indice().recargar_en_segundo_plano()
    return {"recargando": True}


@router.get("/catalogos")
def catalogos():
    datos = _hacer(lambda: get_catalogos().datos)
    return {**datos, "afiliaciones": _hacer(servicio.listar_afiliaciones), "sucursales": servicio.nombres_sucursales()}


# ------------------------------------------------------------------------------------------ lista
def _filtros(request: Request) -> dict:
    return dict(request.query_params)


@router.get("")
def listar(request: Request):
    return _hacer(consultas.listar, _filtros(request))


@router.get("/kpis")
def kpis():
    return _hacer(consultas.kpis)


@router.get("/exportar")
def exportar(request: Request):
    a = actor(request)
    filas = _hacer(consultas.exportar, _filtros(request))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["documento", "tarjeta", "nombres", "apellidos", "celular", "email", "ciudad", "consentimiento", "segmento",
                "venta_total", "ultima_compra", "estado"])
    cat = get_catalogos()
    for f in filas:
        w.writerow([f["documento"], f["tarjeta"], f["nombres"], f["apellidos"], f["celular"], f["email"], cat.nombre_ciudad(f["ciudadId"]),
                    f["consentimiento"], f["segmento"], round(f["ventaTotal"]), f["ultimaCompra"] or "", f["estado"]])
    log.info("Exportación de %s clientes por %s", len(filas), a.usuario)
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="clientes.csv"'})


@router.get("/calidad")
def calidad():
    return _hacer(consultas.calidad)


@router.get("/duplicados")
def duplicados():
    return _hacer(lambda: consultas.duplicados(servicio.descartados()))


class Ids(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=servicio.MAX_MASIVO)


@router.post("/duplicados/descartar", status_code=204)
def descartar(request: Request, body: Ids):
    _hacer(servicio.descartar_duplicado, body.ids, actor(request))


class Fusion(BaseModel):
    ganador: str
    perdedor: str
    tomar: list[str] = Field(default_factory=list, max_length=20)


@router.post("/fusionar")
def fusionar(request: Request, body: Fusion):
    return _hacer(servicio.fusionar, body.ganador, body.perdedor, body.tomar, actor(request))


class Masivo(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=servicio.MAX_MASIVO)
    accion: str = Field(pattern="^(club|etiqueta|desactivar)$")
    valor: str = Field("", max_length=40)


@router.post("/masivo")
def masivo(request: Request, body: Masivo):
    a = actor(request)
    if body.accion == "club":
        n = _hacer(servicio.asignar_club_masivo, body.ids, body.valor, a)
    elif body.accion == "etiqueta":
        n = _hacer(servicio.etiquetar_masivo, body.ids, body.valor, a)
    else:
        n = _hacer(servicio.desactivar_masivo, body.ids, a)
    return {"afectados": n}


class Importar(BaseModel):
    filas: list[dict[str, Any]] = Field(min_length=1, max_length=5000)


@router.post("/importar/validar")
def importar_validar(body: Importar):
    return _hacer(servicio.validar_import, body.filas)


@router.post("/importar/aplicar")
def importar_aplicar(request: Request, body: Importar):
    return _hacer(servicio.aplicar_import, body.filas, actor(request))


# ------------------------------------------------------------------------------------------ afiliaciones (catálogo)
@router.get("/afiliaciones")
def afiliaciones():
    return _hacer(servicio.listar_afiliaciones)


@router.post("/afiliaciones")
def guardar_afiliacion(request: Request, body: dict = Body(...)):
    return _hacer(servicio.guardar_afiliacion, body, actor(request))


@router.delete("/afiliaciones/{aid}")
def borrar_afiliacion(request: Request, aid: str):
    return _hacer(servicio.borrar_afiliacion, aid, actor(request))


# ------------------------------------------------------------------------------------------ alta
@router.post("", status_code=201)
def crear(request: Request, body: dict = Body(...)):
    return _hacer(servicio.crear, body, actor(request))


# ------------------------------------------------------------------------------------------ un cliente
@router.get("/{cid}")
def ficha(cid: str):
    return _hacer(servicio.ficha, cid)


class Patch(BaseModel):
    cambios: dict[str, Any]
    version: str | None = None


@router.patch("/{cid}")
def actualizar(request: Request, cid: str, body: Patch):
    return _hacer(servicio.actualizar, cid, body.cambios, body.version, actor(request))


class Estado(BaseModel):
    estado: str = Field(pattern="^(activo|inactivo)$")
    motivo: str = Field("", max_length=120)


@router.post("/{cid}/estado")
def estado(request: Request, cid: str, body: Estado):
    return _hacer(servicio.cambiar_estado, cid, body.estado, body.motivo, actor(request))


@router.post("/{cid}/anonimizar")
def anonimizar(request: Request, cid: str):
    return _hacer(servicio.anonimizar, cid, actor(request))


@router.delete("/{cid}", status_code=204)
def eliminar(request: Request, cid: str):
    _hacer(servicio.eliminar, cid, actor(request))


@router.get("/{cid}/referencias")
def referencias(cid: str):
    return _hacer(servicio.referencias, cid)


@router.get("/{cid}/compras")
def compras(cid: str, n: int = Query(20, ge=1, le=100)):
    return _hacer(servicio.compras, cid, n)


@router.get("/{cid}/cambios")
def cambios(cid: str):
    return _hacer(servicio.cambios, cid)


@router.get("/{cid}/campanas")
def campanas(cid: str):
    return _hacer(servicio.campanas, cid)


@router.post("/{cid}/mascotas")
def guardar_mascota(request: Request, cid: str, body: dict = Body(...)):
    return _hacer(servicio.guardar_mascota, cid, body, actor(request))


@router.delete("/{cid}/mascotas/{mid}")
def borrar_mascota(request: Request, cid: str, mid: str):
    return _hacer(servicio.borrar_mascota, cid, mid, actor(request))


@router.post("/{cid}/vehiculos")
def guardar_vehiculo(request: Request, cid: str, body: dict = Body(...)):
    return _hacer(servicio.guardar_vehiculo, cid, body, actor(request))


@router.delete("/{cid}/vehiculos/{vid}")
def borrar_vehiculo(request: Request, cid: str, vid: str):
    return _hacer(servicio.borrar_vehiculo, cid, vid, actor(request))


@router.post("/{cid}/afiliaciones")
def guardar_socio(request: Request, cid: str, body: dict = Body(...)):
    return _hacer(servicio.guardar_socio, cid, body, actor(request))


@router.delete("/{cid}/afiliaciones/{sid}")
def borrar_socio(request: Request, cid: str, sid: str):
    return _hacer(servicio.borrar_socio, cid, sid, actor(request))


@router.post("/{cid}/notas")
def agregar_nota(request: Request, cid: str, body: dict = Body(...)):
    return _hacer(servicio.agregar_nota, cid, body, actor(request))


@router.post("/{cid}/notas/{nid}/alternar")
def alternar_nota(request: Request, cid: str, nid: str):
    return _hacer(servicio.alternar_nota, cid, nid, actor(request))


@router.delete("/{cid}/notas/{nid}")
def borrar_nota(request: Request, cid: str, nid: str):
    return _hacer(servicio.borrar_nota, cid, nid, actor(request))
