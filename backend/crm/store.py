"""Persistencia transaccional del CRM (SQLite).

Por qué SQLite y no DuckDB para esto: las campañas son datos operativos (crear/editar/borrar filas
una a una, con integridad) → OLTP. DuckDB es columnar y está pensado para analítica sobre millones de
filas (ventas, clientes). Cada motor hace lo que mejor sabe. SQLite viene con Python, no requiere
instalar un servidor en Windows y soporta decenas de usuarios concurrentes con el modo WAL.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .config import Settings, get_settings
from .modules.automatizaciones.esquema import DDL as _DDL_AUTOMATIZACIONES

ESTADOS = ("borrador", "programada", "publicada")

# Estados: borrador → (programada →) publicada. «programada» = lista, con fecha y hora de publicación futuras.
_DDL_CAMPANA = """
CREATE TABLE IF NOT EXISTS {nombre} (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    objetivo      TEXT NOT NULL DEFAULT '',
    estado        TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'programada', 'publicada')),
    paso          INTEGER NOT NULL DEFAULT 1,
    productos     TEXT NOT NULL DEFAULT '[]',
    mensaje       TEXT NOT NULL DEFAULT '{}',
    segmentacion  TEXT NOT NULL DEFAULT '{}',
    audiencia     INTEGER NOT NULL DEFAULT 0,
    costo_estimado REAL NOT NULL DEFAULT 0,
    creada        TEXT NOT NULL,
    actualizada   TEXT NOT NULL,
    publicada_en  TEXT,
    eliminada_en  TEXT,
    programada_para TEXT,
    control_pct   INTEGER NOT NULL DEFAULT 0,
    vigencia_desde TEXT,
    vigencia_hasta TEXT
);
"""

_SCHEMA = _DDL_CAMPANA.replace("{nombre}", "campana") + """
CREATE INDEX IF NOT EXISTS ix_campana_estado ON campana (estado, eliminada_en);

-- Destinatarios de las campañas publicadas o programadas: permite excluir a quien ya recibió una campaña reciente
-- (evita saturar al cliente y gastar dos veces). grupo = 'control' → cliente reservado SIN envío para medir el efecto.
CREATE TABLE IF NOT EXISTS destinatario (
    campana_id TEXT NOT NULL REFERENCES campana (id),
    cliente_id TEXT NOT NULL,
    canales    TEXT NOT NULL,
    grupo      TEXT NOT NULL DEFAULT 'envio',
    PRIMARY KEY (campana_id, cliente_id)
);
CREATE INDEX IF NOT EXISTS ix_dest_cliente ON destinatario (cliente_id);

