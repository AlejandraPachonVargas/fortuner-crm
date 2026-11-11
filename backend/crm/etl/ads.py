"""Extracción desde Advantage Database Server 10.10 (ERP FORTUNER, diccionario PUBLIDATA) vía ODBC.

Misma estrategia probada en fortuner-dashboards, pero acotada a lo que necesita el CRM:

* Solo las tablas y columnas que alimentan Campañas (productos, clientes, líneas de venta).
* Lectura por lotes directo a Apache Arrow → Parquet (zstd): memoria acotada.
* Esquema Parquet FIJO por tabla (montos DECIMAL, fechas DATE, resto texto).
* Tablas transaccionales particionadas por mes (``staging/<tabla>/periodo=AAAAMM.parquet``).
* Solo lectura y modo compartido: nunca bloquea al ERP (los POS siguen facturando).
* Reintentos con espera exponencial (el enlace con el servidor ADS puede cortar cursores largos).
"""

from __future__ import annotations

import calendar
import logging
import re
import shutil
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Iterator

import pyarrow as pa
import pyarrow.parquet as pq

from ..config import Settings

log = logging.getLogger("crm.etl.ads")

ProgresoFn = Callable[[str], None]


class ExtraccionError(RuntimeError):
    """La extracción no cuadra (valor imposible de convertir, conteo distinto al del ERP…)."""


DEC_PRECISION, DEC_ESCALA = 24, 6
_TIPOS = {"str": pa.string(), "dec": pa.decimal128(DEC_PRECISION, DEC_ESCALA), "dbl": pa.float64(), "date": pa.date32()}


@dataclass(frozen=True)
class SourceTable:
    name: str
    columns: tuple[str, ...]
    date_column: str | None = None
    description: str = ""
    optional_columns: tuple[str, ...] = field(default_factory=tuple)
    types: dict = field(default_factory=dict, hash=False, compare=False)
    order_by: tuple[str, ...] = field(default_factory=tuple)

    def tipo(self, col: str) -> str:
        return self.types.get(col.upper(), "str")


def _t(dec: str = "", dbl: str = "", date_: str = "") -> dict:
    out = {c: "dec" for c in dec.split()}
    out.update({c: "dbl" for c in dbl.split()})
    out.update({c: "date" for c in date_.split()})
    return out


# Catálogo de tablas del ERP que alimentan el CRM (Campañas).
TABLES: tuple[SourceTable, ...] = (
    SourceTable("TIDBODE", ("CODIGO", "NOMBRE"), description="Sucursales / bodegas", optional_columns=("OCEDI",),
                order_by=("CODIGO",)),
    SourceTable("TIDTPRO", ("CODIGO", "NOMBRE"), description="Tipos de producto", order_by=("CODIGO",)),
    SourceTable("TIDTAB", ("CTABCOD", "CTABDES"), description="Catálogo de familias, departamentos, grupos y secciones",
                order_by=("CTABCOD",)),
    SourceTable(
        "TIDSAL",
        ("INSUC", "INBODEGA", "INARTIC", "INEAN", "INNOMBRE", "INMARCA", "INTIPO", "INSALDO00",
         "INVRULTC", "INVRVENTA1", "INPROVEE", "INACTIVO", "INESTADO", "INBLOQUEO"),
        description="Maestro de productos y saldos por bodega",
        types=_t(dec="INSALDO00 INVRULTC INVRVENTA1"),
        order_by=("INARTIC", "INSUC", "INBODEGA"),
    ),
    SourceTable(
        "POSCLI",
        ("CODCLI", "CEDCLI", "NOMCLI", "EMAIL", "TELCELU", "CIUCLI", "BARRIO1", "SEXO", "FECHAN", "FECHAI",
         "INFOLEY", "CLUBVINO", "CLUBSALUD", "CLUBMASCO", "CLUBPARRI", "BLOQUE"),
        description="Clientes POS",
        types=_t(date_="FECHAN FECHAI"),
        order_by=("CODCLI",),
    ),
    SourceTable(
        "FADITE",
        ("IFFACT", "IFSUCUR", "IFARTIC", "IFCLIENTE", "IFCANT", "IFCOSTO", "IFVLRBRU", "IFVLRDES", "IFVLRNET",
         "IFFECHA", "IFHORA", "IFFAMILIA", "IFDPTO", "IFGRUPO", "IFSECCION", "IFNULO"),
        date_column="IFFECHA",
        description="Detalle de facturas (líneas de venta)",
        types=_t(dec="IFCANT IFCOSTO IFVLRBRU IFVLRDES IFVLRNET", date_="IFFECHA"),
    ),
)

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _ident(nombre: str) -> str:
    if not _IDENT.fullmatch(nombre):
        raise ValueError(f"Identificador no permitido: {nombre!r}")
    return nombre


