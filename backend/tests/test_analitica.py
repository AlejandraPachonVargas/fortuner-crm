"""Analítica: filtros con lista blanca, cifras del tablero de clientes y medición de efectividad de campañas.

Se usa un índice y un warehouse de juguete en DuckDB (sin ERP) con datos pequeños cuyo resultado se calcula a mano.
"""

from __future__ import annotations

from datetime import date, datetime

import duckdb
import pytest

from crm.modules.analitica import campanas as an_camp
from crm.modules.analitica import clientes as an_cli
from crm.modules.analitica import comun
from crm.modules.clientes.indice import Indice
from crm.store import Store
from crm.warehouse import Warehouse

CORTE = date(2026, 9, 30)


class WhFalso(Warehouse):
    """Warehouse en memoria con la misma interfaz (query, consultar_con, version)."""

    def __init__(self, con: duckdb.DuckDBPyConnection):
        self._con_f = con

    def _conexion(self):
        return self._con_f

    def version(self) -> str:
        return "falso"


def _warehouse() -> WhFalso:
    c = duckdb.connect()
    c.execute(f"CREATE TABLE meta AS SELECT DATE '{CORTE}' AS corte, DATE '{CORTE}' AS fecha_max, DATE '2026-01-01' AS fecha_min, "
              "TIMESTAMP '2026-10-01 00:00:00' AS construido")
    c.execute("""CREATE TABLE venta AS SELECT * FROM (VALUES
        ('F1', 1, DATE '2026-09-02', 10, 'P1', '100', 1.0, 10000.0, 10000.0, 0.0, 6000.0),   -- A compra lo promocionado en la vigencia
        ('F2', 1, DATE '2026-09-03', 11, 'P9', '200', 1.0, 5000.0, 5000.0, 0.0, 3000.0),     -- B compra otra cosa
        ('F3', 1, DATE '2026-08-20', 12, 'P1', '300', 1.0, 9000.0, 9000.0, 0.0, 5000.0),     -- C (control) compra P1 FUERA de la vigencia
        ('F4', 2, DATE '2026-09-04', 18, 'P1', '500', 2.0, 20000.0, 20000.0, 0.0, 9000.0)    -- E (control) compra P1 en la vigencia
        ) t(factura, sucursal_id, fecha, hora, producto_id, cliente_id, cantidad, venta_neta, venta_bruta, descuento, costo)""")
    c.execute("""CREATE TABLE cli_dia AS SELECT cliente_id, fecha, SUM(venta_neta) AS venta, COUNT(DISTINCT factura) AS facturas,
                 COUNT(*) AS lineas, SUM(descuento) AS descuento, SUM(venta_bruta) AS bruta, MIN(hora) AS hora FROM venta GROUP BY 1, 2""")
    c.execute("""CREATE TABLE cli_perfil AS SELECT cliente_id, MIN(fecha) AS primera_compra, MAX(fecha) AS ultima_compra, COUNT(*) AS visitas,
                 SUM(venta) AS venta_total, SUM(venta) / COUNT(*) AS ticket_prom, 1.0 AS items_por_visita, NULL::DOUBLE AS intervalo_dias,
                 0.0 AS pct_descuento, 0 AS visitas_finde, isodow(MIN(fecha)) AS dia_semana_pref, 'mañana' AS franja_pref
                 FROM cli_dia GROUP BY 1""")
    c.execute("CREATE TABLE cli_rfm AS SELECT cliente_id, 'campeones' AS segmento_rfm FROM cli_perfil")
    c.execute("CREATE TABLE catalogo AS SELECT * FROM (VALUES ('G1', 'CARNES'), ('D1', 'ALIMENTOS')) t(codigo, nombre)")
    c.execute("""CREATE TABLE cli_nivel AS SELECT cliente_id, 'grupo' AS nivel, 'G1' AS codigo, SUM(venta_neta) AS venta, 1 AS compras
                 FROM venta GROUP BY 1 UNION ALL SELECT cliente_id, 'departamento', 'D1', SUM(venta_neta), 1 FROM venta GROUP BY 1""")
    c.execute("CREATE TABLE cli_marca AS SELECT cliente_id, 'MARCA X' AS marca, SUM(venta_neta) AS venta, 1 AS compras FROM venta GROUP BY 1")
    c.execute("CREATE TABLE cliente AS SELECT cliente_id, 40 AS edad, 'F' AS sexo FROM cli_perfil")
    return WhFalso(c)


