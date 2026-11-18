"""Tipos de automatización, sus parámetros (con límites) y los textos por defecto de cada uno.

La pantalla dibuja los controles a partir de ``TIPOS[...]["params"]``: agregar un parámetro aquí basta para que aparezca.
Marcadores en los mensajes: ``{nombre}`` (cliente), ``{oferta}`` (lo que se ofrece en la edición) y ``{vigencia}``
(«del 22 al 28 de noviembre de 2026», calculada para cada persona desde el día en que se le envía).
"""

from __future__ import annotations

import re
from datetime import date

CANALES = ("whatsapp", "sms", "email")
TIPOS_OFERTA = {
    "descuento_pct": "Descuento en porcentaje",
    "descuento_valor": "Descuento en pesos",
    "producto": "Producto de regalo o con precio especial",
    "regalo": "Regalo o detalle",
    "otro": "Otro beneficio",
}
SEGMENTOS = ("campeones", "leales", "potenciales", "nuevos", "prometedores", "atencion", "no_perder", "en_riesgo",
             "hibernando", "perdidos", "sin_compras")

# Límites de los textos (los mismos que Campañas).
_LIMITES = {"whatsapp": {"texto": 1200}, "sms": {"texto": 400}, "email": {"asunto": 150, "preheader": 200, "cuerpo": 5000}}


def _p(clave: str, label: str, minimo: float, maximo: float, defecto: float, unidad: str, ayuda: str, paso: float = 1) -> dict:
    return {"clave": clave, "label": label, "min": minimo, "max": maximo, "defecto": defecto, "unidad": unidad, "ayuda": ayuda, "paso": paso}


def _comunes(cooldown: int, tope: int) -> list[dict]:
    return [
        _p("cooldown_dias", "No repetir a la misma persona antes de", 1, 3650, cooldown, "días",
           "Aunque vuelva a cumplir la condición, no recibe otra vez este mensaje dentro de ese plazo."),
        _p("tope_diario", "Máximo de envíos por día", 1, 20000, tope, "personas",
           "Límite de seguridad para el costo: si hay más, se priorizan los clientes de mayor valor."),
    ]


