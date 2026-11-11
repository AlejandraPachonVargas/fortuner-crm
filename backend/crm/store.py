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

_SCHEMA = """
CREATE TABLE IF NOT EXISTS campana (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    objetivo      TEXT NOT NULL DEFAULT '',
    estado        TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'publicada')),
    paso          INTEGER NOT NULL DEFAULT 1,
    productos     TEXT NOT NULL DEFAULT '[]',
    mensaje       TEXT NOT NULL DEFAULT '{}',
    segmentacion  TEXT NOT NULL DEFAULT '{}',
    audiencia     INTEGER NOT NULL DEFAULT 0,
    costo_estimado REAL NOT NULL DEFAULT 0,
    creada        TEXT NOT NULL,
    actualizada   TEXT NOT NULL,
    publicada_en  TEXT,
    eliminada_en  TEXT
);
CREATE INDEX IF NOT EXISTS ix_campana_estado ON campana (estado, eliminada_en);

-- Destinatarios de las campañas publicadas: permite excluir a quien ya recibió una campaña reciente
-- (evita saturar al cliente y gastar dos veces).
CREATE TABLE IF NOT EXISTS destinatario (
    campana_id TEXT NOT NULL REFERENCES campana (id),
    cliente_id TEXT NOT NULL,
    canales    TEXT NOT NULL,
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
        if estado in ("borrador", "publicada"):
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

    def publicar(self, cid: str, destinatarios: list[tuple[str, str]], origen: str = "") -> dict | None:
        """Marca la campaña como publicada (simulado) y guarda sus destinatarios."""
        if self.obtener(cid) is None:
            return None
        with self._lock:
            self._db.execute("BEGIN")
            try:
                self._db.execute("UPDATE campana SET estado='publicada', publicada_en=?, actualizada=?, paso=5 WHERE id=?",
                                 (_ahora(), _ahora(), cid))
                self._db.execute("DELETE FROM destinatario WHERE campana_id = ?", (cid,))
                self._db.executemany("INSERT OR IGNORE INTO destinatario (campana_id, cliente_id, canales) VALUES (?,?,?)",
                                     [(cid, c, ch) for c, ch in destinatarios])
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        self.auditar("publicar", cid, f"{len(destinatarios)} destinatarios (simulado)", origen)
        return self.obtener(cid)

    def contactados_recientes(self, dias: int) -> set[str]:
        """Clientes que recibieron una campaña publicada en los últimos ``dias`` días."""
        with self._lock:
            rows = self._db.execute(
                "SELECT DISTINCT d.cliente_id FROM destinatario d JOIN campana c ON c.id = d.campana_id "
                "WHERE c.eliminada_en IS NULL AND c.publicada_en >= datetime('now', 'localtime', ?)",
                (f"-{int(dias)} days",)).fetchall()
        return {r[0] for r in rows}


_store: Store | None = None


def get_store(s: Settings | None = None) -> Store:
    global _store
    if _store is None:
        _store = Store((s or get_settings()).store_path)
    return _store
