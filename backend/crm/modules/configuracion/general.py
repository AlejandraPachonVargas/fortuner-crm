"""Configuración general del CRM: empresa, cumplimiento legal, reglas de campañas, presupuesto y carga del ERP.

Todo se guarda en crm.sqlite (tabla ``configuracion_general``, una fila por sección con un JSON). Cada lectura mezcla lo
guardado con los valores por defecto, así que un CRM recién instalado funciona igual que antes de existir esta pantalla.
El esquema de abajo dibuja la pantalla y valida lo que llega, igual que el catálogo de canales.
"""

from __future__ import annotations

import json
import re
from datetime import datetime

from ...store import Store, get_store

DDL = """
CREATE TABLE IF NOT EXISTS configuracion_general (
    seccion         TEXT PRIMARY KEY,
    datos           TEXT NOT NULL DEFAULT '{}',
    actualizado     TEXT,
    actualizado_por TEXT
);
"""

CANALES = ("whatsapp", "sms", "email")


def _c(clave, etiqueta, tipo="texto", *, defecto=None, ayuda="", minimo=None, maximo=None, opciones=None, requerido=False):
    return {"clave": clave, "etiqueta": etiqueta, "tipo": tipo, "defecto": defecto, "ayuda": ayuda, "minimo": minimo,
            "maximo": maximo, "opciones": opciones, "requerido": requerido}


