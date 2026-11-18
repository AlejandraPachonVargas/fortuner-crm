"""Tablas SQLite de Automatizaciones. Sin importaciones: ``store.py`` las crea junto con las de Campañas."""

DDL = """
-- Una automatización = una regla de disparo (qué evento, a qué hora, límites). Lo que se ofrece vive en las ediciones.
CREATE TABLE IF NOT EXISTS automatizacion (
    id           TEXT PRIMARY KEY,
    tipo         TEXT NOT NULL CHECK (tipo IN ('cumpleanos', 'bienvenida', 'segunda_compra', 'reactivacion')),
    nombre       TEXT NOT NULL,
    activa       INTEGER NOT NULL DEFAULT 0,
    hora         TEXT NOT NULL DEFAULT '09:00',
    params       TEXT NOT NULL DEFAULT '{}',
    filtros      TEXT NOT NULL DEFAULT '{}',
    creada       TEXT NOT NULL,
    actualizada  TEXT NOT NULL,
    activada_en  TEXT,
    ultima_ref   TEXT,
    eliminada_en TEXT
);

-- Ediciones: qué se ofrece y qué se dice en un periodo (p. ej. «Cumpleaños 2026» del 1-ene al 31-dic).
CREATE TABLE IF NOT EXISTS automatizacion_edicion (
    id                TEXT PRIMARY KEY,
    automatizacion_id TEXT NOT NULL REFERENCES automatizacion (id),
    nombre            TEXT NOT NULL,
    desde             TEXT NOT NULL,
    hasta             TEXT NOT NULL,
    oferta            TEXT NOT NULL DEFAULT '{}',
    validez_dias      INTEGER NOT NULL DEFAULT 7,
    canales           TEXT NOT NULL DEFAULT '[]',
    textos            TEXT NOT NULL DEFAULT '{}',
    creada            TEXT NOT NULL,
    actualizada       TEXT NOT NULL,
    eliminada_en      TEXT
);
CREATE INDEX IF NOT EXISTS ix_autoed_auto ON automatizacion_edicion (automatizacion_id, eliminada_en);

-- Cada vez que una automatización se evalúa (sola a su hora, o a mano) queda una fila con lo que pasó.
CREATE TABLE IF NOT EXISTS automatizacion_ejecucion (
    id                TEXT PRIMARY KEY,
    automatizacion_id TEXT NOT NULL REFERENCES automatizacion (id),
    fecha             TEXT NOT NULL,
    inicio            TEXT NOT NULL,
    fin               TEXT,
    origen            TEXT NOT NULL DEFAULT 'planificador',
    estado            TEXT NOT NULL,
    edicion_id        TEXT,
    candidatos        INTEGER NOT NULL DEFAULT 0,
    enviados          INTEGER NOT NULL DEFAULT 0,
    costo             REAL NOT NULL DEFAULT 0,
    detalle           TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_autoej_auto ON automatizacion_ejecucion (automatizacion_id, inicio);

-- Un envío por cliente y día (hoy simulado). Sirve para no repetirle el mismo mensaje y para medir resultados.
CREATE TABLE IF NOT EXISTS automatizacion_envio (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    automatizacion_id TEXT NOT NULL REFERENCES automatizacion (id),
    edicion_id        TEXT NOT NULL,
    cliente_id        TEXT NOT NULL,
    fecha             TEXT NOT NULL,
    canales           TEXT NOT NULL,
    vigencia_desde    TEXT NOT NULL,
    vigencia_hasta    TEXT NOT NULL,
    ejecucion_id      TEXT,
    simulado          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_autoenv_dia ON automatizacion_envio (automatizacion_id, cliente_id, fecha);
CREATE INDEX IF NOT EXISTS ix_autoenv_fecha ON automatizacion_envio (fecha);
CREATE INDEX IF NOT EXISTS ix_autoenv_cliente ON automatizacion_envio (cliente_id);
"""
