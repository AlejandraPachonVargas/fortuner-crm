"""Pruebas de programación de publicaciones, grupo de control y migración de la base de campañas."""

from __future__ import annotations

import sqlite3
from collections import Counter
from datetime import datetime, timedelta

import pytest

from crm.modules.campanas import programacion, segmentos
from crm.store import Store

AHORA = datetime(2026, 11, 12, 10, 0, 0)


# ------------------------------------------------------------------ validación de fechas
def test_parsear_acepta_fecha_futura_y_quita_microsegundos():
    d = programacion.parsear("2026-11-14T16:30", AHORA)
    assert d == datetime(2026, 11, 14, 16, 30)


@pytest.mark.parametrize("texto", ["", "mañana", "2026-13-45T99:00", "2026-11-12T09:00", "2026-11-12T10:01", "2028-01-01T10:00"])
def test_parsear_rechaza_invalidas_pasadas_o_muy_lejanas(texto):
    with pytest.raises(programacion.FechaInvalida):
        programacion.parsear(texto, AHORA)


def test_parsear_convierte_zona_horaria_a_hora_local():
    d = programacion.parsear("2026-11-14T16:30:00+00:00", AHORA)
    assert d.tzinfo is None


def test_avisos_horario_sms_entre_semana_y_fin_de_semana():
    assert programacion.avisos_horario(datetime(2026, 11, 13, 10, 0), ["sms"]) == []          # viernes 10:00
    assert programacion.avisos_horario(datetime(2026, 11, 13, 20, 0), ["sms"])                # viernes 20:00
    assert programacion.avisos_horario(datetime(2026, 11, 14, 16, 0), ["sms"])                # sábado 16:00 (> 15:00)
    assert programacion.avisos_horario(datetime(2026, 11, 14, 10, 0), ["sms"]) == []          # sábado 10:00
    assert programacion.avisos_horario(datetime(2026, 11, 13, 18, 0), ["email"]) == []        # el correo no tiene esa ventana
    assert programacion.avisos_horario(datetime(2026, 11, 13, 23, 30), ["email"])             # pero de madrugada no conviene


# ------------------------------------------------------------------ grupo de control
def test_control_es_determinista_y_respeta_el_porcentaje():
    ids = [str(i) for i in range(5000)]
    a = {c for c in ids if programacion.en_control("camp1", c, 10)}
    b = {c for c in ids if programacion.en_control("camp1", c, 10)}
    assert a == b
    assert 0.08 < len(a) / len(ids) < 0.12          # ≈10 %
    assert not any(programacion.en_control("camp1", c, 0) for c in ids)
    assert a != {c for c in ids if programacion.en_control("camp2", c, 10)}   # cada campaña sortea distinto


# ------------------------------------------------------------------ momento de compra
def test_momento_de_compra_sugiere_mejor_dia_y_franja():
    m = segmentos.momento_de_compra(Counter({5: 10, 6: 30, 1: 3}), Counter({"noche": 20, "tarde": 5}))
    assert m["mejor_dia"] == 6 and m["mejor_franja"] == "noche"
    assert [d["n"] for d in m["dias"]] == [3, 0, 0, 0, 10, 30, 0]
    assert segmentos.momento_de_compra(Counter(), Counter())["mejor_dia"] is None


def test_resumen_incluye_momento_cuando_hay_columnas():
    cols = ["celular", "email_valido", "segmento_rfm", "sexo", "banda_edad", "estado_ciclo", "ciudad", "puntaje",
            "dia_semana_pref", "franja_pref"]
    rows = [("3150000001", False, "campeones", "F", "25-34", "en_ventana", "X", 90.0, 5, "noche"),
            ("3150000002", False, "campeones", "F", "25-34", "en_ventana", "X", 80.0, 5, "tarde")]
    f = segmentos.normalizar({"productos": ["1"], "canales": ["sms"]})
    assert segmentos.resumen(cols, rows, f, 10)["momento"]["mejor_dia"] == 5


# ------------------------------------------------------------------ persistencia: programar / ejecutar / cancelar
def _campana(s: Store) -> str:
    return s.crear({"nombre": "A"})["id"]


