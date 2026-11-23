"""Captación: excluir a quienes ya compran los productos (habituales o todos) y puntuar a los demás por parecido."""

from __future__ import annotations

import duckdb

from crm.modules.campanas import segmentos as seg
from crm.warehouse import Warehouse


class WhFalso(Warehouse):
    def __init__(self, con):
        self._con_f = con

    def _conexion(self):
        return self._con_f


# Clientes: H = habitual (4 compras recientes), O = ocasional (1 compra reciente), V = compró hace mucho (fuera de la
# ventana), C = nunca lo compró pero gasta en la categoría, N = nunca lo compró y no tiene relación con la categoría.
CLIENTES = ("H", "O", "V", "C", "N")


def _wh() -> WhFalso:
    c = duckdb.connect()
    c.execute("CREATE TABLE meta AS SELECT DATE '2026-09-30' AS corte")
    c.execute("CREATE TABLE producto AS SELECT 'P1' AS producto_id, 'G1' AS grupo_id, 'F1' AS familia_id, 'MARCA' AS marca")
    c.execute("""CREATE TABLE cliente AS SELECT id AS cliente_id, 'Nombre ' || id AS nombre, id || '@x.co' AS email, '300' || id AS celular,
                 TRUE AS email_valido, 'F' AS sexo, 40 AS edad, 'MANIZALES' AS ciudad, TRUE AS autoriza_datos, FALSE AS club_vino,
                 FALSE AS club_salud, FALSE AS club_mascotas, FALSE AS club_parrilla, FALSE AS bloqueado
                 FROM (SELECT unnest(?::VARCHAR[]) AS id)""", [list(CLIENTES)])
    c.execute("""CREATE TABLE cli_rfm AS SELECT cliente_id, 'leales' AS segmento_rfm, 'en_ventana' AS estado_ciclo, 10 AS dias_sin_compra,
                 4 AS r, 4 AS f, 4 AS m, 2 AS sens_desc, 1.0 AS ratio_ciclo FROM cliente""")
    c.execute("""CREATE TABLE cli_perfil AS SELECT cliente_id, 20 AS visitas, 1000000.0 AS venta_total, 50000.0 AS ticket_prom,
                 15.0 AS intervalo_dias, 6 AS dia_semana_pref, 'tarde' AS franja_pref FROM cliente""")
    c.execute("""CREATE TABLE venta AS SELECT * FROM (VALUES
        ('f1', DATE '2026-09-01', 'P1', 'H', 1.0), ('f2', DATE '2026-08-01', 'P1', 'H', 1.0), ('f3', DATE '2026-07-01', 'P1', 'H', 1.0),
        ('f4', DATE '2026-06-01', 'P1', 'H', 1.0), ('f5', DATE '2026-09-10', 'P1', 'O', 2.0), ('f6', DATE '2026-01-15', 'P1', 'V', 1.0)
        ) t(factura, fecha, producto_id, cliente_id, cantidad)""")
    c.execute("""CREATE TABLE cli_producto AS SELECT cliente_id, producto_id, SUM(cantidad) AS unidades, COUNT(DISTINCT factura) AS compras,
                 MAX(fecha) AS ultima FROM venta GROUP BY ALL""")
    c.execute("""CREATE TABLE cli_nivel AS SELECT * FROM (VALUES ('C', 'grupo', 'G1', 400000.0), ('H', 'grupo', 'G1', 300000.0))
                 t(cliente_id, nivel, codigo, venta)""")
    c.execute("CREATE TABLE cli_marca AS SELECT 'C' AS cliente_id, 'MARCA' AS marca, 200000.0 AS venta")
    c.execute("CREATE TABLE cli_mes AS SELECT 'C' AS cliente_id, 12 AS mes, 1 AS visitas WHERE FALSE")
    return WhFalso(c)


def _ids(f: dict) -> tuple[list[str], int]:
    filtros, rows = seg.calcular(_wh(), {"productos": ["P1"], **f})
    i = filtros["_cols"].index("cliente_id")
    return [r[i] for r in rows], filtros["_excluidos_compradores"]


def test_sin_exclusion_entran_todos():
    ids, fuera = _ids({})
    assert sorted(ids) == sorted(CLIENTES) and fuera == 0


def test_excluir_habituales_solo_saca_a_quien_compra_seguido():
    ids, fuera = _ids({"excluir_compradores": "habituales"})              # por defecto: 3 compras en 180 días
    assert "H" not in ids and {"O", "V", "C", "N"} <= set(ids) and fuera == 1
    ids, fuera = _ids({"excluir_compradores": "habituales", "habitual_compras": 2, "habitual_dias": 90})
    assert "H" not in ids and fuera == 1                                  # en 90 días H tiene 2 compras (ago y sep), O solo 1
    ids, _ = _ids({"excluir_compradores": "habituales", "habitual_compras": 6})
    assert "H" in ids                                                     # nadie llega a 6 compras


def test_excluir_todos_saca_a_cualquiera_que_lo_haya_comprado():
    ids, fuera = _ids({"excluir_compradores": "todos"})
    assert sorted(ids) == ["C", "N"] and fuera == 3                      # V lo compró en enero: también sale


def test_captar_puntua_el_parecido_y_no_la_compra_previa():
    filtros, rows = seg.calcular(_wh(), {"productos": ["P1"], "objetivo": "captar", "excluir_compradores": "todos"})
    cols = filtros["_cols"]
    punt = {r[cols.index("cliente_id")]: r[cols.index("puntaje")] for r in rows}
    assert punt["C"] > punt["N"]                                          # gasta en la categoría y prefiere la marca
    # Sin excluir: en «captar» haber comprado el producto no suma afinidad (O no supera a N por eso).
    filtros, rows = seg.calcular(_wh(), {"productos": ["P1"], "objetivo": "captar"})
    cols = filtros["_cols"]
    af = {r[cols.index("cliente_id")]: r[cols.index("afinidad")] for r in rows}
    assert af["O"] == af["N"] == 0 and af["C"] > 0


def test_valores_raros_vuelven_a_los_de_defecto():
    f = seg.normalizar({"excluir_compradores": "<x>", "habitual_compras": "99", "habitual_dias": "abc"})
    assert (f["excluir_compradores"], f["habitual_compras"], f["habitual_dias"]) == ("no", 3, 180)


def test_sin_marca_no_cuenta_como_afinidad_de_marca():
    wh = _wh()
    wh._con_f.execute("UPDATE producto SET marca = 'SIN MARCA'")
    wh._con_f.execute("INSERT INTO cli_marca VALUES ('N', 'SIN MARCA', 900000.0)")
    filtros, rows = seg.calcular(wh, {"productos": ["P1"], "afinidad_requerida": ["marca"]})
    assert rows == []                     # «SIN MARCA» no es preferencia de marca: nadie cumple
