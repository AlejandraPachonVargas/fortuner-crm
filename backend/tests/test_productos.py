"""Productos de Campañas: la búsqueda encuentra todo el catálogo y el descuento sugerido se explica paso a paso."""

from __future__ import annotations

from datetime import date

import duckdb

from crm.modules.campanas import productos as prod
from crm.warehouse import Warehouse


class WhFalso(Warehouse):
    def __init__(self, con):
        self._con_f = con

    def _conexion(self):
        return self._con_f


def _wh() -> WhFalso:
    c = duckdb.connect()
    c.execute(f"CREATE TABLE meta AS SELECT DATE '{date(2026, 9, 30)}' AS corte, DATE '{date(2026, 11, 20)}' AS hoy")
    c.execute("""CREATE TABLE producto AS SELECT * FROM (VALUES
        ('1', 'AGUARDIENTE AMARILLO 750ML', FALSE, 300.0),   -- marcado inactivo en el ERP pero se vende a diario
        ('2', 'AGUARDIENTE CRISTAL 375ML',  TRUE,  100.0),
        ('3', 'ARROZ DIANA 500G',           FALSE,   0.0),   -- inactivo y sin ventas
        ('4', 'VINO TINTO 750ML',           TRUE,   50.0)
        ) t(producto_id, producto, activo, stock_actual)""")
    for col, tipo, v in (("ean", "VARCHAR", "NULL"), ("marca", "VARCHAR", "'X'"), ("tipo_producto", "VARCHAR", "'T'"),
                         ("familia_id", "VARCHAR", "'1'"), ("familia", "VARCHAR", "'F'"), ("departamento_id", "VARCHAR", "'10'"),
                         ("departamento", "VARCHAR", "'D'"), ("grupo_id", "VARCHAR", "'100'"), ("grupo", "VARCHAR", "'G'"),
                         ("seccion_id", "VARCHAR", "'1000'"), ("seccion", "VARCHAR", "'S'"), ("precio_venta", "DOUBLE", "1000"),
                         ("costo_ultima_compra", "DOUBLE", "700")):
        c.execute(f"ALTER TABLE producto ADD COLUMN {col} {tipo} DEFAULT {v}")
    c.execute("""CREATE TABLE producto_stats AS SELECT * FROM (VALUES
        ('1', DATE '2026-09-30', 4030.0, 9000000.0), ('2', DATE '2026-09-29', 2500.0, 5000000.0),
        ('3', NULL, 0.0, 0.0), ('4', DATE '2026-09-01', 10.0, 30000.0)) t(producto_id, ultima_venta, unidades_90d, venta_90d)""")
    c.execute("ALTER TABLE producto_stats ADD COLUMN unidades_30d DOUBLE DEFAULT 0; ALTER TABLE producto_stats ADD COLUMN venta_total DOUBLE DEFAULT 0")
    return WhFalso(c)


def _ids(r: dict) -> list[str]:
    return [x["producto_id"] for x in r["items"]]


def test_buscar_por_nombre_encuentra_todo_el_catalogo():
    wh = _wh()
    # Con texto se busca en todo el catálogo: el aguardiente marcado «inactivo» en el ERP también sale.
    assert _ids(prod.buscar(wh, {"q": "aguardiente"})) == ["1", "2"]
    assert _ids(prod.buscar(wh, {"q": "arroz"})) == ["3"]
    # Sin texto, «solo activos» = activos en el ERP o con ventas en 90 días (el 3 no tiene ninguna de las dos).
    assert sorted(_ids(prod.buscar(wh, {}))) == ["1", "2", "4"]
    assert sorted(_ids(prod.buscar(wh, {"solo_activos": False}))) == ["1", "2", "3", "4"]


def test_descuento_sugerido_paso_a_paso():
    c = prod.calculo_descuento(10_000, 7_000)       # margen 30 % → 60 % de eso = 18 %
    assert (c["margen_pct"], c["posible_pct"], c["descuento_pct"], c["limitado_por_tope"]) == (30.0, 18.0, 18, False)
    assert (c["precio_con_descuento"], c["ganancia_antes"], c["ganancia_despues"]) == (8_200, 3_000, 1_200)
    assert c["ganancia_despues"] / c["ganancia_antes"] == 0.4   # se conserva el 40 % de la ganancia por unidad
    c = prod.calculo_descuento(10_000, 2_000)       # margen 80 % → 48 %, pero el tope es 30 %
    assert (c["descuento_pct"], c["limitado_por_tope"]) == (30, True)
    c = prod.calculo_descuento(10_000, 11_000)      # vende a pérdida: no hay descuento
    assert (c["descuento_pct"], c["ganancia_despues"]) == (0, -1_000)
    assert prod.calculo_descuento(0, 500)["descuento_pct"] == 0
