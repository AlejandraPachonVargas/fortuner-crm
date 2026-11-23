"""Configuración general: empresa, reglas, presupuesto, bajas, RNE, carga automática del ERP y fotos una a una."""

from __future__ import annotations

import io
from datetime import date, datetime

import pytest
from PIL import Image

from crm.modules.configuracion import general as gen
from crm.modules.configuracion import legal, presupuesto
from crm.store import Store


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    monkeypatch.delenv("CRM_CIFRADO_CLAVE", raising=False)
    monkeypatch.setenv("CRM_DATA_DIR", str(tmp_path))
    from crm import config, store
    config.get_settings.cache_clear()
    store._store = Store(tmp_path / "c.sqlite")
    yield store._store
    store._store = None
    config.get_settings.cache_clear()


def test_valores_por_defecto_y_validacion(entorno):
    g = gen.get_general()
    assert g.seccion("reglas")["excluir_contactados_dias"] == 15 and g.seccion("empresa")["nombre"] == "Mi empresa"
    r = g.guardar("empresa", {"nombre": "Mercaldas", "tienda_url": "https://mercaldas.com", "color": "#0F70FC"}, "ana")
    assert r["nombre"] == "Mercaldas" and gen.empresa_nombre() == "Mercaldas"
    for datos, texto in (({"tienda_url": "http://x.com"}, "https"), ({"color": "azul"}, "color"), ({"nombre": ""}, "obligatorio"),
                         ({"nombre": "<script>"}, "<")):
        with pytest.raises(ValueError, match=texto):
            g.guardar("empresa", datos, "ana")
    with pytest.raises(ValueError, match="entre"):
        g.guardar("reglas", {"control_pct": 50}, "ana")
    with pytest.raises(ValueError, match="HH:MM"):
        g.guardar("etl", {"hora": "3am"}, "ana")


def test_reglas_se_aplican(entorno):
    from crm.modules.campanas import productos, programacion, segmentos
    g = gen.get_general()
    g.guardar("reglas", {"vigencia_max_dias": 30, "habitual_compras": 5, "habitual_dias": 120,
                         "descuento_factor_pct": 50, "descuento_tope_pct": 10}, "ana")
    with pytest.raises(programacion.FechaInvalida, match="1 a 30"):
        programacion.vigencia(date(2026, 11, 1), 31)
    f = segmentos.normalizar({"excluir_compradores": "habituales"})
    assert (f["habitual_compras"], f["habitual_dias"]) == (5, 120)
    c = productos.calculo_descuento(10_000, 7_000)          # margen 30 % × 50 % = 15 %, tope 10 %
    assert (c["descuento_pct"], c["limitado_por_tope"], c["factor_pct"], c["tope_pct"]) == (10, True, 50, 10)


def test_presupuesto_tope_y_alerta(entorno):
    s = entorno
    g = gen.get_general()
    g.guardar("presupuesto", {"tope_sms": 1000, "alerta_pct": 80}, "ana")
    c = s.crear({"nombre": "x", "mensaje": {"canales": ["sms"]}})
    s.publicar(c["id"], [(str(i), "sms") for i in range(20)])                # 20 SMS × 45 = 900 (90 %)
    con = presupuesto.consumo()["canales"]["sms"]
    assert con["gastado"] == 900 and con["alerta"] and not con["agotado"]
    assert presupuesto.excede({"sms": 200, "whatsapp": 0, "email": 0}) and not presupuesto.excede({"sms": 100, "whatsapp": 0, "email": 0})
    s.publicar(s.crear({"nombre": "y", "mensaje": {"canales": ["sms"]}})["id"], [("a", "sms"), ("b", "sms"), ("c", "sms")])
    assert presupuesto.consumo()["canales"]["sms"]["agotado"]
    from crm.modules.configuracion.servicio import get_configuracion, motivos_bloqueo
    get_configuracion().guardar("sms", "twilio", {"account_sid": "AC" + "a" * 32, "remitente": "+15550001", "prefijo_pais": 57,
                                                  "costo_mensaje": 45}, {"auth_token": "tok-123456789"}, [], True, "ana")
    assert "Tope mensual" in motivos_bloqueo()["sms"]


