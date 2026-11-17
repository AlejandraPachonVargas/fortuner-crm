"""Acceso de solo lectura al warehouse DuckDB vigente.

Cada consulta usa su propio cursor sobre una conexión compartida de solo lectura. Si el ETL publica
un archivo nuevo (CURRENT cambia), la conexión se reabre sola. Todas las consultas son parametrizadas.
"""

from __future__ import annotations

import threading
from pathlib import Path

import duckdb

from .config import Settings, get_settings


class WarehouseNoDisponible(RuntimeError):
    pass


class Warehouse:
    def __init__(self, s: Settings | None = None) -> None:
        self.s = s or get_settings()
        self._con: duckdb.DuckDBPyConnection | None = None
        self._archivo: str | None = None
        self._lock = threading.Lock()

    def _vigente(self) -> Path:
        puntero = self.s.warehouse_dir / "CURRENT"
        if not puntero.exists():
            raise WarehouseNoDisponible("Aún no hay datos cargados del ERP. Ejecute la carga (crm etl) primero.")
        ruta = self.s.warehouse_dir / puntero.read_text(encoding="utf-8").strip()
        if not ruta.exists():
            raise WarehouseNoDisponible("El archivo del warehouse vigente no existe. Ejecute la carga de datos.")
        return ruta

    def disponible(self) -> bool:
        try:
            self._vigente()
            return True
        except WarehouseNoDisponible:
            return False

    def _conexion(self) -> duckdb.DuckDBPyConnection:
        ruta = self._vigente()
        with self._lock:
            if self._con is None or self._archivo != ruta.name:
                if self._con is not None:
                    self._con.close()
                self._con = duckdb.connect(str(ruta), read_only=True)
                self._con.execute("SET threads = 4")
                self._archivo = ruta.name
            return self._con

    def version(self) -> str:
        self._conexion()
        return self._archivo or ""

    def query(self, sql: str, params: list | tuple | None = None) -> list[dict]:
        cur = self._conexion().cursor()
        try:
            res = cur.execute(sql, params or [])
            cols = [d[0] for d in res.description]
            return [dict(zip(cols, r)) for r in res.fetchall()]
        finally:
            cur.close()

    def tuples(self, sql: str, params: list | tuple | None = None) -> tuple[list[str], list[tuple]]:
        """Filas como tuplas (más liviano que dicts para resultados grandes)."""
        cur = self._conexion().cursor()
        try:
            res = cur.execute(sql, params or [])
            return [d[0] for d in res.description], res.fetchall()
        finally:
            cur.close()

    def consultar_con(self, tablas: dict, consultas: dict[str, tuple[str, list]]) -> dict[str, list[dict]]:
        """Ejecuta varias consultas en un mismo cursor con tablas Arrow registradas (p. ej. la selección de clientes
        filtrada en Clientes 360°). El registro vive solo en ese cursor: no se mezcla con otras peticiones."""
        cur = self._conexion().cursor()
        try:
            for nombre, tabla in tablas.items():
                cur.register(nombre, tabla)
            out: dict[str, list[dict]] = {}
            for clave, (sql, params) in consultas.items():
                res = cur.execute(sql, params or [])
                cols = [d[0] for d in res.description]
                out[clave] = [dict(zip(cols, r)) for r in res.fetchall()]
            return out
        finally:
            cur.close()

    def scalar(self, sql: str, params: list | tuple | None = None):
        cur = self._conexion().cursor()
        try:
            r = cur.execute(sql, params or []).fetchone()
            return r[0] if r else None
        finally:
            cur.close()

    def cerrar(self) -> None:
        with self._lock:
            if self._con is not None:
                self._con.close()
                self._con = None


_wh: Warehouse | None = None


def get_warehouse() -> Warehouse:
    global _wh
    if _wh is None:
        _wh = Warehouse()
    return _wh
