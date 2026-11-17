"""Traducción entre una fila de ``POSCLI`` (ERP) y la ficha del CRM.

Funciones puras (sin base de datos) para poder probarlas a fondo. Reglas que vienen del análisis del diccionario
(``docs/analisis-db-clientes.md``):

* ``CODCLI`` (tarjeta) y ``CEDCLI`` (documento) son llaves: **nunca** se escriben en una edición.
* Solo se escriben las columnas de ``COLUMNAS_EDITABLES`` y siempre respetando su longitud real.
* Las fechas del ERP son números ``AAAAMMDD``. ``FECHAN`` además existe como ``MMDD`` con el año en ``ANON``.
* Los nombres se guardan en MAYÚSCULAS (así los guarda y los busca el POS) y ``NOMCLI`` (C40) se recalcula.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date

# ------------------------------------------------------------------------------------------ columnas
# Columnas que el CRM lee de POSCLI (el índice y la ficha). CLAWEB/CLACH (claves web) NO se leen jamás.
COLUMNAS_LECTURA = (
    "CODCLI", "CEDCLI", "TIPODOC", "TIPCLI", "NOMCLI", "NOMBRE", "NOMBRE2", "APELLIDO", "APELLIDO2", "SEXO",
    "FECHAN", "ANON", "CODPROFE", "PROFESION1", "EMPRESA", "ECIVIL", "HIJOS", "TELCELU", "TELCLI1", "TELCLI2",
    "EMAIL", "CIUDAD", "CIUCLI", "CODBARRIO", "BARRIO1", "DIRCLI1", "INFOLEY", "INFOTEX", "INFOELEC", "INFOWAS",
    "CLUBVINO", "CLUBAMAC", "CLUBPARRI", "CLUBSALUD", "CLUBMASCO", "MASCOTA", "CODMASCO", "TMASCOTA", "NOMMASCO",
    "TCARRO", "CODVEHI", "TVEHI", "FECHAI", "FECHAMOD", "SUCURSAL", "ORIGENW", "PUNTOS", "ULTPTOS", "VLRTOTAL",
    "MEMPLE", "BLOQUE", "BLOMOVI", "OBSER1", "OBSER2",
)

# Lista blanca de escritura con la longitud real de cada columna (C = carácter). Lo que no esté aquí no se escribe.
LONGITUD = {
    "NOMCLI": 40, "NOMBRE": 50, "NOMBRE2": 50, "APELLIDO": 50, "APELLIDO2": 50, "TIPODOC": 2, "TIPCLI": 15,
    "SEXO": 1, "CODPROFE": 3, "PROFESION1": 30, "EMPRESA": 30, "ECIVIL": 20, "TELCELU": 12, "TELCLI1": 10,
    "TELCLI2": 10, "EMAIL": 50, "CIUDAD": 5, "CIUCLI": 20, "CODBARRIO": 3, "BARRIO1": 30, "DIRCLI1": 60,
    "CODMASCO": 2, "TMASCOTA": 20, "NOMMASCO": 50, "CODVEHI": 2, "TVEHI": 50,
}
NUMERICAS = {"FECHAN", "ANON", "HIJOS", "FECHAMOD"}
# BLOQUE: en Mercaldas un valor marcado (false) = «no enviar campañas». «No autoriza» lo marca y «Sí autoriza» lo vacía.
LOGICAS = {"BLOQUE", "INFOLEY", "INFOTEX", "INFOELEC", "INFOWAS", "CLUBVINO", "CLUBAMAC", "CLUBPARRI", "CLUBSALUD",
           "CLUBMASCO", "MASCOTA", "TCARRO"}
COLUMNAS_EDITABLES = frozenset(LONGITUD) | NUMERICAS | LOGICAS
LLAVES = frozenset({"CODCLI", "CEDCLI"})
assert not (COLUMNAS_EDITABLES & LLAVES)

# Bandera de POSCLI de cada club histórico (la lee el POS para dar descuentos: deben quedar sincronizadas).
CLUBES_POSCLI = {
    "CLUBVINO": ("VINO", "Club del Vino", "#8b1e3f"),
    "CLUBAMAC": ("AMAC", "Club AMAC", "#1c5cab"),
    "CLUBPARRI": ("PARRI", "Club Parrilla", "#c2410c"),
    "CLUBSALUD": ("SALUD", "Club Salud", "#1f9d6b"),
    "CLUBMASCO": ("MASCO", "Club Mascotas", "#e08a00"),
}

# Códigos DIAN de tipo de documento usados en TIPODOC.
TIPOS_DOC = {"13": "CC", "22": "CE", "31": "NIT", "12": "TI", "41": "PAS", "11": "RC"}
TIPOS_DOC_INV = {v: k for k, v in TIPOS_DOC.items()}
ESTADOS_CIVILES = ("Soltero(a)", "Casado(a)", "Union Libre", "Separado(a)", "Viudo(a)")


class DatoInvalido(ValueError):
    """Un valor no cumple las reglas de la columna del ERP. El mensaje es apto para el usuario."""

    def __init__(self, campo: str, mensaje: str):
        super().__init__(mensaje)
        self.campo = campo


# ------------------------------------------------------------------------------------------ utilidades
def txt(v) -> str:
    return "" if v is None else str(v).strip()


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm_busqueda(s: str) -> str:
    return re.sub(r"\s+", " ", sin_tildes(s).lower()).strip()


def fecha_erp(v) -> str | None:
    """Número AAAAMMDD (o texto) → 'AAAA-MM-DD'. Cualquier otra cosa → None."""
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    if not 19000101 <= n <= 21001231:
        return None
    try:
        return date(n // 10000, n // 100 % 100, n % 100).isoformat()
    except ValueError:
        return None


def a_numero_fecha(iso: str) -> int:
    d = date.fromisoformat(iso)
    return d.year * 10000 + d.month * 100 + d.day


def nacimiento_de(fechan, anon) -> tuple[str | None, str | None]:
    """Devuelve (fecha completa ISO, cumpleaños 'MM-DD'). El ERP guarda AAAAMMDD, o MMDD con el año en ANON."""
    completa = fecha_erp(fechan)
    if completa:
        return completa, completa[5:]
    try:
        n = int(float(fechan or 0))
        a = int(float(anon or 0))
    except (TypeError, ValueError):
        return None, None
    if 101 <= n <= 1231:
        m, d = n // 100, n % 100
        try:
            date(2000, m, d)
        except ValueError:
            return None, None
        cumple = f"{m:02d}-{d:02d}"
        if 1900 < a <= date.today().year:
            try:
                return date(a, m, d).isoformat(), cumple
            except ValueError:
                pass
        return None, cumple
    return None, None


def celular_normalizado(v: str) -> str | None:
    d = re.sub(r"\D", "", v or "")
    d = re.sub(r"^57(?=3\d{9}$)", "", d)
    return d if re.fullmatch(r"3\d{9}", d) else None


EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
EMAILS_GENERICOS = ("facturaelectronica",)


def email_valido(v: str) -> bool:
    v = (v or "").strip().lower()
    return bool(EMAIL_RE.match(v)) and not v.startswith(EMAILS_GENERICOS)


def logico(v) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().upper()
    if s in ("T", "TRUE", "1", "S", "SI", "Y", ".T."):
        return True
    if s in ("F", "FALSE", "0", "N", "NO", ".F."):
        return False
    return None


def nombre_completo(n1: str, n2: str, a1: str, a2: str) -> str:
    return " ".join(p for p in (n1, n2, a1, a2) if p).strip()


def limpiar_nombre(v: str, campo: str, obligatorio: bool) -> str:
    v = re.sub(r"\s+", " ", (v or "").strip()).upper()
    if obligatorio and len(v) < 2:
        raise DatoInvalido(campo, "Este nombre es obligatorio (mínimo 2 letras).")
    if v and not re.fullmatch(r"[A-ZÁÉÍÓÚÜÑ' .\-]+", v):
        raise DatoInvalido(campo, "Solo letras, espacios, punto, guion o apóstrofo.")
    if len(v) > 50:
        raise DatoInvalido(campo, "Máximo 50 caracteres.")
    return v


def version(valores: dict) -> str:
    """Huella de los datos que vio el usuario: si cambia entre que abrió la ficha y guardó, alguien más editó."""
    base = "|".join(f"{k}={txt(valores.get(k))}" for k in sorted(valores))
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------------------------------------ ERP → CRM
def ficha_desde_erp(r: dict, cat: "CatalogosLike | None" = None) -> dict:
    """Fila de POSCLI → datos personales de la ficha (sin agregados de ventas ni datos del CRM)."""
    n1, n2, a1, a2 = (txt(r.get(k)).upper() for k in ("NOMBRE", "NOMBRE2", "APELLIDO", "APELLIDO2"))
    nomcli = txt(r.get("NOMCLI"))
    if not (n1 or a1) and nomcli:
        # Registro viejo con el nombre solo en NOMCLI: se muestra tal cual, sin inventar la partición.
        nombres, apellidos = nomcli, ""
    else:
        nombres, apellidos = " ".join(p for p in (n1, n2) if p), " ".join(p for p in (a1, a2) if p)
    nac, cumple = nacimiento_de(r.get("FECHAN"), r.get("ANON"))
    tipodoc = txt(r.get("TIPODOC"))
    tipo = TIPOS_DOC.get(tipodoc) or ("NIT" if txt(r.get("TIPCLI")).lower() == "nit" else "CC")
    sexo = txt(r.get("SEXO")).upper()
    ley = logico(r.get("INFOLEY"))
    ciudad = txt(r.get("CIUDAD"))
    dpto = (cat.dpto_de_ciudad(ciudad) if cat else None) or (ciudad[:2] if len(ciudad) == 5 else "")
    try:
        hijos = int(float(r.get("HIJOS"))) if r.get("HIJOS") is not None else None
    except (TypeError, ValueError):
        hijos = None
    obs = " · ".join(x for x in (txt(r.get("OBSER1")), txt(r.get("OBSER2"))) if x)
    return {
        "tarjeta": txt(r.get("CODCLI")), "documento": txt(r.get("CEDCLI")), "tipoDoc": tipo,
        "nombre1": n1, "nombre2": n2, "apellido1": a1, "apellido2": a2,
        "nombres": nombres, "apellidos": apellidos, "nombreErp": nomcli,
        "sexo": sexo if sexo in ("F", "M") else "N",
        "nacimiento": nac, "cumple": cumple,
        "profesionId": txt(r.get("CODPROFE")) or None, "profesionTexto": txt(r.get("PROFESION1")),
        "empresa": txt(r.get("EMPRESA")), "estadoCivil": txt(r.get("ECIVIL")), "hijos": hijos,
        "celular": txt(r.get("TELCELU")), "telefono": txt(r.get("TELCLI1")), "telefono2": txt(r.get("TELCLI2")),
        "email": txt(r.get("EMAIL")).lower(),
        "departamentoId": dpto, "ciudadId": ciudad, "ciudadTexto": txt(r.get("CIUCLI")),
        "barrioId": txt(r.get("CODBARRIO")), "barrioTexto": txt(r.get("BARRIO1")), "direccion": txt(r.get("DIRCLI1")),
        "consentimiento": "si" if ley is True else "no" if ley is False else "sin_registro",
        "autorizaSms": logico(r.get("INFOTEX")), "autorizaEmail": logico(r.get("INFOELEC")),
        "autorizaWhatsapp": logico(r.get("INFOWAS")),
        "clubesErp": {k: bool(logico(r.get(k))) for k in CLUBES_POSCLI},
        "creado": fecha_erp(r.get("FECHAI")), "modificadoErp": fecha_erp(r.get("FECHAMOD")),
        "sucursal": txt(r.get("SUCURSAL")), "origenWeb": txt(r.get("ORIGENW")).upper() == "W",
        "puntos": float(r.get("PUNTOS") or 0), "ultimaAcumulacion": fecha_erp(r.get("ULTPTOS")),
        "empleado": bool(logico(r.get("MEMPLE"))),
        "bloqueado": bool(logico(r.get("BLOQUE"))) or bool(logico(r.get("BLOMOVI"))),
        # Cualquier valor en BLOQUE (en el ERP solo existe false) excluye al cliente de Campañas; en 360° se sigue viendo.
        "sinCampanas": r.get("BLOQUE") is not None,
        "observacionErp": obs,
    }


class CatalogosLike:  # pragma: no cover - solo para tipado
    def dpto_de_ciudad(self, ciudad: str) -> str | None: ...
    def ciudad(self, codigo: str) -> dict | None: ...
    def barrio(self, ciudad: str, codigo: str) -> dict | None: ...
    def profesion(self, codigo: str) -> dict | None: ...


# ------------------------------------------------------------------------------------------ CRM → ERP
CAMPOS_FICHA = ("tipoDoc", "nombre1", "nombre2", "apellido1", "apellido2", "sexo", "nacimiento", "profesionId",
                "empresa", "estadoCivil", "hijos", "celular", "telefono", "email", "ciudadId", "barrioId", "direccion",
                "consentimiento", "autorizaSms", "autorizaEmail", "autorizaWhatsapp")


def _corta(col: str, v: str, campo: str, etiqueta: str) -> str:
    if len(v) > LONGITUD[col]:
        raise DatoInvalido(campo, f"{etiqueta}: máximo {LONGITUD[col]} caracteres (límite de la columna {col} del ERP).")
    return v


def columnas_para(cambios: dict, actual: dict, cat: CatalogosLike, hoy: date | None = None) -> dict:
    """Traduce los campos de la ficha que cambiaron a {COLUMNA: valor} de POSCLI, validando todo.

    ``actual`` es la fila de POSCLI tal como está ahora (para recalcular NOMCLI con las partes que no cambian).
    Lanza ``DatoInvalido`` con un mensaje para el usuario si algo no cumple.
    """
    hoy = hoy or date.today()
    out: dict = {}
    desconocidos = set(cambios) - set(CAMPOS_FICHA)
    if desconocidos:
        raise DatoInvalido(sorted(desconocidos)[0], "Ese dato no se puede editar desde el CRM.")

    partes = {"NOMBRE": "nombre1", "NOMBRE2": "nombre2", "APELLIDO": "apellido1", "APELLIDO2": "apellido2"}
    if any(c in cambios for c in partes.values()):
        nuevos = {}
        for col, campo in partes.items():
            v = cambios[campo] if campo in cambios else txt(actual.get(col))
            nuevos[col] = limpiar_nombre(v, campo, obligatorio=col in ("NOMBRE", "APELLIDO"))
            if campo in cambios:
                out[col] = nuevos[col]
        out["NOMCLI"] = nombre_completo(nuevos["NOMBRE"], nuevos["NOMBRE2"], nuevos["APELLIDO"], nuevos["APELLIDO2"])[:40]

    if "tipoDoc" in cambios:
        t = cambios["tipoDoc"]
        if t not in TIPOS_DOC_INV:
            raise DatoInvalido("tipoDoc", "Tipo de documento no válido.")
        out["TIPODOC"] = TIPOS_DOC_INV[t]
        out["TIPCLI"] = "Nit" if t == "NIT" else "Cedula"

    if "sexo" in cambios:
        s = cambios["sexo"]
        if s not in ("F", "M", "N"):
            raise DatoInvalido("sexo", "Género no válido.")
        out["SEXO"] = None if s == "N" else s

    if "nacimiento" in cambios:
        v = cambios["nacimiento"]
        if v:
            try:
                d = date.fromisoformat(v)
            except ValueError:
                raise DatoInvalido("nacimiento", "Fecha de nacimiento no válida.") from None
            edad = (hoy - d).days / 365.25
            if edad < 0:
                raise DatoInvalido("nacimiento", "La fecha de nacimiento no puede ser futura.")
            if edad > 110:
                raise DatoInvalido("nacimiento", "Revise la fecha: la edad supera los 110 años.")
            out["FECHAN"] = a_numero_fecha(v)
            out["ANON"] = d.year
        else:
            out["FECHAN"] = 0
            out["ANON"] = 0

    if "profesionId" in cambios:
        p = cambios["profesionId"]
        if p:
            fila = cat.profesion(p)
            if not fila:
                raise DatoInvalido("profesionId", "La profesión no está en el catálogo GANPROFE.")
            out["CODPROFE"] = _corta("CODPROFE", fila["id"], "profesionId", "Profesión")
            out["PROFESION1"] = fila["nombre"][:LONGITUD["PROFESION1"]]
        else:
            out["CODPROFE"] = ""
            out["PROFESION1"] = ""

    if "empresa" in cambios:
        out["EMPRESA"] = _corta("EMPRESA", re.sub(r"\s+", " ", txt(cambios["empresa"])).upper(), "empresa", "Empresa")

    if "estadoCivil" in cambios:
        v = txt(cambios["estadoCivil"])
        if v and v not in ESTADOS_CIVILES:
            raise DatoInvalido("estadoCivil", "Estado civil no válido.")
        out["ECIVIL"] = v

    if "hijos" in cambios:
        v = cambios["hijos"]
        if v is not None and (not isinstance(v, int) or not 0 <= v <= 20):
            raise DatoInvalido("hijos", "Número de hijos entre 0 y 20.")
        out["HIJOS"] = v

    if "celular" in cambios:
        v = txt(cambios["celular"])
        if v:
            c = celular_normalizado(v)
            if not c:
                raise DatoInvalido("celular", "Debe tener 10 dígitos y empezar por 3 (ej. 3101234567).")
            out["TELCELU"] = c
        else:
            out["TELCELU"] = ""

    if "telefono" in cambios:
        v = re.sub(r"\D", "", txt(cambios["telefono"]))
        if v and not 7 <= len(v) <= 10:
            raise DatoInvalido("telefono", "El teléfono fijo debe tener entre 7 y 10 dígitos.")
        out["TELCLI1"] = v

    if "email" in cambios:
        v = txt(cambios["email"]).lower()
        if v and not EMAIL_RE.match(v):
            raise DatoInvalido("email", "El correo no parece válido (ej. nombre@dominio.com).")
        out["EMAIL"] = _corta("EMAIL", v, "email", "Correo")

    if "ciudadId" in cambios or "barrioId" in cambios:
        ciudad = cambios.get("ciudadId", txt(actual.get("CIUDAD")))
        if "ciudadId" in cambios:
            if ciudad:
                fila = cat.ciudad(ciudad)
                if not fila:
                    raise DatoInvalido("ciudadId", "La ciudad no está en el catálogo CIUDAD.")
                out["CIUDAD"] = fila["id"]
                out["CIUCLI"] = fila["nombre"][:LONGITUD["CIUCLI"]]
            else:
                out["CIUDAD"] = ""
                out["CIUCLI"] = ""
        barrio = cambios.get("barrioId", txt(actual.get("CODBARRIO")) if "ciudadId" not in cambios else "")
        if "barrioId" in cambios or "ciudadId" in cambios:
            if barrio:
                fila = cat.barrio(ciudad, barrio)
                if not fila:
                    raise DatoInvalido("barrioId", "El barrio no está en el catálogo GANBARRIO para esa ciudad.")
                out["CODBARRIO"] = _corta("CODBARRIO", fila["id"], "barrioId", "Código de barrio")
                out["BARRIO1"] = fila["nombre"][:LONGITUD["BARRIO1"]]
            else:
                out["CODBARRIO"] = ""
                out["BARRIO1"] = ""

    if "direccion" in cambios:
        out["DIRCLI1"] = _corta("DIRCLI1", re.sub(r"\s+", " ", txt(cambios["direccion"])).upper(), "direccion", "Dirección")

    if "consentimiento" in cambios:
        v = cambios["consentimiento"]
        if v not in ("si", "no", "sin_registro"):
            raise DatoInvalido("consentimiento", "Consentimiento no válido.")
        out["INFOLEY"] = True if v == "si" else False if v == "no" else None
        if v == "no":   # quien niega el tratamiento tampoco autoriza ningún canal y queda bloqueado para campañas en el ERP
            out.update({"INFOTEX": False, "INFOELEC": False, "INFOWAS": False, "BLOQUE": False})
        elif v == "si":  # quien autoriza vuelve a poder recibir campañas: se borra el «false» de BLOQUE (queda vacío)
            out["BLOQUE"] = None
    for campo, col in (("autorizaSms", "INFOTEX"), ("autorizaEmail", "INFOELEC"), ("autorizaWhatsapp", "INFOWAS")):
        if campo in cambios and not (cambios.get("consentimiento") == "no"):
            v = cambios[campo]
            if v not in (True, False, None):
                raise DatoInvalido(campo, "Valor no válido.")
            out[col] = v

    fuera = set(out) - COLUMNAS_EDITABLES
    assert not fuera, f"Columnas fuera de la lista blanca: {fuera}"
    return out


def comparables(fila: dict) -> dict:
    """Valores de POSCLI que se comparan para la versión optimista (todo lo editable desde el CRM)."""
    return {k: fila.get(k) for k in sorted(COLUMNAS_EDITABLES)}


# ------------------------------------------------------------------------------------------ altas
def codigo_tarjeta(documento: str) -> str:
    """Regla del POS desde 2024 (99,8 % de las altas de 2025): '2' + documento con ceros a la izquierda a 12 dígitos."""
    if not re.fullmatch(r"\d{5,10}", documento):
        raise DatoInvalido("documento", "El documento debe tener entre 5 y 10 dígitos (límite de la columna CEDCLI).")
    return "2" + documento.zfill(12)


# ------------------------------------------------------------------------------------------ anonimización
def columnas_anonimizar() -> dict:
    """Valores con los que se suprimen los datos personales (Ley 1581). Se conservan CODCLI y CEDCLI: las ventas y la
    facturación electrónica los necesitan."""
    return {
        "NOMBRE": "CLIENTE", "NOMBRE2": "", "APELLIDO": "ANONIMIZADO", "APELLIDO2": "", "NOMCLI": "CLIENTE ANONIMIZADO",
        "EMAIL": "", "TELCELU": "", "TELCLI1": "", "TELCLI2": "", "DIRCLI1": "", "CODBARRIO": "", "BARRIO1": "",
        "FECHAN": 0, "ANON": 0, "EMPRESA": "", "ECIVIL": "", "HIJOS": None, "CODPROFE": "", "PROFESION1": "",
        "NOMMASCO": "", "TMASCOTA": "", "MASCOTA": False, "CODMASCO": "", "TCARRO": False, "CODVEHI": "", "TVEHI": "",
        "INFOLEY": False, "INFOTEX": False, "INFOELEC": False, "INFOWAS": False, "BLOQUE": False, "SEXO": None,
    }
