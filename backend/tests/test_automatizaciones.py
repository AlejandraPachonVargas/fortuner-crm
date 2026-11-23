"""Automatizaciones: catálogo y límites, ediciones por periodo, reglas legales del motor, idempotencia y planificador.

Índice, warehouse y restricciones del ERP son de juguete (DuckDB en memoria); los resultados se calculan a mano.
"""

from __future__ import annotations

from datetime import date, datetime

import duckdb
import pytest

from crm.modules.automatizaciones import almacen as alm_mod
from crm.modules.automatizaciones import catalogo, motor
from crm.modules.clientes.consultas import RestriccionesContacto
from crm.modules.clientes.indice import Indice, IndiceNoListo
from crm.store import Store
from crm.warehouse import Warehouse

HOY = date(2026, 11, 18)


# ------------------------------------------------------------------------------------------ entorno de juguete
def _indice() -> Indice:
    ix = Indice()
    c = duckdb.connect()
    # documento, cumple, creado, celular/correo válidos, clubes, segmento, valor
    c.execute("""CREATE TABLE cli AS SELECT * FROM (VALUES
        ('1', 'Ana Ruiz',   '11-18', DATE '2025-01-10', TRUE,  TRUE,  '1',  'campeones', 900.0),
        ('2', 'Beto Paz',   '11-18', DATE '2025-01-10', TRUE,  FALSE, '',   'leales',    800.0),
        ('3', 'Caro Gil',   '11-18', DATE '2026-11-18', FALSE, FALSE, '',   'nuevos',    700.0),
        ('4', 'Dani Sol',   '11-18', DATE '2025-01-10', TRUE,  TRUE,  '',   'perdidos',  600.0),
        ('5', 'Eva Mar',    '11-18', DATE '2025-01-10', TRUE,  TRUE,  '2',  'leales',    500.0),
        ('6', 'Fito Luz',   '11-18', DATE '2026-11-18', TRUE,  TRUE,  '',   'nuevos',    400.0),
        ('7', 'Gina Paz',   '02-29', DATE '2025-01-10', TRUE,  TRUE,  '',   'leales',    300.0),
        ('8', 'Hugo Ros',   '12-01', DATE '2025-01-10', TRUE,  TRUE,  '',   'leales',    200.0)
        ) t(documento, nombres, cumple, creado, cel_ok, email_ok, clubes, segmento, venta_total)""")
    c.execute("""ALTER TABLE cli ADD COLUMN apellidos VARCHAR DEFAULT ''; ALTER TABLE cli ADD COLUMN generico BOOLEAN DEFAULT FALSE;
                 ALTER TABLE cli ADD COLUMN estado VARCHAR DEFAULT 'activo'""")
    ix._con = c
    ix.cargado_en = datetime.now()
    return ix


class WhFalso(Warehouse):
    def __init__(self, con):
        self._con_f = con

    def _conexion(self):
        return self._con_f


def _warehouse() -> WhFalso:
    c = duckdb.connect()
    c.execute("""CREATE TABLE cli_perfil AS SELECT * FROM (VALUES
        ('1', DATE '2026-11-11', 1, 50.0), ('2', DATE '2026-11-11', 2, 90.0), ('4', DATE '2026-11-10', 1, 70.0),
        ('5', DATE '2026-01-01', 12, 999.0)) t(cliente_id, primera_compra, visitas, venta_total)""")
    c.execute("""CREATE TABLE cli_rfm AS SELECT * FROM (VALUES
        ('5', 2.0, 40), ('2', 1.1, 10)) t(cliente_id, ratio_ciclo, dias_sin_compra)""")
    return WhFalso(c)


