"""Pruebas de la lógica pura del módulo Campañas (no requieren ERP, warehouse ni red)."""

from __future__ import annotations

from datetime import date

import pytest

from crm.modules.campanas import calendario, redaccion, segmentos


# ------------------------------------------------------------------ calendario
def test_dia_madre_es_segundo_domingo_de_mayo():
    t = {x.id: x for x in calendario.temporadas_del_anio(2026)}["dia_madre"]
    assert t.inicio == date(2026, 5, 10) and t.inicio.weekday() == 6


def test_semana_santa_2026_termina_en_pascua():
    t = {x.id: x for x in calendario.temporadas_del_anio(2026)}["semana_santa"]
    assert t.fin == date(2026, 4, 5)


def test_black_friday_es_viernes_tras_el_cuarto_jueves():
    t = {x.id: x for x in calendario.temporadas_del_anio(2026)}["black_friday"]
    assert t.inicio == date(2026, 11, 27) and t.inicio.weekday() == 4


def test_temporadas_relevantes_en_noviembre_incluye_navidad():
    ids = [t.id for t in calendario.temporadas_relevantes(date(2026, 11, 11), 75)]
    assert "black_friday" in ids and "navidad" in ids and "halloween" not in ids


def test_buscar_ignora_pasadas():
    assert calendario.buscar("halloween", date(2026, 11, 11)) is None or calendario.buscar("halloween", date(2026, 11, 11)).inicio.year == 2027


# ------------------------------------------------------------------ SMS
def test_sms_corto_gsm_un_mensaje():
    r = redaccion.segmentos_sms("Hola Maria, 2x1 en licores. Responde NO para salir.")
    assert r["codificacion"] == "GSM-7" and r["mensajes"] == 1


def test_sms_con_emoji_pasa_a_unicode_y_cuenta_70():
    r = redaccion.segmentos_sms("Hola 🎉" + "a" * 70)
    assert r["codificacion"] == "Unicode" and r["mensajes"] == 2


def test_sms_largo_cuenta_segmentos_de_153():
    assert redaccion.segmentos_sms("a" * 161)["mensajes"] == 2
    assert redaccion.segmentos_sms("a" * 306)["mensajes"] == 2
    assert redaccion.segmentos_sms("a" * 307)["mensajes"] == 3


def test_validar_avisa_sms_multiple():
    v = redaccion.validar({"sms": {"texto": "a" * 200}})
    assert not v["sms"]["ok"] and v["sms"]["avisos"]


# ------------------------------------------------------------------ segmentación: filtros
def test_normalizar_descarta_valores_invalidos():
    f = segmentos.normalizar({"productos": ["1"], "segmentos_rfm": ["campeones", "'; DROP TABLE x;--"], "sexo": ["F", "X"],
                              "dias_pref": [1, 9, "3", "a"], "objetivo": ["lista"], "afinidad_minima": 999})
    assert f["segmentos_rfm"] == ["campeones"] and f["sexo"] == ["F"] and f["dias_pref"] == [1, 3]
    assert f["objetivo"] == "equilibrado" and f["afinidad_minima"] == 100


def test_normalizar_tolera_tipos_raros():
    f = segmentos.normalizar({"productos": "no-es-lista", "costos": "x", "tope_contactos": "abc", "min_visitas": "-5"})
    assert f["productos"] == [] and f["tope_contactos"] is None and f["min_visitas"] == 0


def test_consentimiento_estricto_por_defecto():
    assert segmentos.normalizar({})["consentimiento"] == "estricto"
    assert segmentos.normalizar({"consentimiento": "cualquier-cosa"})["consentimiento"] == "estricto"


def test_costos_acotados():
    f = segmentos.normalizar({"costos": {"sms": 99999999, "whatsapp": -5, "otro": 1}})
    assert f["costos"]["sms"] == 5000 and f["costos"]["whatsapp"] == 0 and "otro" not in f["costos"]


def test_consulta_nunca_interpola_valores_del_usuario():
    f = segmentos.normalizar({"productos": ["x'; DROP TABLE producto;--"], "ciudades": ["MANIZALES'; --"], "clubs": ["vino"]})
    sql, params = segmentos._consulta(f, False, [])
    assert "DROP" not in sql and "MANIZALES" not in sql
    assert any("DROP TABLE" in str(p) for p in params)  # viaja como parámetro


def test_menores_se_excluyen_si_hay_producto_restringido():
    f = segmentos.normalizar({"productos": ["1"]})
    sql, _ = segmentos._consulta(f, True, [])
    assert "edad >= 18" in sql
    sql2, _ = segmentos._consulta(f, False, [])
    assert "edad >= 18" not in sql2


def test_detecta_productos_restringidos():
    assert segmentos.productos_restringidos([{"producto": "RON BACARDI 700ML"}]) == ["RON BACARDI 700ML"]
    assert segmentos.productos_restringidos([{"producto": "GALLETA SALTIN"}]) == []
    assert segmentos.productos_restringidos([{"producto": "X", "grupo": "CIGARRILLOS"}]) == ["X"]