# ------------------------------------------------------------------ conversión a Arrow
def _a_texto(v):
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, Decimal):
        return str(int(v)) if v == v.to_integral_value() else format(v, "f")
    if isinstance(v, (bytes, bytearray)):
        return bytes(v).decode("latin-1")
    return str(v)


_CUANTO = Decimal(1).scaleb(-DEC_ESCALA)
_MAX_DEC = Decimal(10) ** (DEC_PRECISION - DEC_ESCALA)


def _a_decimal(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
    if isinstance(v, bool):
        v = int(v)
    d = Decimal(repr(v)) if isinstance(v, float) else Decimal(v)
    if not d.is_finite() or abs(d) >= _MAX_DEC:
        raise ValueError("fuera de rango")
    return d.quantize(_CUANTO, rounding=ROUND_HALF_EVEN)


def _a_double(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
    return float(v)


def _a_fecha(v):
    """Fecha del ERP: DATE, AAAAMMDD numérico o texto. Lo que no es fecha (0, vacío) queda NULL."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(int(v)) if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool) else str(v).strip()
    try:
        if re.fullmatch(r"\d{8}", s):
            return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
        if re.match(r"\d{4}-\d{2}-\d{2}", s):
            return date.fromisoformat(s[:10])
    except ValueError:
        pass
    return None


_CONV = {"str": _a_texto, "dec": _a_decimal, "dbl": _a_double, "date": _a_fecha}


def _schema(table: SourceTable, nombres: list[str]) -> pa.Schema:
    return pa.schema([(n, _TIPOS[table.tipo(n)]) for n in nombres])


def _columna(table: SourceTable, nombre: str, valores: tuple, tipo: pa.DataType) -> pa.Array:
    conv = _CONV[table.tipo(nombre)]
    out = []
    for v in valores:
        try:
            out.append(conv(v))
        except (ValueError, TypeError, InvalidOperation, OverflowError):
            raise ExtraccionError(f"{table.name}.{nombre}: el valor {v!r} no cabe en el tipo fijo {tipo}") from None
    return pa.array(out, type=tipo)


def _lotes(cursor, table: SourceTable, fetch_size: int) -> Iterator[pa.Table]:
    nombres = [d[0] for d in cursor.description]
    schema = _schema(table, nombres)
    while True:
        rows = cursor.fetchmany(fetch_size)
        if not rows:
            break
        cols = list(zip(*rows))
        arrays = [_columna(table, n, c, schema.field(n).type) for n, c in zip(nombres, cols)]
        yield pa.Table.from_arrays(arrays, schema=schema)


# ------------------------------------------------------------------ conexión
def connection_string(s: Settings) -> str:
    if not s.ads_data_directory:
        raise ValueError("ADS_DATA_DIRECTORY no está configurado en .env")
    cs = (
        f"DRIVER={{{s.ads_driver}}};DataDirectory={s.ads_data_directory};"
        f"ServerTypes={s.ads_server_types};{f'CommType={s.ads_comm_type};' if s.ads_comm_type else ''}TrimTrailingSpaces=TRUE;"
        "LockMode=COMPATIBLE;ShowDeleted=FALSE;"
    )
    if s.ads_user:
        cs += f"UID={s.ads_user};"
    if s.ads_password:
        cs += f"PWD={s.ads_password};"
    return cs


@contextmanager
def ads_connection(s: Settings) -> Iterator["pyodbc.Connection"]:  # noqa: F821
    import pyodbc

    con = pyodbc.connect(connection_string(s), autocommit=True, readonly=True, timeout=30)
    try:
        yield con
    finally:
        con.close()


def probar_conexion(s: Settings) -> dict:
    """Prueba de humo de solo lectura: conecta y cuenta filas de dos maestros."""
    t0 = time.perf_counter()
    with ads_connection(s) as con:
        cur = con.cursor()
        out = {}
        for tabla in ("POSCLI", "TIDBODE"):
            cur.execute(f"SELECT COUNT(*) FROM {_ident(tabla)}")
            out[tabla] = int(cur.fetchone()[0])
    return {"ok": True, "filas": out, "segundos": round(time.perf_counter() - t0, 2)}


def _retry(s: Settings, label: str, fn, attempts: int = 4):
    import pyodbc

    for i in range(1, attempts + 1):
        try:
            with ads_connection(s) as con:
                return fn(con)
        except pyodbc.Error as e:
            if i == attempts:
                raise
            wait = 5 * 2 ** (i - 1)
            log.warning("  %s: error de comunicación (%s). Reintento %d/%d en %ds", label, str(e)[:120], i, attempts - 1, wait)
            time.sleep(wait)


def _write_query(con, table: SourceTable, sql: str, params: list, out: Path, fetch_size: int) -> int:
    cur = con.cursor()
    cur.execute(sql, params)
    names = [d[0] for d in cur.description] if cur.description else []
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    writer: pq.ParquetWriter | None = None
    total = 0
    try:
        for t in _lotes(cur, table, fetch_size):
            if writer is None:
                writer = pq.ParquetWriter(tmp, t.schema, compression="zstd")
            writer.write_table(t)
            total += t.num_rows
    except BaseException:
        if writer is not None:
            writer.close()
        tmp.unlink(missing_ok=True)
        raise
    finally:
        cur.close()
    if writer is not None:
        writer.close()
    else:
        pq.write_table(_schema(table, names).empty_table(), tmp, compression="zstd")
    tmp.replace(out)
    return total


def _write_paged(s: Settings, table: SourceTable, out: Path, page: int) -> int:
    """Tabla completa en páginas cortas (TOP n START AT m ... ORDER BY clave), cada una con reintento."""
    columnas = table.columns
    if table.optional_columns:
        def existentes(con) -> set[str]:
            cur = con.cursor()
            cur.execute(f"SELECT TOP 1 * FROM {_ident(table.name)}")
            return {d[0].upper() for d in cur.description}

        hay = _retry(s, table.name, existentes)
        columnas += tuple(c for c in table.optional_columns if c.upper() in hay)
    cols = ", ".join(_ident(c) for c in columnas)
    claves = [c for c in table.order_by if c in columnas]
    orden = ", ".join(_ident(c) for c in claves + [c for c in columnas if c not in claves])
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    writer: pq.ParquetWriter | None = None
    total = 0
    try:
        while True:
            sql = f"SELECT TOP {int(page)} START AT {int(total) + 1} {cols} FROM {_ident(table.name)} ORDER BY {orden}"

            def fetch(con, sql=sql):
                cur = con.cursor()
                cur.execute(sql)
                return list(_lotes(cur, table, page))

            n = 0
            for t in _retry(s, table.name, fetch):
                if writer is None:
                    writer = pq.ParquetWriter(tmp, t.schema, compression="zstd")
                writer.write_table(t)
                n += t.num_rows
            total += n
            if n < page:
                break
        if writer is not None:
            writer.close()
            writer = None
        else:
            pq.write_table(_schema(table, list(columnas)).empty_table(), tmp, compression="zstd")
    except BaseException:
        if writer is not None:
            writer.close()
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(out)
    return total


# ------------------------------------------------------------------ periodos
def _yyyymm(v) -> str:
    if isinstance(v, (date, datetime)):
        return f"{v.year:04d}{v.month:02d}"
    s = re.sub(r"\D", "", str(int(v)) if isinstance(v, (int, float)) else str(v))
    return s[:6] if len(s) >= 6 else ""


def _bounds(sample):
    def bounds(p: str) -> list:
        y, m = int(p[:4]), int(p[4:6])
        last = calendar.monthrange(y, m)[1]
        if isinstance(sample, datetime):
            return [datetime(y, m, 1), datetime(y, m, last, 23, 59, 59)]
        if isinstance(sample, date):
            return [date(y, m, 1), date(y, m, last)]
        if isinstance(sample, str):
            return [f"{p}01", f"{p}{last:02d}"]
        return [int(f"{p}01"), int(f"{p}{last:02d}")]

    return bounds


def _periodos(con, t: SourceTable, meses: int) -> tuple[list[str], Callable]:
    """Meses (AAAAMM) con datos en el ERP, limitados a los últimos ``meses`` meses."""
    cur = con.cursor()
    cur.execute(f"SELECT MIN({_ident(t.date_column)}), MAX({_ident(t.date_column)}) FROM {_ident(t.name)} "
                f"WHERE {_ident(t.date_column)} > 0")
    lo, hi = cur.fetchone()
    cur.execute(f"SELECT TOP 1 {_ident(t.date_column)} FROM {_ident(t.name)} WHERE {_ident(t.date_column)} IS NOT NULL")
    row = cur.fetchone()
    cur.close()
    if lo is None:
        return [], _bounds(0)
    hoy = date.today()
    piso_y, piso_m = hoy.year, hoy.month - meses + 1
    while piso_m <= 0:
        piso_y, piso_m = piso_y - 1, piso_m + 12
    piso = f"{piso_y:04d}{piso_m:02d}"
    techo = f"{hoy.year + 1:04d}{hoy.month:02d}"
    lo_s, hi_s = max(_yyyymm(lo), piso), min(_yyyymm(hi), techo)
    out, y, m = [], int(lo_s[:4]), int(lo_s[4:6])
    while f"{y:04d}{m:02d}" <= hi_s:
        out.append(f"{y:04d}{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out, _bounds(row[0] if row else 0)


# ------------------------------------------------------------------ orquestación
def extract(s: Settings, staging: Path, *, meses: int | None = None, full: bool = False,
            progreso: ProgresoFn | None = None) -> dict[str, int]:
    """Extrae las tablas a ``staging``. Devuelve filas por tabla.

    * ``full=True``  : trae todo el histórico (hasta ``meses`` meses) a ``staging.nuevo`` y, solo si todo salió
      bien, lo intercambia por el vigente (si falla, lo vigente queda intacto).
    * ``full=False`` : refresca maestros y los 2 últimos meses de ventas sobre el staging vigente.
    """
    meses = meses or s.etl_meses
    say = progreso or (lambda m: None)
    nuevo = staging.with_name(staging.name + ".nuevo")
    shutil.rmtree(nuevo, ignore_errors=True)
    destino = nuevo if full or not staging.exists() else staging
    if destino is nuevo:
        nuevo.mkdir(parents=True, exist_ok=True)
    stats: dict[str, int] = {}
    try:
        for t in TABLES:
            t0 = time.perf_counter()
            cols = ", ".join(_ident(c) for c in t.columns)
            carpeta = destino / t.name.lower()
            if t.date_column is None:
                say(f"Extrayendo {t.name}: {t.description}")
                n = _write_paged(s, t, carpeta / "full.parquet", s.ads_page_size)
            else:
                periodos, bounds = _retry(s, t.name, lambda con, t=t: _periodos(con, t, meses))
                if destino is staging:  # incremental: solo los últimos 2 meses
                    periodos = periodos[-2:]
                n = 0
                for i, p in enumerate(periodos, 1):
                    say(f"Extrayendo {t.name} {p} ({i}/{len(periodos)})")
                    n += _retry(s, f"{t.name} {p}", lambda con, p=p, t=t: _write_query(
                        con, t,
                        f"SELECT {cols} FROM {_ident(t.name)} WHERE {_ident(t.date_column)} >= ? AND {_ident(t.date_column)} <= ?",
                        bounds(p), carpeta / f"periodo={p}.parquet", s.ads_fetch_size))
            stats[t.name] = n
            log.info("  %-8s %12s filas  (%.1fs)", t.name, f"{n:,}", time.perf_counter() - t0)
    except BaseException:
        if destino is nuevo:
            shutil.rmtree(nuevo, ignore_errors=True)
        raise
    if destino is nuevo:
        viejo = staging.with_name(staging.name + ".viejo")
        shutil.rmtree(viejo, ignore_errors=True)
        if staging.exists():
            staging.rename(viejo)
        try:
            nuevo.rename(staging)
        except OSError:
            if viejo.exists() and not staging.exists():
                viejo.rename(staging)
            raise
        shutil.rmtree(viejo, ignore_errors=True)
    return stats