def _r(**kw) -> RestriccionesContacto:
    base = dict(conocidos={"1", "2", "3", "4", "5", "6", "7", "8"}, excluir=set(), sin_autorizacion=set(), menores=set(), canales_bloqueados={})
    base.update(kw)
    return RestriccionesContacto(**{k: (frozenset(v) if k != "canales_bloqueados" else v) for k, v in base.items()})


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    store = Store(tmp_path / "c.sqlite")
    alm = alm_mod.AutoAlmacen(store)
    ix, wh = _indice(), _warehouse()
    monkeypatch.setattr(alm_mod, "get_almacen", lambda: alm)
    monkeypatch.setattr(motor, "get_almacen", lambda: alm)
    monkeypatch.setattr(motor, "get_indice", lambda: ix)
    monkeypatch.setattr(motor, "get_warehouse", lambda: wh)
    estado = {"r": _r()}
    monkeypatch.setattr(motor, "restricciones_contacto", lambda: estado["r"])
    monkeypatch.setattr(motor, "canales_disponibles", lambda: estado.get("canales", {"whatsapp", "sms", "email"}))
    return store, alm, estado


def _cumple(alm, **params) -> dict:
    a = alm.crear("cumpleanos", hoy=HOY)
    if params:
        a = alm.actualizar(a["id"], {"params": params})
    return a


# ------------------------------------------------------------------------------------------ catálogo
def test_parametros_dentro_de_limites():
    p = catalogo.normalizar_params("cumpleanos", {"dias_antes": 99, "tope_diario": -5, "cooldown_dias": "x"})
    assert p == {"dias_antes": 7, "tope_diario": 1, "cooldown_dias": 330}
    assert catalogo.normalizar_params("reactivacion", {"umbral_ratio": 1.234})["umbral_ratio"] == 1.23


def test_oferta_valida_y_texto_por_defecto():
    assert catalogo.normalizar_oferta({"tipo": "descuento_pct", "valor": 15})["descripcion"] == "15% de descuento en tu compra"
    assert catalogo.normalizar_oferta({"tipo": "descuento_valor", "valor": 20000})["descripcion"] == "$20.000 de descuento en tu compra"
    with pytest.raises(ValueError):
        catalogo.normalizar_oferta({"tipo": "descuento_pct", "valor": 150})
    with pytest.raises(ValueError):
        catalogo.normalizar_oferta({"tipo": "regalo", "descripcion": "  "})   # un regalo hay que describirlo
    with pytest.raises(ValueError):
        catalogo.normalizar_hora("25:00")


def test_problemas_de_una_edicion_incompleta():
    ed = catalogo.edicion_por_defecto("cumpleanos", 2026)
    assert catalogo.problemas_edicion(ed) == []
    ed["canales"] = ["sms", "email"]
    ed["textos"]["email"]["asunto"] = ""
    assert catalogo.problemas_edicion({**ed, "textos": {**ed["textos"], "sms": {"texto": ""}}}) == ["Falta el mensaje de SMS.", "Falta el mensaje de correo."]


# ------------------------------------------------------------------------------------------ ediciones
def test_ediciones_por_periodo(entorno):
    _, alm, _ = entorno
    a = alm.crear("cumpleanos", hoy=HOY)
    e26 = a["ediciones"][0]
    with pytest.raises(ValueError, match="se cruzan"):
        alm.crear_edicion(a["id"], {**e26, "nombre": "Otra", "desde": "2026-06-01", "hasta": "2027-01-31"})
    e27 = alm.duplicar_edicion(a["id"], e26["id"])
    assert (e27["nombre"], e27["desde"], e27["hasta"]) == ("Cumpleaños 2027", "2027-01-01", "2027-12-31")
    e27 = alm.actualizar_edicion(a["id"], e27["id"], {**e27, "oferta": {"tipo": "regalo", "descripcion": "una torta de cumpleaños"}})
    a = alm.exigir(a["id"])
    assert alm.vigente(a, date(2026, 11, 18))["oferta"]["descripcion"] == "10% de descuento en tu compra"
    assert alm.vigente(a, date(2027, 3, 1))["oferta"]["descripcion"] == "una torta de cumpleaños"
    assert alm.vigente(a, date(2028, 3, 1)) is None
    assert alm_mod._mas_anios("2028-02-29", 1) == "2029-02-28"