-- Bitácora de auditoría: quién hizo qué y cuándo.
CREATE TABLE IF NOT EXISTS auditoria (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    accion     TEXT NOT NULL,
    campana_id TEXT,
    detalle    TEXT,
    origen     TEXT
);
""" + _DDL_AUTOMATIZACIONES

_JSON_COLS = ("productos", "mensaje", "segmentacion")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _vig(vigencia: tuple[date, date] | None) -> tuple[str | None, str | None]:
    return (vigencia[0].isoformat(), vigencia[1].isoformat()) if vigencia else (None, None)


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(_SCHEMA)
        self._migrar()

    def _migrar(self) -> None:
        """Actualiza bases creadas con versiones anteriores (el CHECK de ``estado`` no admitía «programada»)."""
        sql = self._db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='campana'").fetchone()[0]
        if "'programada'" not in sql:
            viejas = [r[1] for r in self._db.execute("PRAGMA table_info(campana)")]
            self._db.execute("PRAGMA foreign_keys = OFF")  # requerido para reconstruir una tabla referenciada
            self._db.execute("BEGIN")
            try:
                self._db.execute(_DDL_CAMPANA.replace("{nombre}", "campana_nueva"))
                cols = ", ".join(viejas)
                self._db.execute(f"INSERT INTO campana_nueva ({cols}) SELECT {cols} FROM campana")  # nombres leídos del esquema
                self._db.execute("DROP TABLE campana")
                self._db.execute("ALTER TABLE campana_nueva RENAME TO campana")
                self._db.execute("CREATE INDEX IF NOT EXISTS ix_campana_estado ON campana (estado, eliminada_en)")
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            finally:
                self._db.execute("PRAGMA foreign_keys = ON")
        cols_campana = {r[1] for r in self._db.execute("PRAGMA table_info(campana)")}
        for col in ("vigencia_desde", "vigencia_hasta"):   # vigencia de la oferta (desde/hasta inclusive, AAAA-MM-DD)
            if col not in cols_campana:
                self._db.execute(f"ALTER TABLE campana ADD COLUMN {col} TEXT")
        if "grupo" not in {r[1] for r in self._db.execute("PRAGMA table_info(destinatario)")}:
            self._db.execute("ALTER TABLE destinatario ADD COLUMN grupo TEXT NOT NULL DEFAULT 'envio'")

    # ---------------------------------------------------------------- helpers
    def _fila(self, r: sqlite3.Row | None) -> dict | None:
        if r is None:
            return None
        d = dict(r)
        for c in _JSON_COLS:
            d[c] = json.loads(d[c]) if d.get(c) else ([] if c == "productos" else {})
        return d

    def auditar(self, accion: str, campana_id: str | None = None, detalle: str = "", origen: str = "") -> None:
        with self._lock:
            self._db.execute("INSERT INTO auditoria (ts, accion, campana_id, detalle, origen) VALUES (?,?,?,?,?)",
                             (_ahora(), accion, campana_id, detalle[:500], origen[:100]))

    # ---------------------------------------------------------------- campañas
    def crear(self, datos: dict[str, Any], origen: str = "") -> dict:
        cid, ahora = uuid.uuid4().hex[:12], _ahora()
        with self._lock:
            self._db.execute(
                "INSERT INTO campana (id, nombre, objetivo, paso, productos, mensaje, segmentacion, audiencia,"
                " costo_estimado, creada, actualizada) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (cid, datos["nombre"], datos.get("objetivo", ""), datos.get("paso", 1),
                 json.dumps(datos.get("productos", []), ensure_ascii=False),
                 json.dumps(datos.get("mensaje", {}), ensure_ascii=False),
                 json.dumps(datos.get("segmentacion", {}), ensure_ascii=False),
                 datos.get("audiencia", 0), datos.get("costo_estimado", 0), ahora, ahora))
        self.auditar("crear", cid, datos["nombre"], origen)
        return self.obtener(cid)  # type: ignore[return-value]

    def obtener(self, cid: str, incluir_eliminadas: bool = False) -> dict | None:
        sql = "SELECT * FROM campana WHERE id = ?" + ("" if incluir_eliminadas else " AND eliminada_en IS NULL")
        with self._lock:
            return self._fila(self._db.execute(sql, (cid,)).fetchone())

    def listar(self, estado: str | None = None, q: str | None = None) -> list[dict]:
        sql, params = "SELECT * FROM campana WHERE eliminada_en IS NULL", []
        if estado in ESTADOS:
            sql += " AND estado = ?"
            params.append(estado)
        if q:
            sql += " AND (nombre LIKE ? ESCAPE '\\' OR objetivo LIKE ? ESCAPE '\\')"
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            params += [like, like]
        sql += " ORDER BY actualizada DESC"
        with self._lock:
            return [self._fila(r) for r in self._db.execute(sql, params).fetchall()]  # type: ignore[misc]

    def actualizar(self, cid: str, datos: dict[str, Any], origen: str = "") -> dict | None:
        actual = self.obtener(cid)
        if actual is None:
            return None
        if actual["estado"] == "publicada":
            raise PermissionError("Una campaña publicada no se puede editar. Duplíquela para crear una nueva.")
        if actual["estado"] == "programada":
            raise PermissionError("Una campaña programada no se puede editar. Cancele la programación para volver a editarla.")
        sets, params = [], []
        for k in ("nombre", "objetivo", "paso", "audiencia", "costo_estimado"):
            if k in datos and datos[k] is not None:
                sets.append(f"{k} = ?")
                params.append(datos[k])
        for k in _JSON_COLS:
            if k in datos and datos[k] is not None:
                sets.append(f"{k} = ?")
                params.append(json.dumps(datos[k], ensure_ascii=False))
        sets.append("actualizada = ?")
        params += [_ahora(), cid]
        with self._lock:
            self._db.execute(f"UPDATE campana SET {', '.join(sets)} WHERE id = ?", params)  # columnas fijas, valores parametrizados
        self.auditar("editar", cid, ",".join(k for k in datos if datos[k] is not None), origen)
        return self.obtener(cid)

    def eliminar(self, cid: str, origen: str = "") -> bool:
        """Borrado lógico: la campaña desaparece de la lista pero queda en la base para auditoría."""
        with self._lock:
            cur = self._db.execute("UPDATE campana SET eliminada_en = ? WHERE id = ? AND eliminada_en IS NULL",
                                   (_ahora(), cid))
            ok = cur.rowcount > 0
        if ok:
            self.auditar("eliminar", cid, "", origen)
        return ok

    def _transaccion(self, sentencias) -> None:
        """Ejecuta varias sentencias de forma atómica (todo o nada). Debe llamarse con el cerrojo tomado."""
        self._db.execute("BEGIN")
        try:
            sentencias()
            self._db.execute("COMMIT")
        except BaseException:
            self._db.execute("ROLLBACK")
            raise

    def _guardar_destinatarios(self, cid: str, destinatarios: list[tuple[str, str]], control: set[str]) -> None:
        self._db.execute("DELETE FROM destinatario WHERE campana_id = ?", (cid,))
        self._db.executemany("INSERT OR IGNORE INTO destinatario (campana_id, cliente_id, canales, grupo) VALUES (?,?,?,?)",
                             [(cid, c, ch, "control" if c in control else "envio") for c, ch in destinatarios])

    def publicar(self, cid: str, destinatarios: list[tuple[str, str]], origen: str = "", control: set[str] | None = None,
                 control_pct: int = 0, vigencia: tuple[date, date] | None = None) -> dict | None:
        """Marca la campaña como publicada (simulado) y guarda sus destinatarios."""
        if self.obtener(cid) is None:
            return None
        ahora = _ahora()

        def hacer() -> None:
            self._db.execute("UPDATE campana SET estado='publicada', publicada_en=?, actualizada=?, paso=5, control_pct=?, "
                             "programada_para=NULL, vigencia_desde=?, vigencia_hasta=? WHERE id=?",
                             (ahora, ahora, control_pct, *_vig(vigencia), cid))
            self._guardar_destinatarios(cid, destinatarios, control or set())

        with self._lock:
            self._transaccion(hacer)
        self.auditar("publicar", cid, f"{len(destinatarios)} destinatarios (simulado)", origen)
        return self.obtener(cid)

    def programar(self, cid: str, cuando: datetime, destinatarios: list[tuple[str, str]], origen: str = "",
                  control: set[str] | None = None, control_pct: int = 0, vigencia: tuple[date, date] | None = None) -> dict | None:
        """Deja la campaña lista para publicarse sola en ``cuando`` y reserva a sus destinatarios."""
        if self.obtener(cid) is None:
            return None
        ahora, cuando_s = _ahora(), cuando.isoformat(timespec="seconds")

        def hacer() -> None:
            self._db.execute("UPDATE campana SET estado='programada', programada_para=?, actualizada=?, paso=5, control_pct=?, "
                             "vigencia_desde=?, vigencia_hasta=? WHERE id=?", (cuando_s, ahora, control_pct, *_vig(vigencia), cid))
            self._guardar_destinatarios(cid, destinatarios, control or set())

        with self._lock:
            self._transaccion(hacer)
        self.auditar("programar", cid, f"{cuando_s} · {len(destinatarios)} destinatarios", origen)
        return self.obtener(cid)

    def desprogramar(self, cid: str, origen: str = "") -> dict | None:
        """Cancela la programación: vuelve a borrador (editable) y libera a los destinatarios reservados."""
        actual = self.obtener(cid)
        if actual is None or actual["estado"] != "programada":
            return None
        ahora = _ahora()

        def hacer() -> None:
            self._db.execute("UPDATE campana SET estado='borrador', programada_para=NULL, actualizada=?, paso=4 WHERE id=?",
                             (ahora, cid))
            self._db.execute("DELETE FROM destinatario WHERE campana_id = ?", (cid,))

        with self._lock:
            self._transaccion(hacer)
        self.auditar("cancelar_programacion", cid, "", origen)
        return self.obtener(cid)

    def mensajes_guardados(self) -> list[str]:
        """El JSON del mensaje de todas las campañas (incluidas las eliminadas: se pueden consultar). Sirve para saber
        qué banners siguen en uso."""
        with self._lock:
            return [r[0] for r in self._db.execute("SELECT mensaje FROM campana").fetchall()]

    def huella(self) -> str:
        """Cambia cada vez que cambia una campaña, sus destinatarios o una automatización (clave de caché de la analítica)."""
        with self._lock:
            a = self._db.execute("SELECT COUNT(*), MAX(actualizada), MAX(eliminada_en) FROM campana").fetchone()
            b = self._db.execute("SELECT COUNT(*) FROM destinatario").fetchone()
            c = self._db.execute("SELECT COUNT(*), MAX(actualizada), MAX(eliminada_en) FROM automatizacion").fetchone()
            d = self._db.execute("SELECT COUNT(*) FROM automatizacion_envio").fetchone()
        return f"{a[0]}|{a[1]}|{a[2]}|{b[0]}|{c[0]}|{c[1]}|{c[2]}|{d[0]}"

    def destinatarios_de(self, cids: list[str]) -> dict[str, list]:
        """Destinatarios de varias campañas en columnas (campana_id, cliente_id, canales, grupo), listo para Arrow."""
        out: dict[str, list] = {"campana_id": [], "cliente_id": [], "canales": [], "grupo": []}
        if not cids:
            return out
        with self._lock:
            for i in range(0, len(cids), 500):
                lote = cids[i:i + 500]
                for r in self._db.execute(
                        f"SELECT campana_id, cliente_id, canales, grupo FROM destinatario WHERE campana_id IN ({','.join('?' * len(lote))})",
                        lote):
                    out["campana_id"].append(r[0])
                    out["cliente_id"].append(r[1])
                    out["canales"].append(r[2])
                    out["grupo"].append(r[3])
        return out

    def vencidas(self, ahora: datetime | None = None) -> list[dict]:
        """Campañas programadas cuya hora ya llegó (aún sin ejecutar)."""
        limite = (ahora or datetime.now()).isoformat(timespec="seconds")
        with self._lock:
            ids = [r[0] for r in self._db.execute(
                "SELECT id FROM campana WHERE estado='programada' AND eliminada_en IS NULL AND programada_para <= ?", (limite,))]
        return [c for c in (self.obtener(i) for i in ids) if c]

    def destinatarios(self, cid: str) -> list[tuple[str, str, str]]:
        """(cliente, canales, grupo) de una campaña."""
        with self._lock:
            return [tuple(r) for r in self._db.execute(
                "SELECT cliente_id, canales, grupo FROM destinatario WHERE campana_id = ? ORDER BY cliente_id", (cid,))]

    def depurar_destinatarios(self, cid: str, filas: list[tuple[str, str, str]], quitados: int, origen: str = "") -> None:
        """Reemplaza los destinatarios de una campaña programada por los que siguen siendo contactables (atómico)."""
        envio = sum(1 for _, _, g in filas if g == "envio")

        def hacer() -> None:
            self._db.execute("DELETE FROM destinatario WHERE campana_id = ?", (cid,))
            self._db.executemany("INSERT INTO destinatario (campana_id, cliente_id, canales, grupo) VALUES (?,?,?,?)",
                                 [(cid, c, ch, g) for c, ch, g in filas])
            self._db.execute("UPDATE campana SET audiencia=?, actualizada=? WHERE id=? AND estado='programada'",
                             (envio, _ahora(), cid))

        with self._lock:
            self._transaccion(hacer)
        self.auditar("depurar_destinatarios", cid, f"{quitados} destinatario(s) retirados por consentimiento/estado en el ERP", origen)

    def ejecutar_programadas(self, ahora: datetime | None = None) -> list[str]:
        """Publica (simulado) las campañas programadas cuya hora ya llegó. Idempotente: se puede llamar cada minuto."""
        limite = (ahora or datetime.now()).isoformat(timespec="seconds")
        with self._lock:
            ids = [r[0] for r in self._db.execute(
                "SELECT id FROM campana WHERE estado='programada' AND eliminada_en IS NULL AND programada_para <= ?", (limite,))]
            for cid in ids:
                self._db.execute("UPDATE campana SET estado='publicada', publicada_en=?, actualizada=? "
                                 "WHERE id=? AND estado='programada'", (limite, limite, cid))
        for cid in ids:
            self.auditar("publicar_programada", cid, "publicación programada ejecutada (simulado)", "planificador")
        return ids

    def conteo_destinatarios(self, cid: str) -> dict[str, int]:
        with self._lock:
            rows = self._db.execute("SELECT grupo, COUNT(*) FROM destinatario WHERE campana_id = ? GROUP BY grupo", (cid,)).fetchall()
        out = {"envio": 0, "control": 0}
        out.update({r[0]: r[1] for r in rows})
        return out

    def contactados_recientes(self, dias: int) -> set[str]:
        """Clientes que recibieron (o recibirán, si está programada) una campaña, o un mensaje de una automatización, en los
        últimos ``dias`` días. El grupo de control no cuenta: a esos clientes no se les envió nada."""
        with self._lock:
            rows = self._db.execute(
                "SELECT DISTINCT d.cliente_id FROM destinatario d JOIN campana c ON c.id = d.campana_id "
                "WHERE c.eliminada_en IS NULL AND d.grupo = 'envio' AND c.estado IN ('publicada', 'programada') "
                "AND replace(COALESCE(c.publicada_en, c.programada_para), 'T', ' ') >= datetime('now', 'localtime', ?) "
                "UNION SELECT cliente_id FROM automatizacion_envio WHERE fecha >= date('now', 'localtime', ?)",
                (f"-{int(dias)} days", f"-{int(dias)} days")).fetchall()
        return {r[0] for r in rows}

    def campanas_de_clientes(self, cliente_ids: list[str], limite: int = 50) -> list[dict]:
        """Campañas (publicadas o programadas) en las que estuvo cada cliente: para la ficha de Clientes 360°."""
        ids = [i for i in cliente_ids if i][:50]
        if not ids:
            return []
        with self._lock:
            rows = self._db.execute(
                "SELECT c.id, c.nombre, c.estado, COALESCE(c.publicada_en, c.programada_para, c.actualizada) AS fecha, "
                "d.canales, d.grupo FROM destinatario d JOIN campana c ON c.id = d.campana_id "
                f"WHERE c.eliminada_en IS NULL AND d.cliente_id IN ({','.join('?' * len(ids))}) "
                "ORDER BY fecha DESC LIMIT ?", (*ids, limite)).fetchall()
        return [dict(r) for r in rows]


_store: Store | None = None


def get_store(s: Settings | None = None) -> Store:
    global _store
    if _store is None:
        _store = Store((s or get_settings()).store_path)
    return _store
