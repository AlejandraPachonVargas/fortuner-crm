"""Configuración de canales: secretos cifrados y nunca devueltos, validación, disponibilidad, permisos y pruebas."""

from __future__ import annotations

import httpx
import pytest

from crm.modules.configuracion import catalogo as cat
from crm.modules.configuracion import pruebas
from crm.modules.configuracion.servicio import Configuracion
from crm.store import Store

TOKEN = "EAAG-token-super-secreto-1234567890-ABCD"
WA = {"phone_number_id": "123456789012345", "waba_id": "987654321098765", "api_version": "v23.0",
      "plantilla_nombre": "promo_general", "plantilla_idioma": "es", "plantilla_encabezado": "imagen",
      "plantilla_variables": ["nombre", "mensaje"], "costo_mensaje": 110}


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    monkeypatch.delenv("CRM_CIFRADO_CLAVE", raising=False)
    return Configuracion(Store(tmp_path / "c.sqlite"), tmp_path)


def test_secreto_cifrado_y_nunca_devuelto(cfg, tmp_path):
    e = cfg.guardar("whatsapp", "meta", WA, {"access_token": TOKEN}, [], True, "ana@127.0.0.1")
    assert e["configurado"] and e["disponible"] and e["faltantes"] == []
    assert e["secretos"]["access_token"] == {"guardado": True, "final": "…ABCD"}
    assert TOKEN not in str(e)
    crudo = (tmp_path / "c.sqlite").read_bytes() + b"".join(p.read_bytes() for p in tmp_path.glob("c.sqlite-*"))
    assert TOKEN.encode() not in crudo                                   # en la base solo está cifrado
    assert cfg.credenciales("whatsapp")[2]["access_token"] == TOKEN      # el servidor sí lo puede usar
    # Guardar sin volver a escribir el token lo conserva; «borrar» lo quita y el canal deja de estar disponible.
    e = cfg.guardar("whatsapp", "meta", {**WA, "costo_mensaje": 130}, {}, [], True, "ana")
    assert e["disponible"] and cfg.costos()["whatsapp"] == 130
    e = cfg.guardar("whatsapp", "meta", WA, {}, ["access_token"], True, "ana")
    assert not e["disponible"] and "Token de acceso permanente" in e["faltantes"]
    # La bitácora registra quién y qué campos, nunca los valores.
    with cfg.store._lock:
        det = [r[0] for r in cfg.store._db.execute("SELECT detalle FROM auditoria WHERE accion='configuracion'")]
    assert any("access_token" in d for d in det) and not any(TOKEN in d for d in det)


def test_disponible_solo_si_completo_y_activo(cfg):
    assert cfg.disponibles() == set()
    cfg.guardar("email", "gmail", {"usuario": "promo@mercaldas.com", "remitente_email": "promo@mercaldas.com",
                                   "remitente_nombre": "Mercaldas", "limite_diario": 500, "costo_mensaje": 0}, {}, [], True, "x")
    assert cfg.disponibles() == set() and "Contraseña de aplicación" in cfg.estado("email")["faltantes"]
    e = cfg.guardar("email", "gmail", {"usuario": "promo@mercaldas.com", "remitente_email": "promo@mercaldas.com",
                                       "remitente_nombre": "Mercaldas", "limite_diario": 500, "costo_mensaje": 0,
                                       "smtp_host": "malicioso.com"}, {"contrasena": "abcd efgh ijkl mnop"}, [], True, "x")
    assert e["datos"]["smtp_host"] == "smtp.gmail.com"                   # campos fijos de Gmail no se pueden cambiar
    assert cfg.disponibles() == {"email"}
    cfg.guardar("email", "gmail", e["datos"], {}, [], False, "x")        # desactivado: configurado pero no disponible
    assert cfg.disponibles() == set() and cfg.estado("email")["configurado"]


def test_validaciones(cfg):
    malos = [("whatsapp", "meta", {**WA, "phone_number_id": "+57 300"}, "formato"),
             ("whatsapp", "meta", {**WA, "plantilla_variables": ["nombre", "contrasena"]}, "variable"),
             ("email", "smtp", {"smtp_host": "smtp.x.com", "smtp_puerto": 70000}, "entre"),
             ("email", "gmail", {"usuario": "no-es-correo"}, "correo"),
             ("sms", "http", {"url": "http://inseguro.com", "encabezado_auth": "Authorization"}, "https"),
             ("sms", "http", {"url": "https://api.x.co", "cuerpo": '{"a": 1}'}, "{numero}"),
             ("sms", "otro", {}, "Proveedor")]
    for canal, prov, datos, texto in malos:
        with pytest.raises(ValueError, match=texto):
            cfg.guardar(canal, prov, datos, {}, [], True, "x")


def test_cambiar_de_proveedor_descarta_credenciales(cfg):
    cfg.guardar("sms", "twilio", {"account_sid": "AC" + "a" * 32, "remitente": "+15550001", "prefijo_pais": 57, "costo_mensaje": 45},
                {"auth_token": "tok-twilio-123456"}, [], True, "x")
    assert cfg.disponibles() == {"sms"}
    e = cfg.guardar("sms", "labsmobile", {"usuario": "a@b.co", "prefijo_pais": 57, "costo_mensaje": 40}, {}, [], True, "x")
    assert not e["configurado"] and e["secretos"]["api_token"]["guardado"] is False


