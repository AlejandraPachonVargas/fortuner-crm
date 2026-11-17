"""Índice en memoria de Clientes 360° (DuckDB).

146 mil clientes no se pueden filtrar, ordenar y paginar consultando el ERP en cada clic (POSCLI no tiene índices para
la mayoría de esos filtros). El índice carga una vez ``POSCLI`` (solo lectura), las tablas ``CRM_*`` y las métricas de
compra del warehouse, y responde en milisegundos.

* Se recarga completo cada ``CRM_CLIENTES_REFRESCO_MIN`` minutos (recoge lo que la caja haya cambiado).
* Después de cada escritura del CRM se refresca **solo la fila tocada** (``refrescar``).
* La ficha de un cliente NO sale del índice: se relee en vivo del ERP antes de editar (ver ``servicio``).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime

import duckdb
import pyarrow as pa

from ...config import get_settings
from ...warehouse import WarehouseNoDisponible, get_warehouse
from . import conexion
from .mapeo import COLUMNAS_LECTURA, txt

log = logging.getLogger("crm.clientes.indice")


class IndiceNoListo(RuntimeError):
    pass


_COLS_POSCLI = ", ".join(COLUMNAS_LECTURA)

# Columnas derivadas (misma lógica que mapeo.py / validacion.ts). Se calculan en una vista sobre las tablas base.
_VISTA = r"""
CREATE OR REPLACE VIEW cli AS
WITH p AS (
  SELECT b.*,
         COUNT(*) OVER (PARTITION BY codcli) AS n_cod,
         row_number() OVER (PARTITION BY codcli ORDER BY rid) AS k_cod,
         regexp_replace(regexp_replace(COALESCE(telcelu, ''), '[^0-9]', '', 'g'), '^57(3[0-9]{9})$', '\1') AS cel_dig
  FROM base b
)
SELECT
  CASE WHEN p.n_cod > 1 THEN p.codcli || '~' || p.k_cod ELSE p.codcli END AS id,
  p.rid, p.codcli AS tarjeta, p.cedcli AS documento,
  CASE p.tipodoc WHEN '13' THEN 'CC' WHEN '22' THEN 'CE' WHEN '31' THEN 'NIT' WHEN '12' THEN 'TI' WHEN '41' THEN 'PAS'
       WHEN '11' THEN 'RC' ELSE CASE WHEN lower(COALESCE(p.tipcli, '')) = 'nit' THEN 'NIT' ELSE 'CC' END END AS tipo_doc,
  CASE WHEN COALESCE(p.nombre, '') = '' AND COALESCE(p.apellido, '') = '' THEN COALESCE(p.nomcli, '')
       ELSE trim(COALESCE(p.nombre, '') || ' ' || COALESCE(p.nombre2, '')) END AS nombres,
  CASE WHEN COALESCE(p.nombre, '') = '' AND COALESCE(p.apellido, '') = '' THEN ''
       ELSE trim(COALESCE(p.apellido, '') || ' ' || COALESCE(p.apellido2, '')) END AS apellidos,
  p.nombre AS nombre1, p.apellido AS apellido1,
  COALESCE(p.telcelu, '') AS celular, lower(COALESCE(p.email, '')) AS email,
  regexp_matches(p.cel_dig, '^3[0-9]{9}$') AS cel_ok,
  regexp_matches(lower(trim(COALESCE(p.email, ''))), '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$')
    AND NOT starts_with(lower(trim(COALESCE(p.email, ''))), 'facturaelectronica') AS email_ok,
  CASE WHEN regexp_matches(p.cel_dig, '^3[0-9]{9}$') THEN p.cel_dig END AS cel_norm,
  CASE p.infoley WHEN TRUE THEN 'si' WHEN FALSE THEN 'no' ELSE 'sin_registro' END AS consentimiento,
  p.infotex AS autoriza_sms, p.infoelec AS autoriza_email, p.infowas AS autoriza_whatsapp,
  p.bloque AS sin_campanas,
  p.nac, p.cumple, COALESCE(p.sexo, '') AS sexo,
  COALESCE(p.ciudad, '') AS ciudad_id, COALESCE(p.codbarrio, '') AS barrio_id, COALESCE(p.dircli1, '') AS direccion,
  p.fechai AS creado, p.puntos, p.sucursal,
  COALESCE(e.estado, 'activo') AS estado, e.fusionado_en, COALESCE(e.etiquetas, '') AS etiquetas,
  COALESCE(m.n, 0) AS n_mascotas, COALESCE(m.tipos, '') AS mascota_tipos, COALESCE(m.nombres, '') AS mascota_nombres,
  COALESCE(s.clubes, '') AS clubes, COALESCE(v.n, 0) AS n_vehiculos,
  w.visitas, w.venta_total, w.ticket_prom, w.ultima_compra, w.intervalo_dias,
  COALESCE(w.segmento, 'sin_compras') AS segmento, COALESCE(w.ciclo, 'sin_historial') AS ciclo,
  -- Registro genérico del POS (CONSUMIDOR FINAL, documento 2222222222…): no es una persona, no se edita desde el CRM.
  (length(p.cedcli) >= 5 AND replace(p.cedcli, left(p.cedcli, 1), '') = '') OR p.busca LIKE '%consumidor final%' AS generico,
  p.n_cod = 1 AND COALESCE(e.estado, 'activo') <> 'anonimizado' AND p.codcli <> ''
    AND NOT ((length(p.cedcli) >= 5 AND replace(p.cedcli, left(p.cedcli, 1), '') = '') OR p.busca LIKE '%consumidor final%') AS editable,
  p.busca,
  -- completitud 0-100 (mismos pesos que validacion.ts)
  (CASE WHEN length(COALESCE(p.nombre, '')) > 1 AND length(COALESCE(p.apellido, '')) > 1 THEN 15 ELSE 0 END
   + CASE WHEN regexp_matches(p.cel_dig, '^3[0-9]{9}$') THEN 20 ELSE 0 END
   + CASE WHEN regexp_matches(lower(trim(COALESCE(p.email, ''))), '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$')
          AND NOT starts_with(lower(trim(COALESCE(p.email, ''))), 'facturaelectronica') THEN 15 ELSE 0 END
   + CASE WHEN p.infoley IS NOT NULL THEN 15 ELSE 0 END
   + CASE WHEN p.nac IS NOT NULL THEN 10 WHEN p.cumple IS NOT NULL THEN 5 ELSE 0 END
   + CASE WHEN COALESCE(p.ciudad, '') <> '' THEN 10 ELSE 0 END
   + CASE WHEN COALESCE(p.codbarrio, '') <> '' THEN 5 ELSE 0 END
   + CASE WHEN length(COALESCE(p.dircli1, '')) > 4 THEN 5 ELSE 0 END
   + CASE WHEN p.sexo IN ('F', 'M') THEN 5 ELSE 0 END) AS completitud
