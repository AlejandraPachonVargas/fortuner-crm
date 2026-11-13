"""Instalación del diccionario propio del CRM (tablas ``CRM_*``) y migración inicial desde ``POSCLI``.

Decisiones (ver ``docs/clientes-360-arquitectura.md``):

* El CRM tiene **su propio diccionario** (``ADS_CRM_DIRECTORY``), en una subcarpeta del ERP para que los respaldos
  de la carpeta del ERP lo incluyan. **No se agrega ni una tabla a PUBLIDATA**: el diccionario del ERP queda intacto
  y una actualización del proveedor no puede borrar las tablas del CRM.
* El diccionario se crea **en el servidor donde corre** (``CREATE DATABASE``), así queda en la versión de Advantage
  de ese servidor (12 en desarrollo, 10.10 en producción). Nunca se copian archivos ``.add`` entre servidores.
* Todo es idempotente: ``instalar()`` se puede ejecutar las veces que sea; solo crea lo que falta.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

from ...config import Settings, get_settings
from . import conexion
from .mapeo import CLUBES_POSCLI, logico, txt

log = logging.getLogger("crm.clientes.esquema")

VERSION_ESQUEMA = 1

# Tipos compatibles con Advantage 10.10 (producción) y 12 (desarrollo).
TABLAS: dict[str, str] = {
    "CRM_ESQUEMA": """
        CLAVE Char(40), VALOR Char(200), FECHA Timestamp""",
    "CRM_CLIENTE_EXT": """
        CODCLI Char(13), CEDCLI Char(10), ESTADO Char(12), MOTIVO_ESTADO Char(120), FUSIONADO_EN Char(13),
        ETIQUETAS Char(250), OBSERVACIONES Memo, CONSENT_FECHA Date, CONSENT_MEDIO Char(40), ORIGEN Char(10),
        CREADO Timestamp, ACTUALIZADO Timestamp, USUARIO Char(40)""",
    "CRM_AFILIACION": """
        ID AutoInc, CODIGO Char(10), NOMBRE Char(40), DESCRIPCION Char(120), BENEFICIOS Char(200), COLOR Char(7),
        VIGENCIA_MESES Integer, ACTIVA Logical, CAMPO_POSCLI Char(10), CREADO Timestamp, ACTUALIZADO Timestamp""",
    "CRM_AFILIACION_CLIENTE": """
        ID AutoInc, AFILIACION_ID Integer, CODCLI Char(13), CEDCLI Char(10), FECHA_INGRESO Date, FECHA_VENCE Date,
        CARNET Char(20), ESTADO Char(12), ORIGEN Char(10), CREADO Timestamp, ACTUALIZADO Timestamp, USUARIO Char(40)""",
    "CRM_MASCOTA": """
        ID AutoInc, CODCLI Char(13), CEDCLI Char(10), TIPO_COD Char(5), NOMBRE Char(40), RAZA Char(40), SEXO Char(1),
        FECHA_NAC Date, NOTAS Char(120), ACTIVA Logical, ORIGEN Char(10), CREADO Timestamp, ACTUALIZADO Timestamp,
        USUARIO Char(40)""",
    "CRM_VEHICULO": """
        ID AutoInc, CODCLI Char(13), CEDCLI Char(10), TIPO Char(20), COD_GANAUTOS Char(2), MARCA Char(30),
        LINEA Char(30), PLACA Char(6), ANIO Integer, ORIGEN Char(10), CREADO Timestamp, ACTUALIZADO Timestamp,
        USUARIO Char(40)""",
    "CRM_NOTA": """
        ID AutoInc, CODCLI Char(13), TIPO Char(5), TEXTO Char(300), VENCE Date, HECHA Logical, AUTOR Char(40),
        CREADO Timestamp""",
    "CRM_AUDITORIA": """
        ID AutoInc, FECHA Timestamp, USUARIO Char(40), ROL Char(12), ACCION Char(20), TABLA Char(30), CODCLI Char(13),
        CAMPO Char(40), ANTES Char(250), DESPUES Char(250), ESTADO Char(10), DETALLE Char(250)""",
    "CRM_DUPLICADO_DESCARTE": """
        ID AutoInc, FIRMA Char(200), USUARIO Char(40), FECHA Timestamp""",
}

INDICES: tuple[tuple[str, str, str, bool], ...] = (
    ("CRM_ESQUEMA", "IX_ESQ_CLAVE", "CLAVE", True),
    ("CRM_CLIENTE_EXT", "IX_EXT_CODCLI", "CODCLI", True),
    ("CRM_CLIENTE_EXT", "IX_EXT_CEDCLI", "CEDCLI", False),
    ("CRM_AFILIACION", "IX_AFI_ID", "ID", True),
    ("CRM_AFILIACION", "IX_AFI_CODIGO", "CODIGO", True),
    ("CRM_AFILIACION_CLIENTE", "IX_AFC_ID", "ID", True),
    ("CRM_AFILIACION_CLIENTE", "IX_AFC_CODCLI", "CODCLI", False),
    ("CRM_AFILIACION_CLIENTE", "IX_AFC_AFI", "AFILIACION_ID", False),
    ("CRM_MASCOTA", "IX_MAS_ID", "ID", True),
    ("CRM_MASCOTA", "IX_MAS_CODCLI", "CODCLI", False),
    ("CRM_VEHICULO", "IX_VEH_ID", "ID", True),
    ("CRM_VEHICULO", "IX_VEH_CODCLI", "CODCLI", False),
    ("CRM_NOTA", "IX_NOT_ID", "ID", True),
    ("CRM_NOTA", "IX_NOT_CODCLI", "CODCLI", False),
    ("CRM_AUDITORIA", "IX_AUD_ID", "ID", True),
    ("CRM_AUDITORIA", "IX_AUD_CODCLI", "CODCLI", False),
    ("CRM_AUDITORIA", "IX_AUD_FECHA", "FECHA", False),
    ("CRM_DUPLICADO_DESCARTE", "IX_DUP_FIRMA", "FIRMA", False),
)

DESCRIPCION_TABLAS = {
    "CRM_ESQUEMA": "Versión del esquema del CRM y marcas de instalación/migración.",
    "CRM_CLIENTE_EXT": "Extensión 1:1 de POSCLI: estado en el CRM, fusión, etiquetas, observaciones y evidencia del consentimiento.",
    "CRM_AFILIACION": "Catálogo de clubes y afiliaciones (los 5 históricos de POSCLI + los que se creen).",
    "CRM_AFILIACION_CLIENTE": "Qué cliente pertenece a qué club (muchos a muchos), con ingreso, vencimiento y carné.",
    "CRM_MASCOTA": "Mascotas de cada cliente (varias por cliente). El tipo usa el código de GANMASCOTA.",
    "CRM_VEHICULO": "Vehículos de cada cliente. El tipo se refleja con el código de GANAUTOS.",
    "CRM_NOTA": "Notas y tareas de mercadeo sobre el cliente.",
    "CRM_AUDITORIA": "Bitácora de cada cambio: quién, cuándo, qué tabla y campo, antes y después.",
    "CRM_DUPLICADO_DESCARTE": "Pares marcados como 'no son duplicados' para no volver a sugerirlos.",
}


# ------------------------------------------------------------------------------------------ diccionario
def es_ruta_de_red(ruta: str) -> bool:
    r"""\\SERVIDOR:2000\C$\... (ruta vista por el servidor Advantage): no se puede revisar desde este equipo."""
    return ruta.startswith("\\\\") or ruta.startswith("//")


def diccionario_existe(s: Settings) -> bool:
    try:
        with conexion.crm(lectura=True, s=s):
            return True
    except Exception:
        return not es_ruta_de_red(s.ads_crm_directory) and Path(s.ads_crm_directory).exists()


def crear_diccionario(s: Settings) -> bool:
    """Crea el archivo .add del CRM si no existe. Devuelve True si lo creó."""
    ruta = s.ads_crm_directory
    if not ruta.lower().endswith(".add"):
        raise ValueError(r"ADS_CRM_DIRECTORY debe apuntar a un archivo .add (ej. D:\ADD_FORTUNER\CRM\CRM_FORTUNER.add)")
    if diccionario_existe(s):
        return False
    if not s.ads_crm_password or not 10 <= len(s.ads_crm_password) <= 20:
        raise ValueError("Defina ADS_CRM_PASSWORD (entre 10 y 20 caracteres: límite de Advantage) antes de crear el diccionario del CRM.")
    if "'" in s.ads_crm_password:
        raise ValueError("ADS_CRM_PASSWORD no puede contener comillas simples.")
    carpeta = ruta.replace("/", "\\").rsplit("\\", 1)[0]
    if not es_ruta_de_red(ruta):
        Path(carpeta).mkdir(parents=True, exist_ok=True)
    cs = conexion._base(s) + f"DataDirectory={carpeta};TableType=ADT;"
    with conexion.conectar(cs, lectura=False) as con:
        con.cursor().execute(
            f"CREATE DATABASE [{ruta}] PASSWORD '{s.ads_crm_password}' "
            "DESCRIPTION 'FORTUNER CRM - Clientes 360 (tablas propias, enlazadas a POSCLI por CODCLI)'")
    log.info("Diccionario del CRM creado en %s", ruta)
    return True


def _tablas_existentes(con) -> set[str]:
    return {r["NAME"].upper() for r in conexion.filas(con, "SELECT Name AS NAME FROM system.tables")}


def _indices_existentes(con) -> set[str]:
    return {r["NAME"].upper() for r in conexion.filas(con, "SELECT Name AS NAME FROM system.indexes")}


def crear_tablas(con) -> list[str]:
    creadas = []
    existentes = _tablas_existentes(con)
    cur = con.cursor()
    for nombre, cols in TABLAS.items():
        if nombre not in existentes:
            cur.execute(f"CREATE TABLE {nombre} ({' '.join(cols.split())})")
            try:
                cur.execute(f"EXECUTE PROCEDURE sp_ModifyTableProperty('{nombre}', 'TABLE_DESCRIPTION', "
                            f"'{DESCRIPCION_TABLAS[nombre]}', 'NO_VALIDATE', NULL)")
            except Exception:  # la descripción es cosmética
                log.debug("No se pudo poner descripción a %s", nombre)
            creadas.append(nombre)
    idx = _indices_existentes(con)
    for tabla, nombre, expr, unico in INDICES:
        if nombre not in idx:
            cur.execute(f"CREATE {'UNIQUE ' if unico else ''}INDEX {nombre} ON {tabla} ({expr})")
    return creadas


def marca(con, clave: str) -> str | None:
    r = conexion.filas(con, "SELECT VALOR FROM CRM_ESQUEMA WHERE CLAVE = ?", (clave,))
    return txt(r[0]["VALOR"]) if r else None


def poner_marca(con, clave: str, valor: str) -> None:
    cur = con.cursor()
    cur.execute("DELETE FROM CRM_ESQUEMA WHERE CLAVE = ?", (clave,))
    cur.execute("INSERT INTO CRM_ESQUEMA (CLAVE, VALOR, FECHA) VALUES (?, ?, NOW())", (clave, valor[:200]))


# ------------------------------------------------------------------------------------------ migración inicial
_PALABRAS_MASCOTA = (
    ("02", r"PERR|CAN|LABRAD|POOD|PODL|POODER|SCHN|SNAU|SNAW|ESNAU|PINCH|PASTOR|COLLIE|BULL|BEAGLE|CHIHU|PITB|PEQUI|GOLDEN|HUSKY|YORK"),
    ("03", r"GAT|MICH|FELIN"),
    ("04", r"AVE|PAJAR|LOR|PERIC|CANAR|CACAT|AGAPOR|PALOM|GALLIN|PIOLIN"),
    ("05", r"REPTIL|IGUAN|TORTUG|SERPIENT|CULEBR"),
    ("06", r"CONEJ"),
    ("07", r"HAMST"),
    ("08", r"RATON|RATA|CUY|COBAY"),
    ("09", r"CERD|MARRAN"),
)
_SIN_MASCOTA = re.compile(r"^(SIN MASCOTA|NO|NINGUN[OA]?|NO TIENE|N/?A|0|\.|-)$")


CODIGOS_GANMASCOTA = frozenset({"02", "03", "04", "05", "06", "07", "08", "09", "99"})


def tipos_mascota_de(codmasco: str, tmascota: str, mascota_flag, validos: frozenset[str] = CODIGOS_GANMASCOTA) -> list[str]:
    """Tipos (códigos GANMASCOTA) que se pueden deducir de las columnas de POSCLI. Texto libre muy sucio: se lee con
    patrones y, si no se entiende pero el cliente dice tener mascota, queda como '99' (otro). Un código que no esté en
    el catálogo (POSCLI tiene '10', que GANMASCOTA no define) también queda como '99': nunca se guarda un código huérfano."""
    t = re.sub(r"\s+", " ", txt(tmascota).upper())
    cod = txt(codmasco)
    tiene = logico(mascota_flag)
    if _SIN_MASCOTA.match(t) or (t == "" and cod in ("", "01") and not tiene):
        return []
    tipos = [c for c, pat in _PALABRAS_MASCOTA if re.search(pat, t)]
    if not tipos and cod and cod != "01" and re.fullmatch(r"\d{2}", cod):
        tipos = [cod if cod in validos else "99"]
    if not tipos and (tiene or t):
        tipos = ["99"]
    return tipos


def vehiculos_de(codvehi: str, ticarro: str, tcarro) -> list[tuple[str, str]]:
    """(tipo CRM, código GANAUTOS) deducidos de POSCLI."""
    c, t = txt(codvehi).upper(), txt(ticarro).lower()
    if c == "VP":
        return [("Automóvil", "VP")]
    if c == "MO":
        return [("Moto", "MO")]
    if c == "BI":
        return [("Bicicleta", "BI")]
    if c == "VM":
        return [("Automóvil", "VP"), ("Moto", "MO")]
    if c == "PE":
        return [("Otro", "")]
    if c == "XX":
        return []
    if t == "moto":
        return [("Moto", "MO")]
    if t == "carro" or logico(tcarro):
        return [("Automóvil", "VP")]
    return []


def migrar_desde_poscli(s: Settings, crm_con) -> dict:
    """Siembra clubes, socios, mascotas, vehículos y fallecidos a partir de POSCLI. Solo una vez (marca en CRM_ESQUEMA)."""
    if marca(crm_con, "migracion_inicial"):
        return {"omitida": True}
    cur = crm_con.cursor()
    ahora = datetime.now()
    # 1) clubes históricos
    ids: dict[str, int] = {}
    for col, (codigo, nombre, color) in CLUBES_POSCLI.items():
        r = conexion.filas(crm_con, "SELECT ID FROM CRM_AFILIACION WHERE CODIGO = ?", (codigo,))
        if not r:
            cur.execute("INSERT INTO CRM_AFILIACION (CODIGO, NOMBRE, DESCRIPCION, BENEFICIOS, COLOR, VIGENCIA_MESES, ACTIVA, "
                        "CAMPO_POSCLI, CREADO, ACTUALIZADO) VALUES (?, ?, ?, '', ?, 12, TRUE, ?, ?, ?)",
                        (codigo, nombre, f"Club histórico del POS (bandera {col} de POSCLI).", color, col, ahora, ahora))
            r = conexion.filas(crm_con, "SELECT ID FROM CRM_AFILIACION WHERE CODIGO = ?", (codigo,))
        ids[col] = int(r[0]["ID"])

    # 2) lectura de POSCLI (solo lectura)
    cols = "CODCLI, CEDCLI, MASCOTA, CODMASCO, TMASCOTA, NOMMASCO, TCARRO, CODVEHI, TICARRO, OBSER1, OBSER2, " + ", ".join(CLUBES_POSCLI)
    with conexion.erp(lectura=True, s=s) as erp:
        ecur = erp.cursor()
        ecur.execute(f"SELECT {cols} FROM POSCLI")
        nombres = [d[0] for d in ecur.description]
        filas = [dict(zip(nombres, r)) for r in ecur.fetchall()]

    # Códigos de tarjeta repetidos en el ERP: no se les crea nada (no se puede saber a cuál fila pertenece).
    vistos: dict[str, int] = {}
    for f in filas:
        vistos[txt(f["CODCLI"])] = vistos.get(txt(f["CODCLI"]), 0) + 1

    socios, mascotas, vehiculos, ext = [], [], [], []
    for f in filas:
        cod, ced = txt(f["CODCLI"]), txt(f["CEDCLI"])
        if not cod or vistos[cod] > 1:
            continue
        for col, afi in ids.items():
            if logico(f.get(col)):
                socios.append((afi, cod, ced, "activa", "POSCLI", ahora, ahora, "migracion"))
        nombre_m = txt(f["NOMMASCO"])
        if _SIN_MASCOTA.match(nombre_m.upper()) or nombre_m.upper() in ("NO TIENE", "NINGUNA", "NINGUNO"):
            nombre_m = ""
        for i, tipo in enumerate(tipos_mascota_de(f["CODMASCO"], f["TMASCOTA"], f["MASCOTA"])):
            mascotas.append((cod, ced, tipo, (nombre_m if i == 0 else "")[:40].title(), "", "N", None, "", True,
                             "POSCLI", ahora, ahora, "migracion"))
        for tipo, codg in vehiculos_de(f["CODVEHI"], f["TICARRO"], f["TCARRO"]):
            vehiculos.append((cod, ced, tipo, codg, "", "", "", None, "POSCLI", ahora, ahora, "migracion"))
        obs = f"{txt(f['OBSER1'])} {txt(f['OBSER2'])}".upper()
        if re.search(r"\bFALLEC", obs):
            ext.append((cod, ced, "inactivo", "Fallecido (según la observación del ERP)", "ERP", ahora, ahora, "migracion"))

    crm_con.autocommit = False
    try:
        cur = crm_con.cursor()
        for i in range(0, len(socios), 5000):
            cur.executemany("INSERT INTO CRM_AFILIACION_CLIENTE (AFILIACION_ID, CODCLI, CEDCLI, ESTADO, ORIGEN, CREADO, "
                            "ACTUALIZADO, USUARIO) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", socios[i:i + 5000])
        for i in range(0, len(mascotas), 5000):
            cur.executemany("INSERT INTO CRM_MASCOTA (CODCLI, CEDCLI, TIPO_COD, NOMBRE, RAZA, SEXO, FECHA_NAC, NOTAS, ACTIVA, "
                            "ORIGEN, CREADO, ACTUALIZADO, USUARIO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            mascotas[i:i + 5000])
        for i in range(0, len(vehiculos), 5000):
            cur.executemany("INSERT INTO CRM_VEHICULO (CODCLI, CEDCLI, TIPO, COD_GANAUTOS, MARCA, LINEA, PLACA, ANIO, ORIGEN, "
                            "CREADO, ACTUALIZADO, USUARIO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", vehiculos[i:i + 5000])
        if ext:
            cur.executemany("INSERT INTO CRM_CLIENTE_EXT (CODCLI, CEDCLI, ESTADO, MOTIVO_ESTADO, ORIGEN, CREADO, ACTUALIZADO, "
                            "USUARIO) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ext)
        resumen = {"clientes_leidos": len(filas), "socios": len(socios), "mascotas": len(mascotas),
                   "vehiculos": len(vehiculos), "fallecidos_inactivos": len(ext),
                   "codigos_repetidos_omitidos": sum(1 for v in vistos.values() if v > 1)}
        poner_marca(crm_con, "migracion_inicial", str(resumen))
        crm_con.commit()
    except Exception:
        crm_con.rollback()
        raise
    finally:
        crm_con.autocommit = True
    log.info("Migración inicial desde POSCLI: %s", resumen)
    return resumen


def instalar(s: Settings | None = None, migrar: bool = True) -> dict:
    s = s or get_settings()
    creado = crear_diccionario(s)
    with conexion.crm(s=s) as con:
        creadas = crear_tablas(con)
        if not marca(con, "version"):
            poner_marca(con, "version", str(VERSION_ESQUEMA))
            poner_marca(con, "instalado", datetime.now().isoformat(timespec="seconds"))
        migracion = migrar_desde_poscli(s, con) if migrar else {"omitida": True}
    return {"diccionario": s.ads_crm_directory, "diccionario_creado": creado, "tablas_creadas": creadas,
            "migracion": migracion}


def estado(s: Settings | None = None) -> dict:
    s = s or get_settings()
    out: dict = {"configurado": conexion.configurado(s), "diccionario": s.ads_crm_directory,
                 "existe": bool(s.ads_crm_directory) and diccionario_existe(s)}
    if not out["existe"]:
        return out
    with conexion.crm(lectura=True, s=s) as con:
        existentes = _tablas_existentes(con)
        out["tablas"] = {}
        for t in TABLAS:
            if t in existentes:
                out["tablas"][t] = int(conexion.filas(con, f"SELECT COUNT(*) AS N FROM {t}")[0]["N"])
        out["version"] = marca(con, "version") if "CRM_ESQUEMA" in existentes else None
        out["migracion_inicial"] = marca(con, "migracion_inicial") if "CRM_ESQUEMA" in existentes else None
    return out