def test_baja_por_enlace(entorno):
    lg = legal.get_legal()
    t = lg.token_baja("1053123456", "email")
    assert "1053123456" not in t                                            # la cédula no va a la vista en el enlace
    assert lg.leer_token(t) == ("1053123456", "email")
    with pytest.raises(ValueError):
        lg.leer_token(t[:-4] + "AAAA")
    r = lg.registrar_baja("1053123456", "email", "enlace@1.2.3.4")
    assert r["erp"].startswith("pendiente")                                 # sin escritura en el ERP: queda en el CRM
    ex = legal.exclusiones([{"documento": "1053123456", "celulares": [], "correos": [], "autoriza": True}])
    assert ex == {"1053123456": frozenset({"email"})}


def test_rne_importar_aplicar_y_vencer(entorno, monkeypatch):
    lg = legal.get_legal()
    g = gen.get_general()
    texto = "numero;canal\n+57 300 123 4567;SMS\n3109876543\ncorreo@ejemplo.com\nbasura 12345\n"
    e = lg.importar_rne(texto, "ana")
    assert (e["telefonos"], e["correos"]) == (2, 1) and not e["activo"]
    assert lg.en_rne("573001234567") and lg.en_rne("CORREO@ejemplo.com") and not lg.en_rne("3000000000")
    filas = [{"documento": "1", "celulares": ["3001234567"], "correos": ["otro@x.co"], "autoriza": True},
             {"documento": "2", "celulares": ["3200000000"], "correos": ["correo@ejemplo.com"], "autoriza": False}]
    assert legal.exclusiones(filas) == {}                                    # RNE inactivo: no se aplica
    g.guardar("legal", {"rne_activo": True}, "ana")
    assert legal.exclusiones(filas) == {"1": frozenset({"whatsapp", "sms"}), "2": frozenset({"email"})}
    g.guardar("legal", {"rne_exentos_autorizados": True, "rne_canales": ["sms"]}, "ana")
    assert legal.exclusiones(filas) == {}                                    # 1 autorizó; 2 solo está por correo
    with pytest.raises(ValueError):
        lg.importar_rne("sin datos", "ana")
    # Lista vieja: los canales cubiertos quedan bloqueados hasta actualizarla.
    g.fijar_interno("rne", {**g.interno("rne"), "fecha": "2026-01-01T00:00:00"})
    assert lg.estado_rne()["vencida"]


def test_etl_programada_una_vez_en_la_ventana(entorno, monkeypatch):
    from crm import api
    from crm.etl import pipeline
    corridas = []
    monkeypatch.setattr(pipeline, "ejecutar", lambda *a, **k: corridas.append(1))
    monkeypatch.setattr(api, "get_settings", lambda: type("S", (), {"ads_data_directory": "C:/ADS"})())
    g = gen.get_general()
    assert not api.etl_programada(datetime(2026, 11, 24, 3, 5))              # desactivada
    g.guardar("etl", {"automatica": True, "hora": "03:00"}, "ana")
    assert not api.etl_programada(datetime(2026, 11, 24, 2, 59))             # antes de la hora
    assert api.etl_programada(datetime(2026, 11, 24, 3, 1))
    assert not api.etl_programada(datetime(2026, 11, 24, 3, 30))             # ya corrió hoy
    assert not api.etl_programada(datetime(2026, 11, 25, 8, 0))              # fuera de la ventana de 4 horas
    assert api.etl_programada(datetime(2026, 11, 25, 6, 59))


def _jpg() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (900, 700), "green").save(b, "JPEG")
    return b.getvalue()


