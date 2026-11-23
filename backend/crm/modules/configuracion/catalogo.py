"""Qué pide cada canal y cada proveedor. La pantalla de Configuración se dibuja a partir de esta lista, y la validación
del servidor usa la misma, así que agregar un campo aquí lo agrega en los dos lados.

Tipos de campo: ``texto``, ``secreto`` (se guarda cifrado y nunca vuelve a la pantalla), ``numero``, ``email``, ``url``,
``opcion`` (lista cerrada) y ``variables`` (las variables {{1}}, {{2}}… de la plantilla de WhatsApp).
"""

from __future__ import annotations

import re

CANALES = ("whatsapp", "email", "sms")
NOMBRE_CANAL = {"whatsapp": "WhatsApp", "email": "Correo electrónico", "sms": "Mensaje de texto (SMS)"}
COSTO_DEFECTO = {"whatsapp": 120.0, "sms": 45.0, "email": 3.0}   # COP por mensaje; editable en Configuración

# Fuentes que puede tomar cada variable de la plantilla de WhatsApp.
FUENTES_VARIABLE = {
    "nombre": "Nombre del cliente",
    "mensaje": "Texto de la campaña",
    "vigencia": "Vigencia de la oferta",
    "oferta": "Oferta (Automatizaciones)",
    "tienda": "Nombre de la tienda",
}


def _campo(clave: str, etiqueta: str, tipo: str = "texto", *, requerido: bool = True, ayuda: str = "", defecto=None,
           opciones: dict | None = None, patron: str | None = None, minimo: float | None = None, maximo: float | None = None,
           fijo: bool = False) -> dict:
    return {"clave": clave, "etiqueta": etiqueta, "tipo": tipo, "requerido": requerido, "ayuda": ayuda, "defecto": defecto,
            "opciones": opciones, "patron": patron, "minimo": minimo, "maximo": maximo, "fijo": fijo}


def _costo(canal: str) -> dict:
    return _campo("costo_mensaje", "Costo por mensaje (COP)", "numero", defecto=COSTO_DEFECTO[canal], minimo=0, maximo=5000,
                  ayuda="Lo que cobra el proveedor por cada mensaje. Se usa para estimar el costo de campañas y automatizaciones.")


_DIGITOS = r"^[0-9]{5,30}$"

WHATSAPP = {
    "meta": {
        "nombre": "WhatsApp Business Platform (API de Meta)",
        "ayuda": "Se configura en business.facebook.com y developers.facebook.com. Ver el manual de Configuración.",
        "campos": [
            _campo("access_token", "Token de acceso permanente", "secreto",
                   ayuda="Token de un usuario del sistema con permisos whatsapp_business_messaging y whatsapp_business_management."),
            _campo("phone_number_id", "Identificador del número de teléfono", patron=_DIGITOS,
                   ayuda="«Phone number ID» en WhatsApp › Configuración de la API. No es el número de celular."),
            _campo("waba_id", "Identificador de la cuenta de WhatsApp Business", patron=_DIGITOS,
                   ayuda="«WhatsApp Business Account ID». Se usa para leer las plantillas aprobadas."),
            _campo("api_version", "Versión de la API Graph", defecto="v23.0", patron=r"^v[0-9]{1,3}\.[0-9]{1,2}$",
                   ayuda="Formato vNN.N. Use la versión vigente que indique Meta en su panel de desarrolladores."),
            _campo("plantilla_nombre", "Plantilla de marketing para campañas", patron=r"^[a-z0-9_]{1,512}$",
                   ayuda="Nombre exacto de una plantilla APROBADA por Meta (categoría Marketing). Meta solo permite iniciar "
                         "conversaciones con plantillas aprobadas."),
            _campo("plantilla_idioma", "Idioma de la plantilla", defecto="es", patron=r"^[a-z]{2,3}(_[A-Z]{2})?$",
                   ayuda="Código de idioma con el que se aprobó la plantilla: es, es_MX, es_ES…"),
            _campo("plantilla_encabezado", "Encabezado de la plantilla", "opcion", defecto="imagen",
                   opciones={"ninguno": "Sin encabezado", "imagen": "Imagen (banner o foto del producto)", "texto": "Texto"},
                   ayuda="Debe coincidir con la plantilla aprobada. Con «Imagen» se envía el banner de la campaña o la foto del producto."),
            _campo("plantilla_variables", "Variables del cuerpo de la plantilla", "variables", defecto=["nombre", "mensaje"],
                   ayuda="Qué va en cada variable {{1}}, {{2}}… del cuerpo, en el mismo orden de la plantilla aprobada."),
            _campo("app_secret", "Clave secreta de la aplicación (App Secret)", "secreto", requerido=False,
                   ayuda="Opcional hoy. Se necesitará para verificar los avisos de entrega y las respuestas (webhook)."),
            _campo("verify_token", "Token de verificación del webhook", "secreto", requerido=False,
                   ayuda="Opcional hoy. Una palabra secreta que usted inventa y escribe igual en el panel de Meta."),
            _costo("whatsapp"),
        ],
    },
}