def test_programar_reserva_destinatarios_y_no_se_edita(tmp_path):
    s = Store(tmp_path / "t.sqlite")
    cid = _campana(s)
    c = s.programar(cid, AHORA + timedelta(days=2), [("1", "sms"), ("2", "sms"), ("3", "sms")], control={"3"}, control_pct=10)
    assert c["estado"] == "programada" and c["programada_para"] == "2026-11-14T10:00:00" and c["control_pct"] == 10
    with pytest.raises(PermissionError):
        s.actualizar(cid, {"nombre": "otro"})
    assert s.conteo_destinatarios(cid) == {"envio": 2, "control": 1}
    # Quien ya está reservado por una campaña programada no se vuelve a contactar; el grupo de control sí queda libre.
    assert s.contactados_recientes(30) == {"1", "2"}


def test_ejecutar_programadas_solo_publica_las_vencidas(tmp_path):
    s = Store(tmp_path / "t.sqlite")
    a, b = _campana(s), _campana(s)
    s.programar(a, AHORA + timedelta(hours=1), [("1", "sms")])
    s.programar(b, AHORA + timedelta(days=3), [("2", "sms")])
    assert s.ejecutar_programadas(AHORA) == []
    assert s.ejecutar_programadas(AHORA + timedelta(hours=2)) == [a]
    assert s.obtener(a)["estado"] == "publicada" and s.obtener(a)["publicada_en"]
    assert s.obtener(b)["estado"] == "programada"
    assert s.ejecutar_programadas(AHORA + timedelta(hours=2)) == []          # idempotente
    assert [c["id"] for c in s.listar(estado="programada")] == [b]


def test_cancelar_programacion_vuelve_a_borrador_y_libera(tmp_path):
    s = Store(tmp_path / "t.sqlite")
    cid = _campana(s)
    s.programar(cid, AHORA + timedelta(days=1), [("1", "sms")])
    c = s.desprogramar(cid)
    assert c["estado"] == "borrador" and c["programada_para"] is None
    assert s.contactados_recientes(30) == set() and s.conteo_destinatarios(cid)["envio"] == 0
    assert s.desprogramar(cid) is None                                       # ya no está programada
    s.actualizar(cid, {"nombre": "editable otra vez"})


def test_eliminar_campana_programada_libera_destinatarios(tmp_path):
    s = Store(tmp_path / "t.sqlite")
    cid = _campana(s)
    s.programar(cid, AHORA + timedelta(days=1), [("1", "sms")])
    s.eliminar(cid)
    assert s.contactados_recientes(30) == set()


# ------------------------------------------------------------------ migración de bases anteriores
def test_migra_base_antigua_sin_perder_datos(tmp_path):
    ruta = tmp_path / "vieja.sqlite"
    db = sqlite3.connect(ruta)
    db.executescript("""
        CREATE TABLE campana (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, objetivo TEXT NOT NULL DEFAULT '',
            estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'publicada')), paso INTEGER NOT NULL DEFAULT 1,
            productos TEXT NOT NULL DEFAULT '[]', mensaje TEXT NOT NULL DEFAULT '{}', segmentacion TEXT NOT NULL DEFAULT '{}',
            audiencia INTEGER NOT NULL DEFAULT 0, costo_estimado REAL NOT NULL DEFAULT 0, creada TEXT NOT NULL,
            actualizada TEXT NOT NULL, publicada_en TEXT, eliminada_en TEXT);
        CREATE TABLE destinatario (campana_id TEXT NOT NULL REFERENCES campana (id), cliente_id TEXT NOT NULL,
            canales TEXT NOT NULL, PRIMARY KEY (campana_id, cliente_id));
        INSERT INTO campana (id, nombre, estado, creada, actualizada, publicada_en, audiencia)
            VALUES ('abc', 'Vieja', 'publicada', '2026-11-01T10:00:00', '2026-11-01T10:00:00', '2026-11-01T10:00:00', 7);
        INSERT INTO destinatario VALUES ('abc', '99', 'sms');
    """)
    db.commit()
    db.close()

    s = Store(ruta)
    c = s.obtener("abc")
    assert c["nombre"] == "Vieja" and c["estado"] == "publicada" and c["audiencia"] == 7 and c["control_pct"] == 0
    assert s.conteo_destinatarios("abc") == {"envio": 1, "control": 0}
    nueva = _campana(s)
    s.programar(nueva, AHORA + timedelta(days=1), [("5", "sms")])           # ahora el CHECK admite «programada»
    assert s.obtener(nueva)["estado"] == "programada"
    Store(ruta)                                                              # reabrir no vuelve a migrar ni falla