def test_activar_exige_una_edicion_completa(entorno):
    _, alm, _ = entorno
    a = alm.crear("bienvenida", hoy=HOY)
    e = a["ediciones"][0]
    alm.actualizar_edicion(a["id"], e["id"], {**e, "canales": []})
    with pytest.raises(ValueError, match="edición completa"):
        alm.activar(a["id"], True)


# ------------------------------------------------------------------------------------------ motor: reglas
def test_ventana_y_cumpleanos_bisiesto():
    assert motor.dias_ventana(None, HOY) == [HOY]
    assert motor.dias_ventana("2026-11-16", HOY) == [date(2026, 11, 17), HOY]
    assert motor.dias_ventana("2026-11-01", HOY) == [date(2026, 11, 16), date(2026, 11, 17), HOY]   # recupera máximo 3 días
    assert motor.cumples_de([date(2027, 2, 28)], 0) == ["02-28", "02-29"]
    assert motor.cumples_de([date(2028, 2, 28)], 0) == ["02-28"]   # año bisiesto: el 29 tiene su día
    assert motor.cumples_de([date(2026, 11, 15)], 3) == ["11-18"]


def test_cumpleanos_aplica_todas_las_reglas(entorno):
    _, alm, estado = entorno
    estado["r"] = _r(excluir={"4"}, sin_autorizacion={"5"}, canales_bloqueados={"2": frozenset({"whatsapp", "sms"})})
    a = _cumple(alm)
    r = motor.ejecutar(a["id"], fecha=HOY, probar=True)
    # 1 elegible (whatsapp+email); 2 sin canal (solo celular y lo bloqueó); 3 sin canal; 4 BLOQUE; 5 sin autorización; 6 elegible
    assert r["candidatos"] == 6 and r["elegibles"] == 2
    assert r["excluidos"] == {"no_autoriza_o_bloqueado": 1, "sin_autorizacion": 1, "sin_canal": 2}
    assert r["por_canal"] == {"whatsapp": 2, "sms": 0, "email": 2}
    assert r["costo"] == 2 * (120 + 3) and r["vigencia_hasta"] == "2026-11-24"


def test_licor_excluye_menores_y_filtros(entorno):
    _, alm, estado = entorno
    estado["r"] = _r(menores={"6"})
    a = _cumple(alm)
    e = a["ediciones"][0]
    assert motor.ejecutar(a["id"], fecha=HOY, probar=True)["elegibles"] == 5           # sin licor el menor sí recibe
    alm.actualizar_edicion(a["id"], e["id"], {**e, "oferta": {"tipo": "producto", "descripcion": "una botella de vino de regalo"}})
    r = motor.ejecutar(a["id"], fecha=HOY, probar=True)
    assert r["excluye_menores"] and r["excluidos"]["menor_de_edad"] == 1
    alm.actualizar(a["id"], {"filtros": {"clubes": ["1", "2"]}})
    r = motor.ejecutar(a["id"], fecha=HOY, probar=True)
    assert r["elegibles"] == 2 and r["excluidos"]["fuera_de_filtros"] == 3            # solo socios de los clubes 1 y 2


def test_tope_diario_prioriza_mayor_valor(entorno):
    _, alm, _ = entorno
    a = _cumple(alm, tope_diario=2)
    r = motor.ejecutar(a["id"], fecha=HOY, probar=True)
    assert r["elegibles"] == 2 and r["excluidos"]["tope_diario"] == 3
    assert [m["cliente"] for m in r["muestra"]] == ["A*** R***", "B*** P***"]          # Ana (900) y Beto (800) primero