TIPOS: dict[str, dict] = {
    "cumpleanos": {
        "nombre": "Cumpleaños",
        "descripcion": "Saluda a cada cliente en su cumpleaños (o unos días antes) con un detalle.",
        "disparo": "El día del cumpleaños, según la fecha de nacimiento del ERP",
        "params": [_p("dias_antes", "Enviar antes del cumpleaños", 0, 7, 0, "días",
                      "0 = el mismo día del cumpleaños. Quien nació un 29 de febrero lo recibe el 28 en los años no bisiestos."),
                   *_comunes(330, 1000)],
        "validez_dias": 7,
        "oferta": {"tipo": "descuento_pct", "valor": 10},
        "textos": {
            "whatsapp": {"texto": "🎂 ¡Feliz cumpleaños, {nombre}!\n\nQueremos celebrarlo contigo: *{oferta}*.\n\nVálido {vigencia}. ¡Te esperamos en la tienda!"},
            "sms": {"texto": "Feliz cumpleanos {nombre}! Te regalamos {oferta}. Valido {vigencia}. Te esperamos!"},
            "email": {"asunto": "¡Feliz cumpleaños, {nombre}! Tenemos un detalle para ti", "preheader": "{oferta}",
                      "cuerpo": "Hola {nombre}:\n\nHoy es un día especial y queremos celebrarlo contigo. Como regalo de cumpleaños tienes {oferta}.\n\nVálido {vigencia}.\n\n¡Te esperamos en la tienda!"},
        },
    },
    "bienvenida": {
        "nombre": "Bienvenida",
        "descripcion": "Da la bienvenida a cada cliente nuevo el día que se registra (o unos días después).",
        "disparo": "Cuando se crea la ficha del cliente en el ERP o en el CRM",
        "params": [_p("dias_despues", "Enviar después del registro", 0, 30, 0, "días", "0 = el mismo día en que se crea la ficha."),
                   *_comunes(3650, 1000)],
        "validez_dias": 15,
        "oferta": {"tipo": "descuento_pct", "valor": 10},
        "textos": {
            "whatsapp": {"texto": "🎉 ¡Te damos la bienvenida, {nombre}!\n\nGracias por registrarte. Para empezar tienes *{oferta}*.\n\nVálido {vigencia}. ¡Nos vemos pronto!"},
            "sms": {"texto": "Bienvenido(a) {nombre}! Gracias por registrarte. Tienes {oferta}. Valido {vigencia}."},
            "email": {"asunto": "¡Te damos la bienvenida, {nombre}!", "preheader": "Un regalo para empezar: {oferta}",
                      "cuerpo": "Hola {nombre}:\n\nGracias por registrarte. Desde hoy recibirás nuestras mejores ofertas.\n\nPara empezar tienes {oferta}. Válido {vigencia}.\n\n¡Nos vemos pronto en la tienda!"},
        },
    },
    "segunda_compra": {
        "nombre": "Segunda compra",
        "descripcion": "Invita a volver a quien hizo su primera compra y todavía no ha regresado.",
        "disparo": "N días después de la primera compra, si aún no hay una segunda",
        "params": [_p("dias_despues", "Enviar después de la primera compra", 1, 60, 7, "días",
                      "Solo se envía si en ese tiempo el cliente no ha vuelto a comprar."),
                   *_comunes(3650, 1000)],
        "validez_dias": 15,
        "oferta": {"tipo": "descuento_pct", "valor": 10},
        "textos": {
            "whatsapp": {"texto": "Hola {nombre} 😊\n\nGracias por tu primera compra. Queremos verte de nuevo: tienes *{oferta}*.\n\nVálido {vigencia}."},
            "sms": {"texto": "Hola {nombre}, gracias por tu primera compra! Vuelve y aprovecha {oferta}. Valido {vigencia}."},
            "email": {"asunto": "{nombre}, gracias por tu primera compra", "preheader": "Vuelve y aprovecha {oferta}",
                      "cuerpo": "Hola {nombre}:\n\nGracias por elegirnos. Queremos verte de nuevo, así que tienes {oferta}.\n\nVálido {vigencia}.\n\n¡Te esperamos!"},
        },
    },
    "reactivacion": {
        "nombre": "Reactivación",
        "descripcion": "Recupera a los clientes frecuentes que dejaron de venir más tiempo del habitual.",
        "disparo": "Cuando un cliente supera su ritmo habitual de compra sin volver",
        "params": [_p("umbral_ratio", "Lleva sin comprar más de", 1.2, 6, 1.5, "veces su tiempo habitual",
                      "Ejemplo: si suele venir cada 10 días, con 1,5 se le escribe a los 15 días sin comprar.", 0.1),
                   _p("min_visitas", "Mínimo de compras previas", 2, 50, 3, "compras", "Para conocer su ritmo habitual hacen falta varias compras."),
                   _p("max_dias_sin_compra", "Hasta un máximo de", 30, 1095, 365, "días sin comprar",
                      "Más allá de ese plazo se considera perdido y no se le escribe."),
                   *_comunes(90, 500)],
        "validez_dias": 15,
        "oferta": {"tipo": "descuento_pct", "valor": 15},
        "textos": {
            "whatsapp": {"texto": "Hola {nombre} 💙\n\nTe extrañamos. Hace tiempo no te vemos por la tienda y queremos tenerte de vuelta: *{oferta}*.\n\nVálido {vigencia}."},
            "sms": {"texto": "Hola {nombre}, te extranamos! Vuelve y aprovecha {oferta}. Valido {vigencia}."},
            "email": {"asunto": "{nombre}, te extrañamos", "preheader": "Vuelve y aprovecha {oferta}",
                      "cuerpo": "Hola {nombre}:\n\nHace tiempo no te vemos por la tienda y te extrañamos. Para que vuelvas tienes {oferta}.\n\nVálido {vigencia}.\n\n¡Te esperamos!"},
        },
    },
}


# ------------------------------------------------------------------------------------------ normalización
def normalizar_params(tipo: str, params: dict | None) -> dict:
    """Todos los parámetros del tipo, dentro de sus límites (lo inválido vuelve al valor por defecto)."""
    params = params or {}
    out = {}
    for d in TIPOS[tipo]["params"]:
        try:
            v = float(params.get(d["clave"], d["defecto"]))
        except (TypeError, ValueError):
            v = d["defecto"]
        v = min(d["max"], max(d["min"], v))
        out[d["clave"]] = round(v, 2) if d["paso"] < 1 else int(round(v))
    return out


def normalizar_filtros(f: dict | None) -> dict:
    f = f or {}
    clubes = [str(c)[:10] for c in (f.get("clubes") or []) if str(c).isalnum()][:20]
    segmentos = [s for s in (f.get("segmentos") or []) if s in SEGMENTOS]
    return {"clubes": list(dict.fromkeys(clubes)), "segmentos": list(dict.fromkeys(segmentos))}


def normalizar_hora(h: str | None) -> str:
    h = (h or "").strip()
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", h):
        raise ValueError("La hora debe tener el formato HH:MM (por ejemplo 09:00).")
    return h


def _pesos(v: float) -> str:
    return "$" + f"{int(round(v)):,}".replace(",", ".")


def texto_oferta(oferta: dict) -> str:
    """Texto por defecto de la oferta (lo que reemplaza a {oferta} si no se escribió uno propio)."""
    v = oferta.get("valor")
    if oferta.get("tipo") == "descuento_pct" and v:
        return f"{float(v):g}% de descuento en tu compra".replace(".", ",")
    if oferta.get("tipo") == "descuento_valor" and v:
        return f"{_pesos(float(v))} de descuento en tu compra"
    return ""


