"""Conexiones de Clientes 360° con Advantage.

Tres orígenes, cada uno con su propósito y sus permisos:

* **ERP** (diccionario ``PUBLIDATA``): lectura de ``POSCLI`` y escritura *de registros* en ``POSCLI``. Jamás DDL.
* **CRM** (diccionario propio, ``ADS_CRM_DIRECTORY``): tablas ``CRM_*`` creadas por ``crm clientes instalar``.
* **Catálogos** (tablas libres de GANAPTOS): ``GANMASCOTA``, ``GANPROFE``, ``GANAUTOS``, ``GANBARRIO``, ``CIUDAD``, ``DPTOS``.
  Se abren en solo lectura y como tablas libres: si se agregaran a un diccionario, ADS las "ataría" a él y la aplicación
  de GANAPTOS ya no podría abrirlas. Por eso no se tocan.

Todas las escrituras pasan por ``ESCRITURA`` (un candado global): son pocas y así la secuencia
*releer → comparar → escribir → auditar* nunca se intercala entre dos usuarios.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Iterator

from ...config import Settings, get_settings

log = logging.getLogger("crm.clientes.ads")

ESCRITURA = threading.RLock()


class AdsNoConfigurado(RuntimeError):
    """Falta configuración en .env para este origen."""


def _base(s: Settings) -> str:
    return (f"DRIVER={{{s.ads_driver}}};ServerTypes={s.ads_server_types};"
            f"{f'CommType={s.ads_comm_type};' if s.ads_comm_type else ''}"
            "TrimTrailingSpaces=TRUE;LockMode=COMPATIBLE;ShowDeleted=FALSE;")


def cs_erp(s: Settings) -> str:
    if not s.ads_data_directory:
        raise AdsNoConfigurado("ADS_DATA_DIRECTORY no está configurado.")
    cs = _base(s) + f"DataDirectory={s.ads_data_directory};"
    if s.ads_user:
        cs += f"UID={s.ads_user};"
    if s.ads_password:
        cs += f"PWD={s.ads_password};"
    return cs


def cs_crm(s: Settings) -> str:
    if not s.ads_crm_directory:
        raise AdsNoConfigurado("ADS_CRM_DIRECTORY no está configurado (ruta del diccionario del CRM).")
    return _base(s) + f"DataDirectory={s.ads_crm_directory};UID={s.ads_crm_user};PWD={s.ads_crm_password};"


def cs_catalogos(s: Settings) -> str:
    if not s.ads_catalogos_directory:
        raise AdsNoConfigurado("ADS_CATALOGOS_DIRECTORY no está configurado (carpeta de GANAPTOS).")
    return _base(s) + f"DataDirectory={s.ads_catalogos_directory};TableType=ADT;"


@contextmanager
def conectar(cs: str, *, lectura: bool, transaccion: bool = False) -> Iterator["pyodbc.Connection"]:  # noqa: F821
    """Abre una conexión. Con ``transaccion`` el llamador hace commit; ante cualquier error se hace rollback."""
    import pyodbc

    con = pyodbc.connect(cs, autocommit=not transaccion, readonly=lectura, timeout=30)
    try:
        yield con
        if transaccion:
            con.commit()
    except Exception:
        if transaccion:
            try:
                con.rollback()
            except Exception:  # pragma: no cover - la conexión pudo haberse caído
                log.exception("Falló el rollback")
        raise
    finally:
        con.close()


def erp(lectura: bool = True, transaccion: bool = False, s: Settings | None = None):
    return conectar(cs_erp(s or get_settings()), lectura=lectura, transaccion=transaccion)


def crm(lectura: bool = False, transaccion: bool = False, s: Settings | None = None):
    return conectar(cs_crm(s or get_settings()), lectura=lectura, transaccion=transaccion)


def catalogos(s: Settings | None = None):
    return conectar(cs_catalogos(s or get_settings()), lectura=True)


def filas(con, sql: str, params: tuple | list = ()) -> list[dict]:
    cur = con.cursor()
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def configurado(s: Settings | None = None) -> dict[str, bool]:
    s = s or get_settings()
    return {"erp": bool(s.ads_data_directory), "crm": bool(s.ads_crm_directory and s.ads_crm_password),
            "catalogos": bool(s.ads_catalogos_directory)}