def test_ejecucion_real_no_duplica_y_marca_el_dia(entorno):
    store, alm, _ = entorno
    a = _cumple(alm)
    r1 = motor.ejecutar(a["id"], fecha=HOY)
    r2 = motor.ejecutar(a["id"], fecha=HOY)
    assert r1["enviados"] == 5 and r2["enviados"] == 0 and r2["excluidos"]["ya_recibio"] == 5
    assert alm.exigir(a["id"])["ultima_ref"] == HOY.isoformat()
    assert len(alm.ejecuciones(a["id"])) == 2
    # La ventana se cuenta desde hoy (reloj real) y HOY es una fecha fija: se amplía para que la prueba no dependa del día.
    assert {"1", "2", "4", "5", "6"} <= store.contactados_recientes((date.today() - HOY).days + 3)
    fila = alm.por_automatizacion(None, None)[0]                                       # para la Analítica de campañas
    assert (fila["envios"], fila["personas"], fila["costo"]) == (5, 5, 4 * (120 + 3) + 120)   # Beto no tiene correo


def test_sin_edicion_vigente_no_envia_y_registra_una_vez(entorno):
    _, alm, _ = entorno
    a = _cumple(alm)
    for _ in range(3):
        r = motor.ejecutar(a["id"], fecha=date(2030, 1, 1))
    assert r["estado"] == "sin_edicion" and len(alm.ejecuciones(a["id"])) == 1


def test_bienvenida_segunda_compra_y_reactivacion(entorno):
    _, alm, _ = entorno
    assert motor.ejecutar(alm.crear("bienvenida", hoy=HOY)["id"], fecha=HOY, probar=True)["candidatos"] == 2       # 3 y 6
    sc = alm.crear("segunda_compra", hoy=HOY)                                                                      # 7 días
    r = motor.ejecutar(sc["id"], fecha=HOY, probar=True)
    assert r["candidatos"] == 1 and r["elegibles"] == 1        # 1 compró el 11-nov y no volvió; 2 sí volvió (2 visitas)
    re_ = alm.crear("reactivacion", hoy=HOY)
    assert motor.ejecutar(re_["id"], fecha=HOY, probar=True)["candidatos"] == 1     # 5: 2 veces su ritmo; 2 no llega a 1,5


# ------------------------------------------------------------------------------------------ planificador
def test_planificador_respeta_hora_y_falla_cerrada(entorno, monkeypatch):
    _, alm, _ = entorno
    a = alm.activar(_cumple(alm)["id"], True)
    assert motor.ejecutar_pendientes(datetime(2026, 11, 18, 8, 59)) == []              # aún no son las 9:00
    monkeypatch.setattr(motor, "restricciones_contacto", lambda: (_ for _ in ()).throw(IndiceNoListo("cargando")))
    assert motor.ejecutar_pendientes(datetime(2026, 11, 18, 9, 0)) == []
    assert alm.exigir(a["id"])["ultima_ref"] is None                                   # no se marcó: se reintenta
    monkeypatch.setattr(motor, "restricciones_contacto", lambda: _r())
    assert motor.ejecutar_pendientes(datetime(2026, 11, 18, 9, 0)) == [a["id"]]
    assert motor.ejecutar_pendientes(datetime(2026, 11, 18, 15, 0)) == []              # ya se evaluó hoy


def test_sin_canales_configurados_no_envia(entorno):
    _, alm, estado = entorno
    a = _cumple(alm)
    estado["canales"] = set()                                    # nada configurado en Configuración
    r = motor.ejecutar(a["id"], fecha=HOY)
    assert r["estado"] == "sin_canal" and alm.ejecuciones(a["id"])[0]["estado"] == "sin_canal"
    estado["canales"] = {"email"}                               # solo correo: los demás canales se ignoran
    r = motor.ejecutar(a["id"], fecha=HOY, probar=True)
    assert r["estado"] == "ok" and r["por_canal"]["whatsapp"] == 0 and r["por_canal"]["sms"] == 0 and "aviso_canales" in r