def test_otra_clave_de_cifrado_no_lee_y_falla_cerrado(cfg, monkeypatch):
    from cryptography.fernet import Fernet
    cfg.guardar("whatsapp", "meta", WA, {"access_token": TOKEN}, [], True, "x")
    monkeypatch.setenv("CRM_CIFRADO_CLAVE", Fernet.generate_key().decode())
    e = cfg.estado("whatsapp")
    assert e["error_secretos"] and not e["disponible"] and cfg.disponibles() == set()


# ------------------------------------------------------------------------------------------ probar conexión
def _transporte(monkeypatch, manejador):
    monkeypatch.setattr(pruebas, "_http", lambda: httpx.Client(transport=httpx.MockTransport(manejador)))


def test_probar_whatsapp_ok_y_error_sin_filtrar_el_token(monkeypatch):
    def ok(req: httpx.Request):
        assert req.headers["authorization"] == f"Bearer {TOKEN}" and "/v23.0/123456789012345" in str(req.url)
        return httpx.Response(200, json={"display_phone_number": "+57 300 000 0000", "verified_name": "Mercaldas", "quality_rating": "GREEN"})
    _transporte(monkeypatch, ok)
    assert "Mercaldas" in pruebas.probar("whatsapp", "meta", WA, {"access_token": TOKEN})
    _transporte(monkeypatch, lambda r: httpx.Response(401, json={"error": {"message": "Invalid OAuth access token"}}))
    with pytest.raises(pruebas.PruebaFallida) as e:
        pruebas.probar("whatsapp", "meta", WA, {"access_token": TOKEN})
    assert "credenciales" in str(e.value) and TOKEN not in str(e.value)


def test_plantillas_whatsapp(monkeypatch):
    _transporte(monkeypatch, lambda r: httpx.Response(200, json={"data": [
        {"name": "promo_general", "language": "es", "status": "APPROVED", "category": "MARKETING",
         "components": [{"type": "HEADER", "format": "IMAGE"}, {"type": "BODY", "text": "Hola {{1}}, {{2}}"}]}]}))
    p = pruebas.plantillas_whatsapp(WA, {"access_token": TOKEN})
    assert p == [{"nombre": "promo_general", "idioma": "es", "estado": "APPROVED", "categoria": "MARKETING",
                  "encabezado": "image", "variables": 2, "cuerpo": "Hola {{1}}, {{2}}"}]


def test_probar_sms_twilio(monkeypatch):
    _transporte(monkeypatch, lambda r: httpx.Response(200, json={"friendly_name": "Mercaldas", "status": "active"}))
    assert "Mercaldas" in pruebas.probar("sms", "twilio", {"account_sid": "AC" + "a" * 32}, {"auth_token": "t"})


# ------------------------------------------------------------------------------------------ API y permisos
def test_api_permisos_y_publicar_sin_canal(tmp_path, monkeypatch):
    from test_seguridad import _cliente
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="lectura-123", CRM_ADMIN_KEY="admin-456")
    lect, adm = {"X-API-Key": "lectura-123"}, {"X-API-Key": "admin-456"}
    try:
        assert c.get("/api/configuracion").status_code == 401
        r = c.get("/api/configuracion", headers=lect).json()
        assert r["puede_editar"] is False and set(r["catalogo"]) == set(cat.CANALES)
        assert c.get("/api/configuracion", headers=adm).json()["puede_editar"] is True
        body = {"proveedor": "meta", "datos": WA, "secretos": {"access_token": TOKEN}}
        assert c.put("/api/configuracion/canales/whatsapp", json=body, headers=lect).status_code == 403
        assert c.post("/api/configuracion/canales/whatsapp/probar", headers=lect).status_code == 403
        r = c.put("/api/configuracion/canales/whatsapp", json=body, headers=adm)
        assert r.status_code == 200 and TOKEN not in r.text and r.json()["disponible"]
        assert TOKEN not in c.get("/api/configuracion", headers=lect).text
        assert c.get("/api/configuracion/disponibles", headers=lect).json()["canales"] == {"whatsapp": True, "email": False, "sms": False}
        assert c.put("/api/configuracion/canales/fax", json=body, headers=adm).status_code == 404
        # Probar (sin red): se registra el resultado y no se devuelve el token.
        monkeypatch.setattr(pruebas, "probar", lambda *a: "Conectado al número +57 300")
        r = c.post("/api/configuracion/canales/whatsapp/probar", headers=adm)
        assert r.json()["ok"] and r.json()["canal"]["prueba"]["ok"] and TOKEN not in r.text
        # Publicar una campaña por SMS (no configurado) se rechaza antes de calcular nada.
        cid = c.post("/api/campanas", json={"nombre": "x", "productos": [{"producto_id": "1", "producto": "P"}],
                                            "mensaje": {"canales": ["sms"], "textos": {"sms": {"texto": "Hola"}}}}, headers=adm).json()["id"]
        r = c.post(f"/api/campanas/{cid}/publicar", json={"vigencia_dias": 3}, headers=adm)
        assert r.status_code == 422 and "Configuración" in r.json()["detail"]
    finally:
        from crm import config
        config.get_settings.cache_clear()
