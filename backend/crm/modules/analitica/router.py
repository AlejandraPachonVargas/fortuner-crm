"""API de Analítica. Solo lectura y solo cifras agregadas: cualquier rol con clave puede consultarla.

Los endpoints son funciones normales (no ``async``): FastAPI los corre en su grupo de hilos y un cálculo pesado no
congela al resto del servidor.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from ..clientes.conexion import AdsNoConfigurado
from ..clientes.indice import IndiceNoListo
from . import campanas, clientes

log = logging.getLogger("crm.analitica.api")
router = APIRouter(prefix="/api/analitica", tags=["analitica"])


def _err(e: Exception) -> HTTPException:
    if isinstance(e, IndiceNoListo):
        return HTTPException(503, str(e))
    if isinstance(e, AdsNoConfigurado):
        return HTTPException(503, f"La conexión con el ERP no está configurada: {e}")
    log.exception("Error en analítica")
    return HTTPException(500, "No se pudo calcular el tablero. Intente de nuevo en unos minutos.")


@router.get("/clientes")
def tablero_clientes(
    clubes: str = Query("", max_length=200), segmentos: str = Query("", max_length=300), ciclos: str = Query("", max_length=200),
    sexos: str = Query("", max_length=20), edades: str = Query("", max_length=200), ciudades: str = Query("", max_length=400),
    consentimiento: str = Query("", max_length=60),
):
    try:
        return clientes.tablero({"clubes": clubes, "segmentos": segmentos, "ciclos": ciclos, "sexos": sexos, "edades": edades,
                                 "ciudades": ciudades, "consentimiento": consentimiento})
    except Exception as e:
        raise _err(e) from None


@router.get("/clientes/opciones")
def opciones_clientes():
    try:
        return clientes.opciones()
    except Exception as e:
        raise _err(e) from None


@router.get("/campanas")
def tablero_campanas(desde: str = Query("", max_length=10), hasta: str = Query("", max_length=10),
                     estados: str = Query("", max_length=60)):
    try:
        return campanas.tablero({"desde": desde, "hasta": hasta, "estados": estados})
    except Exception as e:
        raise _err(e) from None
