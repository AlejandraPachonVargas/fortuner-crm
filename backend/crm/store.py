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
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import Settings, get_settings

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
    control_pct   INTEGER NOT NULL DEFAULT 0
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
"""

_JSON_COLS = ("productos", "mensaje", "segmentacion")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


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
                 control_pct: int = 0) -> dict | None:
        """Marca la campaña como publicada (simulado) y guarda sus destinatarios."""
        if self.obtener(cid) is None:
            return None
        ahora = _ahora()

        def hacer() -> None:
            self._db.execute("UPDATE campana SET estado='publicada', publicada_en=?, actualizada=?, paso=5, control_pct=?, "
                             "programada_para=NULL WHERE id=?", (ahora, ahora, control_pct, cid))
            self._guardar_destinatarios(cid, destinatarios, control or set())

        with self._lock:
            self._transaccion(hacer)
        self.auditar("publicar", cid, f"{len(destinatarios)} destinatarios (simulado)", origen)
        return self.obtener(cid)

    def programar(self, cid: str, cuando: datetime, destinatarios: list[tuple[str, str]], origen: str = "",
                  control: set[str] | None = None, control_pct: int = 0) -> dict | None:
        """Deja la campaña lista para publicarse sola en ``cuando`` y reserva a sus destinatarios."""
        if self.obtener(cid) is None:
            return None
        ahora, cuando_s = _ahora(), cuando.isoformat(timespec="seconds")

        def hacer() -> None:
            self._db.execute("UPDATE campana SET estado='programada', programada_para=?, actualizada=?, paso=5, control_pct=? "
                             "WHERE id=?", (cuando_s, ahora, control_pct, cid))
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
        """Clientes que recibieron (o recibirán, si está programada) una campaña en los últimos ``dias`` días.
        El grupo de control no cuenta: a esos clientes no se les envió nada."""
        with self._lock:
            rows = self._db.execute(
                "SELECT DISTINCT d.cliente_id FROM destinatario d JOIN campana c ON c.id = d.campana_id "
                "WHERE c.eliminada_en IS NULL AND d.grupo = 'envio' AND c.estado IN ('publicada', 'programada') "
                "AND replace(COALESCE(c.publicada_en, c.programada_para), 'T', ' ') >= datetime('now', 'localtime', ?)",
                (f"-{int(dias)} days",)).fetchall()
        return {r[0] for r in rows}


_store: Store | None = None


def get_store(s: Settings | None = None) -> Store:
    global _store
    if _store is None:
        _store = Store((s or get_settings()).store_path)
    return _store
