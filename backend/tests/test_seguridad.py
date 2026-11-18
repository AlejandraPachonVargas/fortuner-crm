"""Pruebas de seguridad de la API: autenticación, límites y cabeceras (sin ERP ni warehouse)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from crm import security
from crm.config import Settings


def _cliente(monkeypatch, tmp_path, **env):
    # Vacías (no solo borradas): así no se cuelan las claves del .env real de la máquina donde corren las pruebas.
    for k in ("CRM_API_KEY", "CRM_ADMIN_KEY"):
        monkeypatch.setenv(k, "")
    monkeypatch.setenv("CRM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CRM_ENV", env.pop("CRM_ENV", "development"))
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    from crm import config, store

    config.get_settings.cache_clear()
    store._store = None
    import crm.api as api

    monkeypatch.setattr(api, "get_settings", config.get_settings)
    return TestClient(api.app)


def test_produccion_sin_claves_no_arranca():
    s = Settings(CRM_ENV="production", CRM_API_KEY="", CRM_ADMIN_KEY="", _env_file=None)
    with pytest.raises(security.ConfiguracionInsegura):
        security.verificar_configuracion(s)


def test_api_exige_clave_cuando_esta_configurada(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="clave-de-prueba-123")
    assert c.get("/api/salud").status_code == 200                      # público
    assert c.get("/api/campanas").status_code == 401                   # sin clave
    assert c.get("/api/campanas", headers={"X-API-Key": "mala"}).status_code == 401
    assert c.get("/api/campanas", headers={"X-API-Key": "clave-de-prueba-123"}).status_code == 200
    assert c.get("/api/campanas", headers={"Authorization": "Bearer clave-de-prueba-123"}).status_code == 200


def test_analitica_exige_clave(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="clave-de-prueba-123")
    for ruta in ("/api/analitica/clientes", "/api/analitica/clientes/opciones", "/api/analitica/campanas"):
        assert c.get(ruta).status_code == 401
    # Con clave, el tablero de campañas responde aunque aún no haya ventas cargadas (lo avisa en vez de fallar).
    r = c.get("/api/analitica/campanas", headers={"X-API-Key": "clave-de-prueba-123"})
    assert r.status_code == 200 and r.json()["kpis"]["campanas"] == 0


def test_automatizaciones_exigen_clave_y_ejecutar_exige_admin(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="clave-de-prueba-123", CRM_ADMIN_KEY="clave-admin-456789")
    assert c.get("/api/automatizaciones").status_code == 401
    h = {"X-API-Key": "clave-de-prueba-123"}
    assert c.get("/api/automatizaciones/tipos", headers=h).status_code == 200
    r = c.post("/api/automatizaciones", json={"tipo": "cumpleanos"}, headers=h)
    assert r.status_code == 201 and r.json()["ediciones"][0]["nombre"].startswith("Cumpleaños")
    assert c.post("/api/automatizaciones", json={"tipo": "otro"}, headers=h).status_code == 422
    aid = r.json()["id"]
    assert c.post(f"/api/automatizaciones/{aid}/ejecutar", headers=h).status_code == 403          # solo administración
    assert c.get("/api/automatizaciones/noexiste", headers=h).status_code == 404


def test_etl_solo_con_clave_admin(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="lectura-123", CRM_ADMIN_KEY="admin-456")
    assert c.post("/api/sistema/etl", headers={"X-API-Key": "lectura-123"}).status_code == 403
    assert c.post("/api/sistema/etl").status_code == 401


def test_cabeceras_de_seguridad(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path)
    h = c.get("/api/salud").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
    assert "default-src 'self'" in h["content-security-policy"]


def test_validacion_rechaza_entradas_abusivas(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path)
    assert c.post("/api/campanas", json={"nombre": ""}).status_code == 422
    assert c.post("/api/campanas", json={"nombre": "x" * 500}).status_code == 422
    assert c.post("/api/campanas", json={"nombre": "ok", "mensaje": {"a": "x" * 70_000}}).status_code == 422
    assert c.post("/api/campanas", json={"nombre": "ok", "productos": [{"sin_id": 1}]}).status_code == 422
    r = c.post("/api/campanas", json={"nombre": "ok", "productos": [{"producto_id": "1", "producto": "P", "campo_raro": "<script>"}]})
    assert r.status_code == 201 and "campo_raro" not in r.json()["productos"][0]   # lista blanca de campos


def test_busqueda_con_comodines_y_sql_no_rompe(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path)
    assert c.get("/api/campanas", params={"q": "'; DROP TABLE campana;--"}).status_code == 200
    assert c.get("/api/campanas").status_code == 200                    # la tabla sigue ahí


def test_estado_invalido_se_rechaza(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path)
    assert c.get("/api/campanas", params={"estado": "x"}).status_code == 422


def test_ruta_spa_no_permite_salirse_de_dist(monkeypatch, tmp_path):
    c = _cliente(monkeypatch, tmp_path)
    r = c.get("/..%2f..%2f.env")
    assert r.status_code in (200, 404) and "ADS_PASSWORD" not in r.text


def test_limitador_de_tasa():
    from fastapi import HTTPException

    lim = security.RateLimiter()
    for _ in range(3):
        lim.check("ip", 3)
    with pytest.raises(HTTPException) as e:
        lim.check("ip", 3)
    assert e.value.status_code == 429
    lim.check("otra", 3)
    lim.check("ip", 0)  # 0 = sin límite