_SEGURIDAD = {"starttls": "STARTTLS (puerto 587)", "ssl": "SSL/TLS (puerto 465)"}
_CAMPOS_REMITENTE = [
    _campo("remitente_email", "Correo del remitente", "email", ayuda="La dirección desde la que salen los correos."),
    _campo("remitente_nombre", "Nombre del remitente", defecto="Mercaldas", ayuda="Lo que el cliente ve en la bandeja de entrada."),
    _campo("responder_a", "Responder a", "email", requerido=False, ayuda="Opcional: a dónde llegan las respuestas de los clientes."),
    _campo("limite_diario", "Máximo de correos por día", "numero", defecto=500, minimo=1, maximo=1_000_000,
           ayuda="Límite del proveedor. Gmail: 500 (cuenta personal) o 2.000 (Google Workspace)."),
]
EMAIL = {
    "gmail": {
        "nombre": "Gmail o Google Workspace",
        "ayuda": "Requiere verificación en dos pasos y una «contraseña de aplicación» de 16 letras (no la contraseña normal).",
        "campos": [
            _campo("smtp_host", "Servidor SMTP", defecto="smtp.gmail.com", fijo=True),
            _campo("smtp_puerto", "Puerto", "numero", defecto=587, fijo=True),
            _campo("seguridad", "Seguridad", "opcion", defecto="starttls", opciones=_SEGURIDAD, fijo=True),
            _campo("usuario", "Cuenta de Gmail", "email", ayuda="La cuenta completa, p. ej. promociones@mercaldas.com."),
            _campo("contrasena", "Contraseña de aplicación", "secreto",
                   ayuda="Se crea en myaccount.google.com › Seguridad › Contraseñas de aplicaciones."),
            *_CAMPOS_REMITENTE,
            _costo("email"),
        ],
    },
    "smtp": {
        "nombre": "Otro proveedor SMTP (Outlook, SendGrid, Amazon SES, Brevo…)",
        "ayuda": "Los datos los entrega el proveedor de correo.",
        "campos": [
            _campo("smtp_host", "Servidor SMTP", patron=r"^[A-Za-z0-9.-]{3,253}$", ayuda="p. ej. smtp.office365.com"),
            _campo("smtp_puerto", "Puerto", "numero", defecto=587, minimo=1, maximo=65535),
            _campo("seguridad", "Seguridad", "opcion", defecto="starttls", opciones=_SEGURIDAD,
                   ayuda="Nunca se permite enviar sin cifrado."),
            _campo("usuario", "Usuario SMTP"),
            _campo("contrasena", "Contraseña o clave SMTP", "secreto"),
            *_CAMPOS_REMITENTE,
            _costo("email"),
        ],
    },
}

_REMITENTE_SMS = _campo("remitente", "Remitente", requerido=False,
                        ayuda="Número o nombre corto con el que llega el SMS (según lo que permita el proveedor).")
_PREFIJO = _campo("prefijo_pais", "Indicativo del país", "numero", defecto=57, minimo=1, maximo=999,
                  ayuda="Se antepone a los celulares de 10 dígitos (Colombia: 57).")
