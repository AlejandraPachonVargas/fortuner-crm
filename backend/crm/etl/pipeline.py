"""Pipeline ETL: ERP (ADVANTAGE) → Parquet (staging) → modelo analítico DuckDB (warehouse).

El warehouse se construye en un archivo nuevo y solo se publica (CURRENT) si todo salió bien:
la API sigue sirviendo la versión anterior mientras se carga la nueva.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import date, datetime
from importlib import resources
from pathlib import Path

import duckdb

from ..config import Settings, get_settings
from . import ads

log = logging.getLogger("crm.etl")

# Productos que no son venta (tarjeta regalo = anticipo de un cliente), igual que en fortuner-dashboards.
PRODUCTOS_NO_VENTA = ("209490200040291",)

_lock = threading.Lock()
_estado: dict = {"corriendo": False, "mensaje": "", "inicio": None, "fin": None, "error": None, "stats": {}}


def estado() -> dict:
    return dict(_estado)


def _sql(nombre: str) -> str:
    return resources.files("crm.etl").joinpath("sql", nombre).read_text(encoding="utf-8")


def construir_warehouse(s: Settings, staging: Path | None = None) -> Path:
    """Construye el modelo desde el staging y lo publica. Devuelve la ruta del archivo."""
    staging = staging or s.staging_dir
    s.warehouse_dir.mkdir(parents=True, exist_ok=True)
    (s.data_dir / "tmp").mkdir(parents=True, exist_ok=True)
    nombre = f"crm_{datetime.now():%Y%m%d_%H%M%S}.duckdb"
    destino = s.warehouse_dir / nombre
    tmp = s.warehouse_dir / (nombre + ".tmp")
    tmp.unlink(missing_ok=True)
    no_venta = ", ".join("'" + p.replace("'", "''") + "'" for p in PRODUCTOS_NO_VENTA)
    sql = _sql("model.sql").format(staging=staging.as_posix().replace("'", "''"), hoy=date.today().isoformat(),
                                   no_venta=no_venta)
    con = duckdb.connect(str(tmp))
    try:
        con.execute("SET temp_directory = ?", [str(s.data_dir / "tmp")])
        con.execute(sql)
        con.execute("CREATE TABLE meta AS SELECT CAST(now() AS TIMESTAMP) AS construido, CAST(? AS DATE) AS hoy, "
                    "(SELECT max(fecha) FROM venta) AS fecha_max, (SELECT min(fecha) FROM venta) AS fecha_min",
                    [date.today().isoformat()])
        con.execute("CHECKPOINT")
    except BaseException:
        con.close()
        tmp.unlink(missing_ok=True)
        raise
    con.close()
    tmp.replace(destino)
    (s.warehouse_dir / "CURRENT").write_text(nombre, encoding="utf-8")
    _limpiar_versiones(s.warehouse_dir, mantener=2)
    return destino


def _limpiar_versiones(carpeta: Path, mantener: int) -> None:
    vigente = (carpeta / "CURRENT").read_text(encoding="utf-8").strip()
    viejas = sorted(p for p in carpeta.glob("crm_*.duckdb") if p.name != vigente)
    sobran = viejas[: max(0, len(viejas) - (mantener - 1))]
    for p in sobran:
        try:
            p.unlink()
        except OSError:  # un lector aún la tiene abierta: se borrará en la siguiente carga
            pass


def ejecutar(s: Settings | None = None, *, full: bool = False, meses: int | None = None) -> dict:
    """Extracción + modelo. Una sola carga a la vez."""
    s = s or get_settings()
    if not _lock.acquire(blocking=False):
        raise RuntimeError("Ya hay una carga de datos en curso.")
    t0 = time.perf_counter()
    _estado.update(corriendo=True, mensaje="Iniciando…", inicio=datetime.now().isoformat(timespec="seconds"),
                   fin=None, error=None, stats={})
    try:
        s.data_dir.mkdir(parents=True, exist_ok=True)
        stats = ads.extract(s, s.staging_dir, meses=meses, full=full or not s.staging_dir.exists(),
                            progreso=lambda m: _estado.update(mensaje=m))
        _estado.update(mensaje="Construyendo el modelo analítico…", stats=stats)
        destino = construir_warehouse(s)
        resumen = {"filas": stats, "warehouse": destino.name, "segundos": round(time.perf_counter() - t0, 1)}
        with (s.warehouse_dir / "etl_historial.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"fin": datetime.now().isoformat(timespec="seconds"), **resumen}) + "\n")
        _estado.update(mensaje="Carga terminada", fin=datetime.now().isoformat(timespec="seconds"))
        return resumen
    except BaseException as e:
        log.exception("Falló la carga de datos")
        _estado.update(error=str(e)[:300], mensaje="La carga falló", fin=datetime.now().isoformat(timespec="seconds"))
        raise
    finally:
        _estado["corriendo"] = False
        _lock.release()