def test_enmascarado_de_datos_personales():
    assert segmentos._mask_nombre("JUAN PEREZ LOPEZ") == "J*** P***"
    assert segmentos._mask_cel("3151234567") == "*** *** 4567"
    assert segmentos._mask_mail("ana@correo.com") == "a***@correo.com"
    assert "@" not in segmentos._mask_mail(None)


def test_resumen_calcula_costo_sin_duplicar_whatsapp_y_sms():
    cols = ["celular", "email_valido", "segmento_rfm", "sexo", "banda_edad", "estado_ciclo", "ciudad", "puntaje"]
    rows = [("3151234567", True, "campeones", "F", "25-34", "en_ventana", "MANIZALES", 90.0),
            ("3151234568", False, "leales", "M", "35-44", "atrasado", "MANIZALES", 70.0),
            (None, True, "nuevos", None, "sin_dato", "sin_historial", None, 40.0)]
    f = segmentos.normalizar({"productos": ["1"], "canales": ["whatsapp", "sms", "email"]})
    r = segmentos.resumen(cols, rows, f, 100)
    # WhatsApp 120 x2 (SMS no se duplica) + correo 3 x2 = 246
    assert r["costo_estimado"] == 246 and r["por_canal"]["whatsapp"] == 2 and r["por_canal"]["email"] == 2
    assert r["audiencia"] == 3


def test_tope_de_contactos_recorta_por_puntaje():
    cols = ["celular", "email_valido", "segmento_rfm", "sexo", "banda_edad", "estado_ciclo", "ciudad", "puntaje"]
    rows = [("3150000001", False, "campeones", "F", "25-34", "en_ventana", "X", 90.0 - i) for i in range(10)]
    f = segmentos.normalizar({"productos": ["1"], "canales": ["sms"], "tope_contactos": 4})
    assert segmentos.resumen(cols, rows, f, 10)["audiencia"] == 4


# ------------------------------------------------------------------ persistencia
def test_store_crud_y_borrado_logico(tmp_path):
    from crm.store import Store

    s = Store(tmp_path / "t.sqlite")
    c = s.crear({"nombre": "A"})
    assert c["estado"] == "borrador" and s.listar()[0]["id"] == c["id"]
    s.actualizar(c["id"], {"nombre": "B", "productos": [{"producto_id": "1"}]})
    assert s.obtener(c["id"])["nombre"] == "B"
    assert s.eliminar(c["id"]) and s.obtener(c["id"]) is None and s.listar() == []
    assert s.obtener(c["id"], incluir_eliminadas=True) is not None   # sigue en la base para auditoría


def test_store_publicada_no_se_edita_y_excluye_recientes(tmp_path):
    from crm.store import Store

    s = Store(tmp_path / "t.sqlite")
    c = s.crear({"nombre": "A"})
    s.publicar(c["id"], [("123", "sms"), ("456", "email")])
    with pytest.raises(PermissionError):
        s.actualizar(c["id"], {"nombre": "otro"})
    assert s.contactados_recientes(30) == {"123", "456"}
    s.eliminar(c["id"])
    assert s.contactados_recientes(30) == set()


def test_store_busqueda_escapa_comodines(tmp_path):
    from crm.store import Store

    s = Store(tmp_path / "t.sqlite")
    s.crear({"nombre": "100% feria"})
    s.crear({"nombre": "otra"})
    assert [c["nombre"] for c in s.listar(q="%")] == ["100% feria"]


# ------------------------------------------------------------------ regresión: publicar usa los filtros guardados
def test_publicar_reconstruye_los_filtros_guardados():
    """Bug real encontrado probando: el servidor ignoraba segmentacion.filtros y publicaba a toda la base."""
    from crm.modules.campanas.router import filtros_de_campana

    c = {"productos": [{"producto_id": "A"}, {"producto_id": "B"}],
         "segmentacion": {"filtros": {"tope_contactos": "4000", "objetivo": "rotar_inventario", "excluir_contactados_dias": "30"}},
         "mensaje": {"temporada_id": None}}
    f = filtros_de_campana(c, ["sms"])
    assert f["tope_contactos"] == "4000" and f["objetivo"] == "rotar_inventario" and f["excluir_contactados_dias"] == "30"
    assert f["productos"] == ["A", "B"] and f["canales"] == ["sms"]
    n = segmentos.normalizar(f)
    assert n["tope_contactos"] == 4000 and n["objetivo"] == "rotar_inventario" and n["excluir_contactados_dias"] == 30


def test_filtros_guardados_ausentes_o_corruptos_no_rompen():
    from crm.modules.campanas.router import filtros_de_campana

    for seg in ({}, None, {"filtros": None}, {"filtros": "texto"}):
        f = filtros_de_campana({"productos": [{"producto_id": "A"}], "segmentacion": seg, "mensaje": {}}, ["email"])
        assert f["productos"] == ["A"] and f["meses_temporada"] == []