ESQUEMA: dict[str, dict] = {
    "empresa": {
        "titulo": "Empresa",
        "campos": [
            _c("nombre", "Nombre comercial", defecto="Mi empresa", requerido=True,
               ayuda="Aparece como remitente en WhatsApp y correo, en la página de baja y en los textos de la IA."),
            _c("razon_social", "Razón social", ayuda="Para el pie legal del correo."),
            _c("nit", "NIT", ayuda="Opcional. Para el pie legal del correo."),
            _c("direccion", "Dirección física", ayuda="Los correos comerciales deben indicar una dirección física del remitente."),
            _c("ciudad", "Ciudad"),
            _c("telefono", "Teléfono de contacto"),
            _c("correo_contacto", "Correo de contacto", "email"),
            _c("tienda_url", "Enlace de la tienda en línea", "url", ayuda="A dónde lleva el botón del correo. Debe empezar por https://"),
            _c("tienda_texto", "Texto del botón", defecto="Visítanos en la tienda"),
            _c("instagram", "Instagram", "url"),
            _c("facebook", "Facebook", "url"),
            _c("tiktok", "TikTok", "url"),
            _c("whatsapp_contacto", "WhatsApp de atención", ayuda="Número para que los clientes escriban (p. ej. 573001234567)."),
            _c("color", "Color de la marca", "color", defecto="#003760", ayuda="Encabezado del correo y del botón."),
        ],
    },
    "legal": {
        "titulo": "Cumplimiento legal",
        "campos": [
            _c("politica_url", "Enlace a la Política de Tratamiento de Datos", "url",
               ayuda="Si la política está publicada en la web. Si no, cargue el PDF y el CRM la publica."),
            _c("pie_correo", "Pie legal del correo", "texto_largo",
               defecto="Recibes este mensaje porque autorizaste a {empresa} el tratamiento de tus datos personales "
                       "(Ley 1581 de 2012). Puedes consultar nuestra Política de Tratamiento de Datos o cancelar tu "
                       "suscripción en cualquier momento.",
               ayuda="Texto al final de cada correo. {empresa} se reemplaza por el nombre comercial."),
            _c("url_publica", "Dirección pública del CRM", "url",
               ayuda="La dirección https con la que se llega al CRM desde internet (p. ej. https://crm.miempresa.com). "
                     "Sin ella el enlace «Cancelar suscripción» no puede funcionar fuera de la oficina."),
            _c("rne_activo", "Aplicar el Registro de Números Excluidos (RNE)", "booleano", defecto=False,
               ayuda="Excluye de cada envío los teléfonos y correos inscritos en el RNE de la CRC (Ley 2300 de 2023)."),
            _c("rne_canales", "Canales a los que se aplica el RNE", "canales", defecto=["whatsapp", "sms", "email"],
               ayuda="El RNE cubre SMS, mensajería por aplicaciones (WhatsApp), correo y llamadas."),
            _c("rne_max_dias", "Antigüedad máxima de la lista del RNE (días)", "numero", defecto=7, minimo=1, maximo=60,
               ayuda="La CRC actualiza la lista a diario y pide consultarla antes de cada envío. Si la lista cargada es más "
                     "vieja, los canales cubiertos quedan bloqueados hasta actualizarla."),
            _c("rne_exentos_autorizados", "No aplicar el RNE a quien autorizó expresamente a la empresa", "booleano",
               defecto=False, ayuda="La CRC indica que la empresa autorizada expresamente sí puede contactar. Valídelo con su "
                                    "asesor jurídico antes de activarlo."),
        ],
    },
    "reglas": {
        "titulo": "Reglas de campañas",
        "campos": [
            _c("excluir_contactados_dias", "No contactar a quien recibió otra campaña en los últimos (días)", "numero",
               defecto=15, minimo=0, maximo=365, ayuda="Lo usan las estrategias listas y las campañas nuevas. 0 = no excluir."),
            _c("control_pct", "Grupo de control por defecto (%)", "numero", defecto=0, minimo=0, maximo=20,
               ayuda="Porcentaje de la audiencia que se reserva sin enviar para medir el efecto de la campaña."),
            _c("vigencia_max_dias", "Vigencia máxima de una oferta (días)", "numero", defecto=90, minimo=1, maximo=365),
            _c("habitual_compras", "Comprador habitual: mínimo de compras", "numero", defecto=3, minimo=2, maximo=20,
               ayuda="Para la estrategia «Atraer nuevos compradores»."),
            _c("habitual_dias", "Comprador habitual: en los últimos (días)", "numero", defecto=180, minimo=30, maximo=730),
            _c("descuento_factor_pct", "Descuento sugerido: % del margen que se puede ceder", "numero", defecto=60,
               minimo=10, maximo=90, ayuda="El descuento sugerido = margen × este porcentaje (se conserva el resto)."),
            _c("descuento_tope_pct", "Descuento sugerido: tope (%)", "numero", defecto=30, minimo=5, maximo=80),
        ],
    },
    "presupuesto": {
        "titulo": "Presupuesto por canal",
        "campos": [
            _c("tope_whatsapp", "Tope mensual WhatsApp (COP)", "numero", defecto=0, minimo=0, maximo=1e12, ayuda="0 = sin tope."),
            _c("tope_sms", "Tope mensual SMS (COP)", "numero", defecto=0, minimo=0, maximo=1e12, ayuda="0 = sin tope."),
            _c("tope_email", "Tope mensual correo (COP)", "numero", defecto=0, minimo=0, maximo=1e12, ayuda="0 = sin tope."),
            _c("alerta_pct", "Avisar al llegar al (%) del tope", "numero", defecto=80, minimo=10, maximo=100),
        ],
    },
    "etl": {
        "titulo": "Carga automática del ERP",
        "campos": [
            _c("automatica", "Cargar los datos del ERP todos los días", "booleano", defecto=False,
               ayuda="El CRM debe estar encendido a esa hora. Carga las ventas nuevas y reconstruye el modelo."),
            _c("hora", "Hora de la carga", "hora", defecto="03:00", ayuda="De madrugada, cuando nadie factura (formato 24 h)."),
        ],
    },
}


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def validar(c: dict, v):
    t = c["tipo"]
    if t == "booleano":
        return bool(v)
    if v in (None, "") and t != "canales":
        return None
    if t == "numero":
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"«{c['etiqueta']}» debe ser un número.") from None
        if (c["minimo"] is not None and n < c["minimo"]) or (c["maximo"] is not None and n > c["maximo"]):
            raise ValueError(f"«{c['etiqueta']}» debe estar entre {c['minimo']:g} y {c['maximo']:g}.")
        return int(n) if n.is_integer() else n
    if t == "canales":
        if not isinstance(v, list) or any(x not in CANALES for x in v):
            raise ValueError(f"«{c['etiqueta']}»: canales no válidos.")
        return [x for x in CANALES if x in v]
    s = str(v).strip()
    if len(s) > (2000 if t == "texto_largo" else 300):
        raise ValueError(f"«{c['etiqueta']}» es demasiado largo.")
    if t == "url" and not re.fullmatch(r"https://[^\s<>\"']{4,500}", s):
        raise ValueError(f"«{c['etiqueta']}» debe ser una dirección que empiece por https://")
    if t == "email" and not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,255}\.[A-Za-z]{2,}", s):
        raise ValueError(f"«{c['etiqueta']}» no es un correo válido.")
    if t == "color" and not re.fullmatch(r"#[0-9a-fA-F]{6}", s):
        raise ValueError(f"«{c['etiqueta']}» debe ser un color como #003760.")
    if t == "hora" and not re.fullmatch(r"([01][0-9]|2[0-3]):[0-5][0-9]", s):
        raise ValueError(f"«{c['etiqueta']}» debe tener el formato HH:MM (24 horas).")
    if t in ("texto", "texto_largo") and re.search(r"[<>]", s):
        raise ValueError(f"«{c['etiqueta']}» no puede contener < ni >.")
    return s