SMS = {
    "twilio": {
        "nombre": "Twilio",
        "ayuda": "Datos en console.twilio.com (Account Info).",
        "campos": [
            _campo("account_sid", "Account SID", patron=r"^AC[0-9a-fA-F]{32}$"),
            _campo("auth_token", "Auth Token", "secreto"),
            _campo("remitente", "Número remitente o Messaging Service SID",
                   ayuda="Número comprado en Twilio (+1…) o un Messaging Service (MG…)."),
            _PREFIJO, _costo("sms"),
        ],
    },
    "infobip": {
        "nombre": "Infobip",
        "ayuda": "La URL base y la API key están en el portal de Infobip (Developers › API Keys).",
        "campos": [
            _campo("base_url", "URL base de la API", "url", ayuda="La URL personal de su cuenta, p. ej. https://xxxxx.api.infobip.com"),
            _campo("api_key", "API key", "secreto"),
            _REMITENTE_SMS, _PREFIJO, _costo("sms"),
        ],
    },
    "labsmobile": {
        "nombre": "LabsMobile",
        "ayuda": "Usuario (correo de la cuenta) y token de API del panel de LabsMobile.",
        "campos": [
            _campo("usuario", "Usuario (correo de la cuenta)", "email"),
            _campo("api_token", "Token de API", "secreto"),
            _REMITENTE_SMS, _PREFIJO, _costo("sms"),
        ],
    },
    "http": {
        "nombre": "Otro proveedor (API HTTP: Hablame, Aldeamo, Masivapp…)",
        "ayuda": "Para proveedores colombianos con API propia. Los datos exactos los entrega el proveedor.",
        "campos": [
            _campo("url", "URL de envío", "url", ayuda="La dirección (https) a la que se envía cada SMS."),
            _campo("encabezado_auth", "Nombre del encabezado de autenticación", defecto="Authorization",
                   patron=r"^[A-Za-z0-9-]{1,60}$", ayuda="p. ej. Authorization, X-Api-Key, account…"),
            _campo("valor_auth", "Valor del encabezado (clave o token)", "secreto", ayuda="p. ej. «Bearer abc123…»"),
            _campo("cuerpo", "Cuerpo de la petición (JSON)", defecto='{"numero": "{numero}", "sms": "{mensaje}"}',
                   ayuda="Use {numero} y {mensaje} donde van el celular y el texto. Debe ser un JSON válido."),
            _REMITENTE_SMS, _PREFIJO, _costo("sms"),
        ],
    },
}

PROVEEDORES = {"whatsapp": WHATSAPP, "email": EMAIL, "sms": SMS}


def campos(canal: str, proveedor: str) -> list[dict]:
    return PROVEEDORES[canal][proveedor]["campos"]


def proveedor_valido(canal: str, proveedor: str | None) -> bool:
    return canal in PROVEEDORES and proveedor in PROVEEDORES[canal]


def validar_valor(c: dict, v):
    """Devuelve el valor limpio o lanza ValueError con un mensaje para la persona."""
    if v is None or v == "" or v == []:
        return None
    t = c["tipo"]
    if t == "numero":
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"«{c['etiqueta']}» debe ser un número.") from None
        if (c["minimo"] is not None and n < c["minimo"]) or (c["maximo"] is not None and n > c["maximo"]):
            raise ValueError(f"«{c['etiqueta']}» debe estar entre {c['minimo']:g} y {c['maximo']:g}.")
        return int(n) if n.is_integer() else n
    if t == "variables":
        if not isinstance(v, list) or len(v) > 10 or any(x not in FUENTES_VARIABLE for x in v):
            raise ValueError(f"«{c['etiqueta']}»: elija para cada variable una de las opciones de la lista.")
        return list(v)
    s = str(v).strip()
    if len(s) > 4000:
        raise ValueError(f"«{c['etiqueta']}» es demasiado largo.")
    if t == "opcion" and s not in (c["opciones"] or {}):
        raise ValueError(f"«{c['etiqueta']}»: opción no válida.")
    if t == "email" and not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,255}\.[A-Za-z]{2,}", s):
        raise ValueError(f"«{c['etiqueta']}» no es un correo válido.")
    if t == "url" and not re.fullmatch(r"https://[^\s]{4,500}", s):
        raise ValueError(f"«{c['etiqueta']}» debe ser una dirección que empiece por https://")
    if c["patron"] and not re.fullmatch(c["patron"], s):
        raise ValueError(f"«{c['etiqueta']}» no tiene el formato esperado.")
    if c["clave"] == "cuerpo":
        _validar_cuerpo_json(s)
    return s


def _validar_cuerpo_json(s: str) -> None:
    import json
    if "{numero}" not in s or "{mensaje}" not in s:
        raise ValueError("El cuerpo de la petición debe incluir {numero} y {mensaje}.")
    try:
        json.loads(s.replace("{numero}", "573000000000").replace("{mensaje}", "x"))
    except ValueError:
        raise ValueError("El cuerpo de la petición no es un JSON válido.") from None