def test_fotos_una_a_una(tmp_path):
    from crm.modules.imagenes import fotos, importador
    base = tmp_path / "imagenes"
    info = fotos.subir(base, "101", _jpg(), "Ana")
    assert info["metodo"] == "manual" and info["verificada_por"] == "Ana" and info["v"]
    with Image.open(importador.carpetas(base)[0] / "101.webp") as im:
        assert im.format == "WEBP" and max(im.size) == 600
    with pytest.raises(fotos.FotoInvalida):
        fotos.subir(base, "102", b"<html>no</html>", "Ana")
    assert "verificada_en" not in fotos.verificar(base, "101", "Ana", False)
    assert fotos.verificar(base, "101", "Luis", True)["verificada_por"] == "Luis"
    # La importación masiva no reemplaza una foto subida a mano.
    origen = tmp_path / "o"
    origen.mkdir()
    Image.new("RGB", (100, 100), "red").save(origen / "7700000000001.jpg")
    importador.importar(origen, base, [("101", "7700000000001")], hilos=1)
    assert importador.leer_manifiesto(base)["productos"]["101"]["metodo"] == "manual"
    assert fotos.borrar(base, "101") and not (importador.carpetas(base)[0] / "101.webp").exists()


def test_api_general_publico_y_permisos(tmp_path, monkeypatch):
    from test_seguridad import _cliente
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="lectura-123", CRM_ADMIN_KEY="admin-456")
    lect, adm = {"X-API-Key": "lectura-123"}, {"X-API-Key": "admin-456"}
    try:
        d = c.get("/api/configuracion/general", headers=lect).json()
        assert d["valores"]["reglas"]["vigencia_max_dias"] == 90 and d["puede_editar"] is False
        assert c.put("/api/configuracion/general/empresa", json={"nombre": "X"}, headers=lect).status_code == 403
        assert c.put("/api/configuracion/general/empresa", json={"nombre": "Mercaldas"}, headers=adm).json()["nombre"] == "Mercaldas"
        b = io.BytesIO()
        Image.new("RGBA", (800, 200), (255, 0, 0, 128)).save(b, "PNG")
        assert c.post("/api/configuracion/empresa/logo", content=b.getvalue(), headers={**adm, "Content-Type": "image/png"}).status_code == 200
        assert c.get("/media/empresa/logo.webp").status_code == 200                 # público
        assert c.post("/api/configuracion/legal/politica", content=b"no es pdf", headers=adm).status_code == 422
        assert c.post("/api/configuracion/legal/politica", content=b"%PDF-1.4 x", headers=adm).status_code == 200
        assert c.get("/media/legal/politica.pdf").headers["content-type"] == "application/pdf"
        # Página de baja: pública, con el nombre de la empresa; un token falso no hace nada.
        assert "Enlace no válido" in c.get("/baja?t=falso").text
        t = legal.get_legal().token_baja("1053777666", "email")
        pagina = c.get(f"/baja?t={t}")
        assert pagina.status_code == 200 and "Mercaldas" in pagina.text and "1053777666" not in pagina.text
        listo = c.post("/baja", content=f"t={t}", headers={"Content-Type": "application/x-www-form-urlencoded"})
        assert "Listo" in listo.text and legal.get_legal().bajas() == {"1053777666": frozenset({"email"})}
        r = c.post("/api/configuracion/legal/rne", content="3001234567\n".encode(), headers=adm)
        assert r.status_code == 200 and r.json()["telefonos"] == 1
        assert c.post("/api/configuracion/legal/rne/consultar", json={"valor": "300 123 4567"}, headers=lect).json() == {"en_rne": True}
        assert set(c.get("/api/configuracion/presupuesto/consumo", headers=lect).json()["canales"]) == {"whatsapp", "sms", "email"}
    finally:
        from crm import config
        config.get_settings.cache_clear()


def test_modo_desarrollo_habilita_canales_sin_configurar(entorno):
    from crm.modules.configuracion.servicio import canales_disponibles, motivos_bloqueo
    assert canales_disponibles() == set()
    gen.get_general().fijar_interno("modo_desarrollo", True)
    assert canales_disponibles() == {"whatsapp", "sms", "email"}
    gen.get_general().guardar("presupuesto", {"tope_email": 1}, "ana")   # el tope sigue rigiendo
    s = entorno
    s.publicar(s.crear({"nombre": "x", "mensaje": {"canales": ["email"]}})["id"], [("1", "email")])
    assert "Tope" in motivos_bloqueo()["email"]
    gen.get_general().fijar_interno("modo_desarrollo", False)
    assert canales_disponibles() == set()