class General:
    def __init__(self, store: Store) -> None:
        self.store = store
        with store._lock:
            store._db.executescript(DDL)

    def _crudo(self, seccion: str) -> dict:
        with self.store._lock:
            r = self.store._db.execute("SELECT datos FROM configuracion_general WHERE seccion = ?", (seccion,)).fetchone()
        return json.loads(r[0]) if r else {}

    def seccion(self, seccion: str) -> dict:
        """Valores efectivos (guardado o, si no, el de defecto)."""
        g = self._crudo(seccion)
        return {c["clave"]: g.get(c["clave"], c["defecto"]) for c in ESQUEMA[seccion]["campos"]}

    def todo(self) -> dict:
        out = {s: self.seccion(s) for s in ESQUEMA}
        with self.store._lock:
            meta = {r[0]: {"actualizado": r[1], "actualizado_por": r[2]} for r in
                    self.store._db.execute("SELECT seccion, actualizado, actualizado_por FROM configuracion_general")}
        return {"valores": out, "meta": meta}

    def guardar(self, seccion: str, datos: dict, origen: str) -> dict:
        if seccion not in ESQUEMA:
            raise ValueError("Sección desconocida.")
        previo = self._crudo(seccion)
        limpio = {}
        for c in ESQUEMA[seccion]["campos"]:
            if c["clave"] in datos:
                v = validar(c, datos[c["clave"]])
                if v is None and c["requerido"]:
                    raise ValueError(f"«{c['etiqueta']}» es obligatorio.")
                if v is not None:
                    limpio[c["clave"]] = v
            elif c["clave"] in previo:
                limpio[c["clave"]] = previo[c["clave"]]
        cambios = sorted(k for k in set(limpio) | set(previo) if limpio.get(k) != previo.get(k))
        with self.store._lock:
            self.store._db.execute(
                "INSERT INTO configuracion_general (seccion, datos, actualizado, actualizado_por) VALUES (?,?,?,?) "
                "ON CONFLICT (seccion) DO UPDATE SET datos=excluded.datos, actualizado=excluded.actualizado, "
                "actualizado_por=excluded.actualizado_por",
                (seccion, json.dumps(limpio, ensure_ascii=False), _ahora(), origen[:200]))
        self.store.auditar("configuracion", None, f"{seccion} · campos cambiados: {', '.join(cambios) or 'ninguno'}", origen[:200])
        return self.seccion(seccion)

    # Estado interno (no editable en la pantalla): p. ej. el último día en que corrió la carga automática.
    def interno(self, clave: str):
        return self._crudo("_interno").get(clave)

    def fijar_interno(self, clave: str, valor) -> None:
        d = self._crudo("_interno")
        d[clave] = valor
        with self.store._lock:
            self.store._db.execute(
                "INSERT INTO configuracion_general (seccion, datos, actualizado) VALUES ('_interno', ?, ?) "
                "ON CONFLICT (seccion) DO UPDATE SET datos=excluded.datos, actualizado=excluded.actualizado",
                (json.dumps(d, ensure_ascii=False), _ahora()))


_inst: General | None = None


def get_general() -> General:
    global _inst
    store = get_store()
    if _inst is None or _inst.store is not store:
        _inst = General(store)
    return _inst


def valor(seccion: str, clave: str):
    """Lectura segura para el resto del CRM: si algo falla, el valor por defecto."""
    try:
        return get_general().seccion(seccion)[clave]
    except Exception:
        return next(c["defecto"] for c in ESQUEMA[seccion]["campos"] if c["clave"] == clave)


def empresa_nombre() -> str:
    return valor("empresa", "nombre") or "Mi empresa"