def _producto(p: dict) -> dict:
    out = {k: (p[k][:200] if isinstance(p[k], str) else p[k]) for k in ("producto_id", "producto", "marca", "precio_venta", "familia", "grupo")
           if k in p and p[k] is not None}
    if not out.get("producto_id"):
        raise ValueError("Cada producto de la oferta necesita su código.")
    return out


def normalizar_oferta(o: dict | None) -> dict:
    o = o or {}
    tipo = o.get("tipo")
    if tipo not in TIPOS_OFERTA:
        raise ValueError("Elija qué se ofrece (descuento, producto, regalo u otro).")
    valor = o.get("valor")
    try:
        valor = float(valor) if valor not in (None, "") else None
    except (TypeError, ValueError):
        raise ValueError("El valor de la oferta no es un número.") from None
    if tipo == "descuento_pct" and not (valor and 0 < valor <= 100):
        raise ValueError("El descuento en porcentaje debe estar entre 1 y 100.")
    if tipo == "descuento_valor" and not (valor and 0 < valor <= 100_000_000):
        raise ValueError("Indique el valor del descuento en pesos.")
    out = {"tipo": tipo, "valor": valor if tipo.startswith("descuento") else None,
           "productos": [_producto(p) for p in (o.get("productos") or [])[:20]],
           "restringido": bool(o.get("restringido"))}
    desc = re.sub(r"\s+", " ", str(o.get("descripcion") or "")).strip()[:200]
    out["descripcion"] = desc or texto_oferta(out)
    if not out["descripcion"]:
        raise ValueError("Describa la oferta: es el texto que reemplaza a {oferta} en los mensajes.")
    return out


def normalizar_textos(t: dict | None) -> dict:
    t = t or {}
    out: dict = {}
    for canal, campos in _LIMITES.items():
        c = t.get(canal) or {}
        if not isinstance(c, dict):
            continue
        out[canal] = {k: str(c.get(k) or "")[:lim] for k, lim in campos.items()}
    return out


def normalizar_edicion(d: dict) -> dict:
    nombre = re.sub(r"\s+", " ", str(d.get("nombre") or "")).strip()[:60]
    if not nombre:
        raise ValueError("Ponga un nombre a la edición (por ejemplo «Cumpleaños 2026»).")
    try:
        desde, hasta = date.fromisoformat(str(d.get("desde"))[:10]), date.fromisoformat(str(d.get("hasta"))[:10])
    except ValueError:
        raise ValueError("Las fechas de la edición no son válidas.") from None
    if hasta < desde:
        raise ValueError("La fecha final de la edición es anterior a la inicial.")
    try:
        validez = int(d.get("validez_dias") or 0)
    except (TypeError, ValueError):
        validez = 0
    if not 1 <= validez <= 90:
        raise ValueError("La validez de la oferta debe ser de 1 a 90 días.")
    canales = [c for c in CANALES if c in (d.get("canales") or [])]
    return {"nombre": nombre, "desde": desde.isoformat(), "hasta": hasta.isoformat(), "oferta": normalizar_oferta(d.get("oferta")),
            "validez_dias": validez, "canales": canales, "textos": normalizar_textos(d.get("textos"))}


def problemas_edicion(ed: dict) -> list[str]:
    """Lo que impide que una edición se envíe (se puede guardar incompleta, pero no se activa ni se ejecuta así)."""
    out = []
    if not ed.get("canales"):
        out.append("Elija al menos un canal.")
    t = ed.get("textos") or {}
    nombres = {"whatsapp": "WhatsApp", "sms": "SMS", "email": "correo"}
    for c in ed.get("canales") or []:
        falta = not (t.get(c) or {}).get("cuerpo" if c == "email" else "texto", "").strip()
        if c == "email" and not (t.get("email") or {}).get("asunto", "").strip():
            falta = True
        if falta:
            out.append(f"Falta el mensaje de {nombres[c]}.")
    if not (ed.get("oferta") or {}).get("descripcion"):
        out.append("Falta describir la oferta.")
    return out


def edicion_por_defecto(tipo: str, anio: int) -> dict:
    t = TIPOS[tipo]
    return normalizar_edicion({"nombre": f"{t['nombre']} {anio}", "desde": f"{anio}-01-01", "hasta": f"{anio}-12-31",
                               "oferta": dict(t["oferta"]), "validez_dias": t["validez_dias"], "canales": ["whatsapp", "email"],
                               "textos": t["textos"]})


def catalogo_publico() -> list[dict]:
    return [{"id": k, "nombre": v["nombre"], "descripcion": v["descripcion"], "disparo": v["disparo"], "params": v["params"]}
            for k, v in TIPOS.items()]