def _indice() -> Indice:
    ix = Indice()
    c = duckdb.connect()
    # id, documento, estado, consentimiento, BLOQUE, celular/correo, clubes, mascotas, compras
    c.execute("""CREATE TABLE cli AS SELECT * FROM (VALUES
        ('a', '100', 'activo', 'si', FALSE, TRUE, FALSE, '1,2', 1, '02', DATE '1990-05-01', 'F', '17001', 3, 30000.0, 10000.0, DATE '2026-09-02', 'campeones', 'adelantado'),
        ('b', '200', 'activo', 'si', TRUE,  TRUE, TRUE,  '1',   0, '',   DATE '2010-12-31', 'M', '17001', 1, 5000.0, 5000.0,  DATE '2026-09-03', 'nuevos', 'sin_historial'),
        ('c', '300', 'activo', 'no', FALSE, FALSE, TRUE, '',    0, '',   NULL,              'N', '',      0, NULL, NULL, NULL, 'sin_compras', 'sin_historial'),
        ('d', '400', 'inactivo', 'si', FALSE, TRUE, TRUE, '',   0, '',   NULL,              'F', '17001', 0, NULL, NULL, NULL, 'sin_compras', 'sin_historial')
        ) t(id, documento, estado, consentimiento, sin_campanas, cel_ok, email_ok, clubes, n_mascotas, mascota_tipos, nac, sexo, ciudad_id,
            visitas, venta_total, ticket_prom, ultima_compra, segmento, ciclo)""")
    c.execute("""ALTER TABLE cli ADD COLUMN generico BOOLEAN DEFAULT FALSE; ALTER TABLE cli ADD COLUMN n_vehiculos INTEGER DEFAULT 0;
                 ALTER TABLE cli ADD COLUMN autoriza_whatsapp BOOLEAN DEFAULT NULL; ALTER TABLE cli ADD COLUMN autoriza_sms BOOLEAN DEFAULT NULL;
                 ALTER TABLE cli ADD COLUMN autoriza_email BOOLEAN DEFAULT NULL; ALTER TABLE cli ADD COLUMN creado DATE DEFAULT DATE '2025-01-15';
                 ALTER TABLE cli ADD COLUMN completitud INTEGER DEFAULT 50; ALTER TABLE cli ADD COLUMN sucursal VARCHAR DEFAULT '001'""")
    ix._con = c
    ix.cargado_en = datetime.now()
    return ix


@pytest.fixture
def entorno(monkeypatch):
    comun.limpiar_cache()
    wh, ix = _warehouse(), _indice()
    for mod in (comun, an_cli, an_camp):
        if hasattr(mod, "get_warehouse"):
            monkeypatch.setattr(mod, "get_warehouse", lambda: wh)
    monkeypatch.setattr(an_cli, "get_indice", lambda: ix)
    from crm.modules.clientes import catalogos, servicio
    monkeypatch.setattr(servicio, "nombres_sucursales", lambda: {"01": "Centro", "02": "Sultana"})
    monkeypatch.setattr(catalogos, "get_catalogos", lambda: (_ for _ in ()).throw(RuntimeError("sin catálogos")))
    yield wh, ix
    comun.limpiar_cache()


# ------------------------------------------------------------------------------------------ filtros
def test_filtros_solo_aceptan_listas_blancas():
    f = an_cli.normalizar({"clubes": "1,2,x'; DROP TABLE cli;--,ninguno", "segmentos": "campeones,hackers", "sexos": "F,Z",
                           "edades": "25-34,999", "ciudades": "17001,17-001", "consentimiento": "si,talvez"})
    assert f["clubes"] == ["1", "2", "ninguno"]
    assert f["segmentos"] == ["campeones"] and f["sexos"] == ["F"] and f["edades"] == ["25-34"]
    assert f["ciudades"] == ["17001"] and f["consentimiento"] == ["si"]
    sql, params = an_cli._where(f)
    assert "DROP" not in sql and "17001" not in sql   # los valores viajan como parámetros, nunca en el texto SQL


# ------------------------------------------------------------------------------------------ tablero de clientes
def test_tablero_clientes_cuenta_bien(entorno):
    r = an_cli.tablero({})
    k = r["poblacion"]["kpis"]
    assert k["total"] == 3                    # el inactivo no cuenta
    assert k["con_compras"] == 2 and k["activos_90"] == 2
    assert k["autorizan"] == 2
    assert k["contactables"] == 1             # b autoriza pero tiene BLOQUE; c no autoriza
    assert k["en_clubes"] == 2 and k["con_mascotas"] == 1
    assert k["ticket"] == round(35000 / 4)
    clubes = {c["id"]: c["n"] for c in r["poblacion"]["clubes"]}
    assert clubes == {"1": 2, "2": 1, "ninguno": 1}
    assert r["poblacion"]["pares_clubes"] == [{"a": "1", "b": "2", "n": 1}]
    bandas = {(d["edad"], d["sexo"]): d["n"] for d in r["poblacion"]["demografia"]}
    assert bandas[("menor", "M")] == 1        # nacido el 31-dic-2010: 15 años (edad exacta)
    assert r["poblacion"]["sedes_alta"] == [{"id": "1", "nombre": "Centro", "n": 3}]   # '001' → sede 1 → Centro
    assert len(r["poblacion"]["altas"]) == 24  # serie mensual completa (meses sin altas = 0)
    comp = r["comportamiento"]
    # el 500 compró en Sultana pero no está en el CRM: el tablero solo cruza ventas de los clientes seleccionados
    assert {s["nombre"]: s["clientes"] for s in comp["sedes"]} == {"Centro": 3}
    assert comp["categorias"][0]["nombre"] == "CARNES"
    assert comp["mensual"][-1]["mes"] == "2026-09"