FROM p
LEFT JOIN ext e ON e.codcli = p.codcli AND p.n_cod = 1
LEFT JOIN masc m ON m.codcli = p.codcli AND p.n_cod = 1
LEFT JOIN socios s ON s.codcli = p.codcli AND p.n_cod = 1
LEFT JOIN vehi v ON v.codcli = p.codcli AND p.n_cod = 1
LEFT JOIN metr w ON w.cliente_id = p.cedcli
"""


def _a_fecha(v):
    try:
        n = int(float(v))
        return date(n // 10000, n // 100 % 100, n % 100) if 19000101 <= n <= 21001231 else None
    except (TypeError, ValueError):
        return None


def _filas_base(rows: list[tuple], nombres: list[str]) -> pa.Table:
    from .mapeo import logico, nacimiento_de, norm_busqueda

    idx = {n: i for i, n in enumerate(nombres)}
    g = lambda r, c: r[idx[c]]  # noqa: E731
    cols: dict[str, list] = {k: [] for k in (
        "rid", "codcli", "cedcli", "tipodoc", "tipcli", "nomcli", "nombre", "nombre2", "apellido", "apellido2", "sexo",
        "nac", "cumple", "telcelu", "email", "ciudad", "codbarrio", "dircli1", "infoley", "infotex", "infoelec", "infowas",
        "bloque", "fechai", "puntos", "sucursal", "busca")}
    for r in rows:
        nac, cumple = nacimiento_de(g(r, "FECHAN"), g(r, "ANON"))
        n = [txt(g(r, c)).upper() for c in ("NOMBRE", "NOMBRE2", "APELLIDO", "APELLIDO2")]
        sexo = txt(g(r, "SEXO")).upper()
        cols["rid"].append(txt(g(r, "ROWID")))
        cols["codcli"].append(txt(g(r, "CODCLI")))
        cols["cedcli"].append(txt(g(r, "CEDCLI")))
        cols["tipodoc"].append(txt(g(r, "TIPODOC")))
        cols["tipcli"].append(txt(g(r, "TIPCLI")))
        cols["nomcli"].append(txt(g(r, "NOMCLI")))
        for k, v in zip(("nombre", "nombre2", "apellido", "apellido2"), n):
            cols[k].append(v)
        cols["sexo"].append(sexo if sexo in ("F", "M") else None)
        cols["nac"].append(date.fromisoformat(nac) if nac else None)
        cols["cumple"].append(cumple)
        cols["telcelu"].append(txt(g(r, "TELCELU")))
        cols["email"].append(txt(g(r, "EMAIL")))
        cols["ciudad"].append(txt(g(r, "CIUDAD")))
        cols["codbarrio"].append(txt(g(r, "CODBARRIO")))
        cols["dircli1"].append(txt(g(r, "DIRCLI1")))
        for k, c in (("infoley", "INFOLEY"), ("infotex", "INFOTEX"), ("infoelec", "INFOELEC"), ("infowas", "INFOWAS")):
            cols[k].append(logico(g(r, c)))
        cols["bloque"].append(g(r, "BLOQUE") is not None)   # cualquier valor (en el ERP solo existe false) = sin campañas
        cols["fechai"].append(_a_fecha(g(r, "FECHAI")))
        try:
            cols["puntos"].append(float(g(r, "PUNTOS") or 0))
        except (TypeError, ValueError):
            cols["puntos"].append(0.0)
        cols["sucursal"].append(txt(g(r, "SUCURSAL")))
        nombre = " ".join(p for p in n if p) or txt(g(r, "NOMCLI"))
        cols["busca"].append(norm_busqueda(f"{nombre} {txt(g(r, 'NOMCLI'))}"))
    tipos = {"nac": pa.date32(), "fechai": pa.date32(), "puntos": pa.float64(),
             **{k: pa.bool_() for k in ("infoley", "infotex", "infoelec", "infowas", "bloque")}}
    return pa.table({k: pa.array(v, type=tipos.get(k, pa.string())) for k, v in cols.items()})


def _leer_poscli(where: str = "", params: tuple = ()) -> pa.Table:
    with conexion.erp(lectura=True) as con:
        cur = con.cursor()
        cur.execute(f"SELECT ROWID, {_COLS_POSCLI} FROM POSCLI {where}", params)
        nombres = [d[0].upper() for d in cur.description]
        rows = []
        while True:
            lote = cur.fetchmany(20_000)
            if not lote:
                break
            rows.extend(lote)
    return _filas_base(rows, nombres)


def _leer_crm(codclis: list[str] | None = None) -> dict[str, pa.Table]:
    filtro, params = "", ()
    if codclis is not None:
        if not codclis:
            codclis = ["\u0000"]
        filtro = " WHERE CODCLI IN (" + ",".join("?" * len(codclis)) + ")"
        params = tuple(codclis)
    out = {}
    with conexion.crm(lectura=True) as con:
        def t(sql: str, nombres: list[str], tipos: dict | None = None) -> pa.Table:
            cur = con.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall()
            tipos = tipos or {}
            return pa.table({n: pa.array([(txt(r[i]) if tipos.get(n) is None else r[i]) for r in rows], type=tipos.get(n, pa.string()))
                             for i, n in enumerate(nombres)})
        out["ext"] = t(f"SELECT CODCLI, ESTADO, FUSIONADO_EN, ETIQUETAS FROM CRM_CLIENTE_EXT{filtro}",
                       ["codcli", "estado", "fusionado_en", "etiquetas"])
        out["masc_raw"] = t(f"SELECT CODCLI, TIPO_COD, NOMBRE FROM CRM_MASCOTA{filtro}{' AND' if filtro else ' WHERE'} ACTIVA = TRUE",
                            ["codcli", "tipo", "nombre"])
        out["socios_raw"] = t(f"SELECT CODCLI, AFILIACION_ID FROM CRM_AFILIACION_CLIENTE{filtro}{' AND' if filtro else ' WHERE'} "
                              "ESTADO = 'activa'", ["codcli", "afiliacion_id"], {"afiliacion_id": pa.int64()})
        out["vehi_raw"] = t(f"SELECT CODCLI FROM CRM_VEHICULO{filtro}", ["codcli"])
    return out


def _leer_metricas() -> pa.Table | None:
    try:
        wh = get_warehouse()
        cols, rows = wh.tuples(
            "SELECT p.cliente_id, p.visitas::BIGINT, p.venta_total::DOUBLE, p.ticket_prom::DOUBLE, p.ultima_compra, "
            "p.intervalo_dias::DOUBLE, r.segmento_rfm, r.estado_ciclo FROM cli_perfil p LEFT JOIN cli_rfm r USING (cliente_id)")
    except WarehouseNoDisponible:
        return None
    except Exception:
        log.exception("No se pudieron leer las métricas del warehouse")
        return None
    nombres = ["cliente_id", "visitas", "venta_total", "ticket_prom", "ultima_compra", "intervalo_dias", "segmento", "ciclo"]
    tipos = [pa.string(), pa.int64(), pa.float64(), pa.float64(), pa.date32(), pa.float64(), pa.string(), pa.string()]
    return pa.table({n: pa.array([r[i] for r in rows], type=t) for i, (n, t) in enumerate(zip(nombres, tipos))})


_METR_VACIA = pa.table({"cliente_id": pa.array([], pa.string()), "visitas": pa.array([], pa.int64()),
                        "venta_total": pa.array([], pa.float64()), "ticket_prom": pa.array([], pa.float64()),
                        "ultima_compra": pa.array([], pa.date32()), "intervalo_dias": pa.array([], pa.float64()),
                        "segmento": pa.array([], pa.string()), "ciclo": pa.array([], pa.string())})


class Indice:
    def __init__(self) -> None:
        self._con: duckdb.DuckDBPyConnection | None = None
        self._lock = threading.RLock()
        self._cargando = False
        self.cargado_en: datetime | None = None
        self.error: str | None = None
        self.segundos: float | None = None
        self.metricas_hasta: str | None = None

    # ------------------------------------------------------------------ carga
    def _construir(self) -> duckdb.DuckDBPyConnection:
        t0 = time.perf_counter()
        base = _leer_poscli()
        crm = _leer_crm()
        metr = _leer_metricas()
        con = duckdb.connect()
        con.execute("SET threads = 4")
        con.register("base_a", base)
        con.execute("CREATE TABLE base AS SELECT * FROM base_a")
        con.unregister("base_a")
        self._cargar_crm(con, crm)
        con.register("metr_a", metr if metr is not None else _METR_VACIA)
        con.execute("CREATE TABLE metr AS SELECT * FROM metr_a")
        con.unregister("metr_a")
        con.execute(_VISTA)
        self.segundos = round(time.perf_counter() - t0, 1)
        try:
            self.metricas_hasta = str(get_warehouse().scalar("SELECT fecha_max FROM meta")) if metr is not None else None
        except Exception:
            self.metricas_hasta = None
        return con

    @staticmethod
    def _cargar_crm(con, crm: dict[str, pa.Table], solo: list[str] | None = None) -> None:
        for nombre, tabla in crm.items():
            con.register(f"{nombre}_a", tabla)
        sql = {
            "ext": "SELECT codcli, estado, NULLIF(fusionado_en, '') AS fusionado_en, etiquetas FROM ext_a",
            "masc": "SELECT codcli, COUNT(*) AS n, string_agg(tipo, ',') AS tipos, lower(string_agg(nombre, ' ')) AS nombres FROM masc_raw_a GROUP BY codcli",
            "socios": "SELECT codcli, string_agg(CAST(afiliacion_id AS VARCHAR), ',') AS clubes FROM socios_raw_a GROUP BY codcli",
            "vehi": "SELECT codcli, COUNT(*) AS n FROM vehi_raw_a GROUP BY codcli",
        }
        for tabla, q in sql.items():
            if solo is None:
                con.execute(f"CREATE OR REPLACE TABLE {tabla} AS {q}")
            else:
                marcas = ",".join("?" * len(solo))
                con.execute(f"DELETE FROM {tabla} WHERE codcli IN ({marcas})", solo)
                con.execute(f"INSERT INTO {tabla} {q}")
        for nombre in crm:
            con.unregister(f"{nombre}_a")

    def recargar(self) -> None:
        if self._cargando:
            return
        self._cargando = True
        try:
            con = self._construir()
            with self._lock:
                viejo, self._con = self._con, con
                self.cargado_en = datetime.now()
                self.error = None
            if viejo is not None:
                viejo.close()
            log.info("Índice de clientes cargado en %s s", self.segundos)
        except Exception as e:
            self.error = str(e)
            log.exception("No se pudo cargar el índice de clientes")
        finally:
            self._cargando = False

    def recargar_en_segundo_plano(self) -> None:
        if not self._cargando:
            threading.Thread(target=self.recargar, name="indice-clientes", daemon=True).start()

    def refrescar(self, codclis: list[str]) -> None:
        """Relee del ERP y del CRM solo estos clientes (tras una escritura)."""
        codclis = sorted({c for c in codclis if c})
        if not codclis or self._con is None:
            return
        marcas = ",".join("?" * len(codclis))
        base = _leer_poscli(f"WHERE CODCLI IN ({marcas})", tuple(codclis))
        crm = _leer_crm(codclis)
        with self._lock:
            con = self._con
            con.execute(f"DELETE FROM base WHERE codcli IN ({marcas})", codclis)
            con.register("nuevo_a", base)
            con.execute("INSERT INTO base SELECT * FROM nuevo_a")
            con.unregister("nuevo_a")
            self._cargar_crm(con, crm, solo=codclis)

    # ------------------------------------------------------------------ consultas
    def estado(self) -> dict:
        return {"listo": self._con is not None, "cargando": self._cargando, "error": self.error,
                "cargado_en": self.cargado_en.isoformat(timespec="seconds") if self.cargado_en else None,
                "segundos": self.segundos, "metricas_hasta": self.metricas_hasta}

    def _cursor(self):
        if self._con is None:
            if self.error:
                raise IndiceNoListo(f"No se pudo cargar la lista de clientes del ERP: {self.error}")
            raise IndiceNoListo("Cargando los clientes del ERP… (tarda unos segundos la primera vez)")
        if self.cargado_en and (datetime.now() - self.cargado_en).total_seconds() > get_settings().clientes_refresco_min * 60:
            self.recargar_en_segundo_plano()
        with self._lock:
            return self._con.cursor()

    def query(self, sql: str, params: list | tuple = ()) -> list[dict]:
        cur = self._cursor()
        try:
            res = cur.execute(sql, list(params))
            cols = [d[0] for d in res.description]
            return [dict(zip(cols, r)) for r in res.fetchall()]
        finally:
            cur.close()

    def scalar(self, sql: str, params: list | tuple = ()):
        r = self.query(sql, params)
        return next(iter(r[0].values())) if r else None


_indice: Indice | None = None


def get_indice() -> Indice:
    global _indice
    if _indice is None:
        _indice = Indice()
    return _indice
