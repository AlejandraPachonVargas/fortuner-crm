"""«Probar conexión»: comprueba las credenciales de cada proveedor SIN enviar ningún mensaje.

* WhatsApp (Meta): lee el número (nombre verificado y calidad) con el token.
* Correo: abre la conexión SMTP cifrada e inicia sesión; no envía nada.
* SMS: consulta la cuenta o el saldo (Twilio, Infobip, LabsMobile). El proveedor HTTP genérico no tiene una consulta
  estándar: solo se valida que la dirección responda.

Los errores se traducen a mensajes para la persona y NUNCA incluyen el token ni la contraseña.
"""

from __future__ import annotations

import smtplib
import ssl

import httpx

TIEMPO = 15.0
GRAPH = "https://graph.facebook.com"


class PruebaFallida(Exception):
    """La conexión no funcionó; el mensaje es apto para mostrar en pantalla."""


def _http() -> httpx.Client:
    return httpx.Client(timeout=TIEMPO, follow_redirects=False)


def _error_http(r: httpx.Response, que: str) -> PruebaFallida:
    if r.status_code in (401, 403):
        return PruebaFallida(f"{que}: las credenciales no son válidas o no tienen permiso (HTTP {r.status_code}).")
    if r.status_code == 404:
        return PruebaFallida(f"{que}: no se encontró el recurso; revise los identificadores (HTTP 404).")
    detalle = ""
    try:
        j = r.json()
        detalle = (j.get("error") or {}).get("message", "") if isinstance(j.get("error"), dict) else str(j.get("message", ""))
    except ValueError:
        pass
    return PruebaFallida(f"{que}: respondió HTTP {r.status_code}. {detalle[:200]}".strip())


def _red(e: Exception, que: str) -> PruebaFallida:
    if isinstance(e, httpx.TimeoutException):
        return PruebaFallida(f"{que}: no respondió en {TIEMPO:.0f} segundos.")
    return PruebaFallida(f"{que}: no se pudo conectar ({type(e).__name__}). Revise la conexión a internet del servidor.")


# ------------------------------------------------------------------------------------------ WhatsApp
def _graph(datos: dict, secretos: dict, ruta: str, params: dict) -> dict:
    url = f"{GRAPH}/{datos['api_version']}/{ruta}"
    try:
        with _http() as c:
            r = c.get(url, params=params, headers={"Authorization": f"Bearer {secretos['access_token']}"})
    except httpx.HTTPError as e:
        raise _red(e, "Meta") from None
    if r.status_code != 200:
        raise _error_http(r, "Meta")
    return r.json()


def probar_whatsapp(datos: dict, secretos: dict) -> str:
    j = _graph(datos, secretos, datos["phone_number_id"], {"fields": "display_phone_number,verified_name,quality_rating"})
    return (f"Conectado al número {j.get('display_phone_number', '?')} ({j.get('verified_name', 'sin nombre verificado')}). "
            f"Calidad: {j.get('quality_rating', 'sin dato')}.")


def plantillas_whatsapp(datos: dict, secretos: dict) -> list[dict]:
    """Plantillas de la cuenta (todas las páginas, máx. 500) con lo necesario para elegirlas y mapear variables."""
    out, despues = [], None
    for _ in range(10):
        params = {"fields": "name,language,status,category,components", "limit": 100}
        if despues:
            params["after"] = despues
        j = _graph(datos, secretos, f"{datos['waba_id']}/message_templates", params)
        for t in j.get("data", []):
            comps = t.get("components") or []
            cuerpo = next((c.get("text", "") for c in comps if c.get("type") == "BODY"), "")
            enc = next((c.get("format", "TEXT") for c in comps if c.get("type") == "HEADER"), None)
            out.append({"nombre": t.get("name"), "idioma": t.get("language"), "estado": t.get("status"),
                        "categoria": t.get("category"), "encabezado": (enc or "NINGUNO").lower(),
                        "variables": cuerpo.count("{{"), "cuerpo": cuerpo[:1024]})
        despues = ((j.get("paging") or {}).get("cursors") or {}).get("after") if (j.get("paging") or {}).get("next") else None
        if not despues or len(out) >= 500:
            break
    return out


# ------------------------------------------------------------------------------------------ correo
def probar_email(datos: dict, secretos: dict) -> str:
    host, puerto = datos["smtp_host"], int(datos["smtp_puerto"])
    ctx = ssl.create_default_context()
    try:
        if datos["seguridad"] == "ssl":
            s = smtplib.SMTP_SSL(host, puerto, timeout=TIEMPO, context=ctx)
        else:
            s = smtplib.SMTP(host, puerto, timeout=TIEMPO)
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
        with s:
            s.login(datos["usuario"], secretos["contrasena"])
    except smtplib.SMTPAuthenticationError:
        raise PruebaFallida("El servidor de correo rechazó el usuario o la contraseña. En Gmail use una «contraseña de "
                            "aplicación», no la contraseña normal.") from None
    except (smtplib.SMTPException, ssl.SSLError) as e:
        raise PruebaFallida(f"El servidor de correo respondió con un error ({type(e).__name__}). Revise servidor, puerto y seguridad.") from None
    except OSError as e:
        raise PruebaFallida(f"No se pudo conectar a {host}:{puerto} ({type(e).__name__}). Revise el servidor y el puerto.") from None
    return f"Sesión iniciada en {host}:{puerto} como {datos['usuario']}. No se envió ningún correo."


# ------------------------------------------------------------------------------------------ SMS
def probar_sms(proveedor: str, datos: dict, secretos: dict) -> str:
    try:
        with _http() as c:
            if proveedor == "twilio":
                sid = datos["account_sid"]
                r = c.get(f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json", auth=(sid, secretos["auth_token"]))
                if r.status_code != 200:
                    raise _error_http(r, "Twilio")
                j = r.json()
                return f"Cuenta Twilio «{j.get('friendly_name', sid)}» ({j.get('status', '?')}). No se envió ningún SMS."
            if proveedor == "infobip":
                r = c.get(datos["base_url"].rstrip("/") + "/account/1/balance", headers={"Authorization": f"App {secretos['api_key']}"})
                if r.status_code != 200:
                    raise _error_http(r, "Infobip")
                j = r.json()
                return f"Cuenta Infobip conectada. Saldo: {j.get('balance', '?')} {j.get('currency', '')}. No se envió ningún SMS."
            if proveedor == "labsmobile":
                r = c.get("https://api.labsmobile.com/json/balance", auth=(datos["usuario"], secretos["api_token"]))
                if r.status_code != 200:
                    raise _error_http(r, "LabsMobile")
                j = r.json()
                return f"Cuenta LabsMobile conectada. Créditos: {j.get('credits', '?')}. No se envió ningún SMS."
            # Genérico: no hay una consulta estándar; se comprueba que la dirección exista y responda.
            r = c.request("HEAD", datos["url"])
            if r.status_code >= 500:
                raise _error_http(r, "Proveedor SMS")
            return (f"La dirección del proveedor responde (HTTP {r.status_code}). Este tipo de proveedor no permite validar "
                    f"la clave sin enviar un SMS: confírmela con el proveedor.")
    except httpx.HTTPError as e:
        raise _red(e, "Proveedor SMS") from None


def probar(canal: str, proveedor: str, datos: dict, secretos: dict) -> str:
    if canal == "whatsapp":
        return probar_whatsapp(datos, secretos)
    if canal == "email":
        return probar_email(datos, secretos)
    return probar_sms(proveedor, datos, secretos)