def test_tablero_clientes_filtra_por_club_y_sexo(entorno):
    r = an_cli.tablero({"clubes": "2"})
    assert r["poblacion"]["kpis"]["total"] == 1
    assert {s["nombre"] for s in r["comportamiento"]["sedes"]} == {"Centro"}   # solo las ventas de «a»
    r = an_cli.tablero({"clubes": "ninguno", "sexos": "N"})
    assert r["poblacion"]["kpis"]["total"] == 1 and r["poblacion"]["kpis"]["con_compras"] == 0


def test_cache_devuelve_lo_mismo(entorno):
    assert an_cli.tablero({"sexos": "F"}) is an_cli.tablero({"sexos": "F"})


# ------------------------------------------------------------------------------------------ campañas
def _store(tmp_path, monkeypatch) -> Store:
    s = Store(tmp_path / "c.sqlite")
    monkeypatch.setattr(an_camp, "get_store", lambda: s)
    return s


def test_efectividad_contra_grupo_de_control(entorno, tmp_path, monkeypatch):
    s = _store(tmp_path, monkeypatch)
    c = s.crear({"nombre": "Promo P1", "productos": [{"producto_id": "P1", "producto": "Producto 1", "grupo": "CARNES"}],
                 "mensaje": {"canales": ["sms"]}, "segmentacion": {"filtros": {"objetivo": "premium"}}})
    # envío: A (compra P1 en la vigencia) y B (compra otra cosa); control: C (compra P1 antes) y E (compra P1 en la vigencia)
    s.publicar(c["id"], [("100", "sms"), ("200", "sms"), ("300", "sms"), ("500", "sms")], control={"300", "500"},
               vigencia=(date(2026, 9, 1), date(2026, 9, 7)))
    r = an_camp.tablero({})
    fila = r["campanas_tabla"][0]
    assert fila["cobertura"] == "completa"
    assert fila["tasa_envio"] == 50.0 and fila["tasa_control"] == 50.0 and fila["lift_pp"] == 0.0
    assert fila["venta_por_dest_envio"] == 5000 and fila["venta_por_dest_control"] == 10000
    assert fila["incremental"] == (5000 - 10000) * 2       # el control compró más: efecto negativo, se reporta tal cual
    k = r["kpis"]
    assert k["destinatarios"] == 2 and k["control"] == 2 and k["personas_unicas"] == 2 and k["medidas"] == 1
    assert {x["id"]: x["n"] for x in r["canales"]}["sms"] == 2
    assert r["productos"] == [{"nombre": "Producto 1", "n": 1}]


def test_campana_posterior_al_corte_queda_sin_datos(entorno, tmp_path, monkeypatch):
    s = _store(tmp_path, monkeypatch)
    c = s.crear({"nombre": "Futura", "productos": [{"producto_id": "P1", "producto": "P1"}]})
    s.publicar(c["id"], [("100", "email")], vigencia=(date(2026, 11, 20), date(2026, 11, 22)))
    fila = an_camp.tablero({})["campanas_tabla"][0]
    assert fila["cobertura"] == "sin_datos" and fila["tasa_envio"] is None and fila["incremental"] is None


def test_filtro_de_periodo_y_estado(entorno, tmp_path, monkeypatch):
    s = _store(tmp_path, monkeypatch)
    s.crear({"nombre": "Borrador"})
    assert an_camp.tablero({"estados": "publicada"})["kpis"]["campanas"] == 0
    assert an_camp.tablero({"estados": "borrador"})["kpis"]["borradores"] == 1
    assert an_camp.tablero({"desde": "2000-01-01", "hasta": "2000-12-31"})["kpis"]["campanas"] == 0
    assert an_camp.normalizar({"desde": "2026-12-01", "hasta": "2026-01-01"})["desde"] == "2026-01-01"   # rango invertido se corrige
