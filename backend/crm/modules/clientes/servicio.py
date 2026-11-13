"""Operaciones de Clientes 360°: cada escritura respeta las reglas de integridad acordadas con los creadores de la base.

Secuencia de toda escritura en ``POSCLI``:

1. Se toma el candado de escritura (``conexion.ESCRITURA``).
2. Se **relee la fila en vivo** por ``ROWID`` y se verifica que siga siendo el mismo cliente (``CODCLI``).
3. Se compara la *versión* que vio el usuario con la actual: si alguien (la caja u otro usuario) cambió el cliente
   mientras tanto, se rechaza con 409 en lugar de pisar el cambio.
4. Se registra la intención en ``CRM_AUDITORIA`` (estado ``pendiente``).
5. ``UPDATE POSCLI ... WHERE ROWID = ? AND CODCLI = ?`` dentro de una transacción: debe afectar **exactamente 1** fila.
6. La auditoría pasa a ``aplicado`` (o ``fallido``). Nunca hay un cambio sin rastro.
7. Se refresca esa fila en el índice.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ...config import get_settings
from ...store import get_store
from ...warehouse import WarehouseNoDisponible, get_warehouse
from . import conexion
from .catalogos import PRIORIDAD_GANAUTOS, VEHICULO_A_GANAUTOS, Catalogos, get_catalogos
from .indice import get_indice
from .mapeo import (
    CAMPOS_FICHA, CLUBES_POSCLI, COLUMNAS_EDITABLES, COLUMNAS_LECTURA, DatoInvalido, codigo_tarjeta, columnas_anonimizar,
    columnas_para, comparables, email_valido, celular_normalizado, ficha_desde_erp, txt, version,
)

log = logging.getLogger("crm.clientes")

CAMPOS_CRM = ("etiquetas", "notas", "consentFecha", "consentMedio")
ESTADOS = ("activo", "inactivo", "anonimizado")
MAX_MASIVO = 500


class NoEncontrado(LookupError):
    pass


class Conflicto(RuntimeError):
    """El registro cambió mientras el usuario lo editaba, o la operación rompería la integridad."""


class SinPermiso(PermissionError):
    pass


@dataclass(frozen=True)
class Actor:
    usuario: str
    rol: str  # admin | mercadeo

    @property
    def admin(self) -> bool:
        return self.rol == "admin"


def exigir_escritura(actor: Actor, admin: bool = False) -> None:
    if not get_settings().clientes_escritura:
        raise SinPermiso("La escritura en la base de clientes está deshabilitada (CRM_CLIENTES_ESCRITURA=false). "
                         "Solo se puede consultar.")
    if admin and not actor.admin:
        raise SinPermiso("Esta operación requiere la clave de administración.")


def _hoy_num() -> int:
    d = date.today()
    return d.year * 10000 + d.month * 100 + d.day


def _t250(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)[:250]


# ------------------------------------------------------------------------------------------ resolución
def resolver(cid: str) -> dict:
    """id del CRM → {rid, codcli, cedcli, editable}. Los códigos de tarjeta repetidos en el ERP llevan sufijo ~n."""
    r = get_indice().query("SELECT id, rid, tarjeta, documento, editable, estado, generico FROM cli WHERE id = ?", [cid])
    if not r:
        raise NoEncontrado("No se encontró ese cliente.")
    return r[0]


def _fila_erp(con, rid: str, codcli: str) -> dict:
    cur = con.cursor()
    cur.execute(f"SELECT {', '.join(COLUMNAS_LECTURA)} FROM POSCLI WHERE ROWID = ?", (rid,))
    r = cur.fetchone()
    if r is None:
        raise Conflicto("El registro ya no existe en el ERP (¿se reorganizó la tabla?). Recargue la lista.")
    fila = dict(zip([d[0].upper() for d in cur.description], r))
    if txt(fila["CODCLI"]) != codcli:
        raise Conflicto("El registro del ERP cambió de posición mientras lo editaba. Recargue la ficha e intente de nuevo.")
    return fila


def _ext(con, codcli: str) -> dict | None:
    r = conexion.filas(con, "SELECT * FROM CRM_CLIENTE_EXT WHERE CODCLI = ?", (codcli,))
    return {k.upper(): v for k, v in r[0].items()} if r else None


def _version(fila: dict, ext: dict | None) -> str:
    v = comparables(fila)
    if ext:
        v.update({f"X_{k}": ext.get(k) for k in ("ESTADO", "ETIQUETAS", "OBSERVACIONES", "CONSENT_FECHA", "CONSENT_MEDIO")})
    return version(v)


# ------------------------------------------------------------------------------------------ auditoría
def _auditar(con, actor: Actor, accion: str, tabla: str, codcli: str, campo: str = "", antes="", despues="",
             estado: str = "aplicado", detalle: str = "") -> int:
    cur = con.cursor()
    cur.execute("INSERT INTO CRM_AUDITORIA (FECHA, USUARIO, ROL, ACCION, TABLA, CODCLI, CAMPO, ANTES, DESPUES, ESTADO, DETALLE) "
                "VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (actor.usuario[:40], actor.rol[:12], accion[:20], tabla[:30], codcli[:13], campo[:40], _t250(antes),
                 _t250(despues), estado, detalle[:250]))
    cur.execute("SELECT LASTAUTOINC(CONNECTION) FROM system.iota")
    return int(cur.fetchone()[0])


def _marcar(con, ids: list[int], estado: str, detalle: str = "") -> None:
    if ids:
        cur = con.cursor()
        marcas = ",".join("?" * len(ids))
        if detalle:
            cur.execute(f"UPDATE CRM_AUDITORIA SET ESTADO = ?, DETALLE = ? WHERE ID IN ({marcas})", (estado, detalle[:250], *ids))
        else:
            cur.execute(f"UPDATE CRM_AUDITORIA SET ESTADO = ? WHERE ID IN ({marcas})", (estado, *ids))


def escribir_poscli(crm_con, actor: Actor, accion: str, rid: str, codcli: str, cols: dict, antes: dict) -> None:
    """Aplica ``cols`` a una fila de POSCLI con auditoría previa. ``cols`` ya viene validado (lista blanca)."""
    cols = {k: v for k, v in cols.items() if not _igual(antes.get(k), v)}
    if not cols:
        return
    fuera = set(cols) - COLUMNAS_EDITABLES
    if fuera:
        raise AssertionError(f"Intento de escribir columnas no permitidas: {fuera}")
    ids = [_auditar(crm_con, actor, accion, "POSCLI", codcli, k, antes.get(k), v, estado="pendiente") for k, v in cols.items()]
    cols = {**cols, "FECHAMOD": _hoy_num()}
    try:
        with conexion.erp(lectura=False, transaccion=True) as erp:
            cur = erp.cursor()
            cur.execute(f"UPDATE POSCLI SET {', '.join(f'{k} = ?' for k in cols)} WHERE ROWID = ? AND CODCLI = ?",
                        (*cols.values(), rid, codcli))
            if cur.rowcount != 1:
                raise Conflicto(f"La actualización habría afectado {cur.rowcount} filas del ERP; se canceló.")
    except Exception as e:
        _marcar(crm_con, ids, "fallido", str(e))
        raise
    _marcar(crm_con, ids, "aplicado")


def _igual(a, b) -> bool:
    if isinstance(b, bool) or isinstance(a, bool):
        return a is b or (a is not None and b is not None and bool(a) == bool(b))
    if isinstance(b, (int, float)) or isinstance(a, (int, float)):
        try:
            return float(a or 0) == float(b or 0) and (a is None) == (b is None)
        except (TypeError, ValueError):
            return False
    return txt(a) == txt(b)


def _upsert_ext(con, codcli: str, cedcli: str, actor: Actor, **campos) -> dict:
    """Crea o actualiza la extensión CRM del cliente. Devuelve {campo: (antes, después)} de lo que cambió."""
    actual = _ext(con, codcli)
    cambios = {k: (actual.get(k) if actual else None, v) for k, v in campos.items()
               if not _igual(actual.get(k) if actual else None, v)}
    if not cambios:
        return {}
    cur = con.cursor()
    if actual:
        sets = ", ".join(f"{k} = ?" for k in cambios)
        cur.execute(f"UPDATE CRM_CLIENTE_EXT SET {sets}, ACTUALIZADO = NOW(), USUARIO = ? WHERE CODCLI = ?",
                    (*[v[1] for v in cambios.values()], actor.usuario[:40], codcli))
    else:
        datos = {"ESTADO": "activo", "ORIGEN": "ERP", **campos}
        cols = ", ".join(datos)
        cur.execute(f"INSERT INTO CRM_CLIENTE_EXT (CODCLI, CEDCLI, {cols}, CREADO, ACTUALIZADO, USUARIO) "
                    f"VALUES (?, ?, {', '.join('?' * len(datos))}, NOW(), NOW(), ?)",
                    (codcli, cedcli, *datos.values(), actor.usuario[:40]))
    return cambios


# ------------------------------------------------------------------------------------------ lectura de la ficha
_SUCURSALES: dict[str, str] | None = None


def nombres_sucursales() -> dict[str, str]:
    """Código de sede de las ventas (FADITE.IFSUCUR) → nombre, según TIDBODE ('81' → 'Parque Caldas')."""
    global _SUCURSALES
    if _SUCURSALES is None:
        out: dict[str, str] = {}
        try:
            with conexion.erp() as con:
                for r in conexion.filas(con, "SELECT CODIGO, NOMBRE FROM TIDBODE"):
                    if txt(r["CODIGO"]) and txt(r["NOMBRE"]):
                        out[txt(r["CODIGO"])] = txt(r["NOMBRE"]).title()
        except Exception:
            log.exception("No se pudieron leer las sedes (TIDBODE)")
        _SUCURSALES = out
    return _SUCURSALES


def _fusionados(con, codcli: str) -> list[dict]:
    return [{k.upper(): v for k, v in r.items()} for r in
            conexion.filas(con, "SELECT CODCLI, CEDCLI FROM CRM_CLIENTE_EXT WHERE FUSIONADO_EN = ?", (codcli,))]


def _metricas(cedulas: list[str]) -> dict:
    vacio = {"visitas": 0, "ventaTotal": 0.0, "ticketProm": 0.0, "ultimaCompra": None, "primeraCompra": None,
             "intervaloDias": None, "segmento": "sin_compras", "ciclo": "sin_historial", "diaPreferido": None,
             "franjaPreferida": None, "metricasHasta": None}
    ids = [c for c in cedulas if c]
    if not ids:
        return vacio
    try:
        wh = get_warehouse()
        marcas = ",".join("?" * len(ids))
        r = wh.query(f"SELECT SUM(visitas) v, SUM(venta_total) t, MAX(ultima_compra) u, MIN(primera_compra) p FROM cli_perfil "
                     f"WHERE cliente_id IN ({marcas})", ids)[0]
        if not r["v"]:
            vacio["metricasHasta"] = str(wh.scalar("SELECT fecha_max FROM meta"))
            return vacio
        prop = wh.query("SELECT p.intervalo_dias, p.dia_semana_pref, p.franja_pref, r.segmento_rfm, r.estado_ciclo FROM cli_perfil p "
                        "LEFT JOIN cli_rfm r USING (cliente_id) WHERE p.cliente_id = ?", [ids[0]])
        p = prop[0] if prop else {}
        return {"visitas": int(r["v"]), "ventaTotal": float(r["t"] or 0), "ticketProm": float(r["t"] or 0) / max(1, int(r["v"])),
                "ultimaCompra": r["u"].isoformat() if r["u"] else None, "primeraCompra": r["p"].isoformat() if r["p"] else None,
                "intervaloDias": round(p["intervalo_dias"]) if p.get("intervalo_dias") else None,
                "segmento": p.get("segmento_rfm") or "sin_compras", "ciclo": p.get("estado_ciclo") or "sin_historial",
                "diaPreferido": p.get("dia_semana_pref"), "franjaPreferida": p.get("franja_pref"),
                "metricasHasta": str(wh.scalar("SELECT fecha_max FROM meta"))}
    except WarehouseNoDisponible:
        return vacio


def compras(cid: str, n: int = 20) -> dict:
    ref = resolver(cid)
    with conexion.crm(lectura=True) as con:
        ceds = [ref["documento"]] + [txt(f["CEDCLI"]) for f in _fusionados(con, ref["tarjeta"])]
    ids = [c for c in dict.fromkeys(ceds) if c]
    if not ids:
        return {"compras": [], "top": [], "metricasHasta": None}
    try:
        wh = get_warehouse()
    except WarehouseNoDisponible:
        return {"compras": [], "top": [], "metricasHasta": None}
    marcas = ",".join("?" * len(ids))
    filas = wh.query(
        f"""WITH f AS (SELECT fecha, factura, sucursal_id, COUNT(*) FILTER (WHERE cantidad > 0) lineas, SUM(venta_neta) total,
                     arg_max(producto_id, venta_neta) top
              FROM venta WHERE cliente_id IN ({marcas}) GROUP BY fecha, factura, sucursal_id)
            SELECT f.*, p.producto FROM f LEFT JOIN producto p ON p.producto_id = f.top ORDER BY fecha DESC, factura DESC LIMIT ?""",
        [*ids, n])
    suc = nombres_sucursales()
    top = wh.query(f"""SELECT p.producto AS nombre, SUM(c.compras)::INT AS n, SUM(c.venta) AS venta FROM cli_producto c
                       JOIN producto p USING (producto_id) WHERE c.cliente_id IN ({marcas})
                       GROUP BY p.producto ORDER BY n DESC, venta DESC LIMIT 6""", ids)
    return {
        "compras": [{"fecha": f["fecha"].isoformat(), "ticket": txt(f["factura"]), "lineas": int(f["lineas"] or 0),
                     "total": float(f["total"] or 0),
                     "sede": suc.get(f"{int(f['sucursal_id']):02d}", f"Sede {f['sucursal_id']}") if f["sucursal_id"] is not None else "",
                     "productos": [txt(f["producto"]).title()] if f["producto"] else []} for f in filas],
        "top": [{"nombre": txt(t["nombre"]).title(), "n": int(t["n"])} for t in top],
        "metricasHasta": str(wh.scalar("SELECT fecha_max FROM meta")),
    }


def _relaciones(con, codcli: str, cat: Catalogos) -> dict:
    masc = conexion.filas(con, "SELECT ID, TIPO_COD, NOMBRE, RAZA, SEXO, FECHA_NAC, NOTAS, ACTIVA, ORIGEN FROM CRM_MASCOTA "
                               "WHERE CODCLI = ? ORDER BY ID", (codcli,))
    veh = conexion.filas(con, "SELECT ID, TIPO, COD_GANAUTOS, MARCA, LINEA, PLACA, ANIO, ORIGEN FROM CRM_VEHICULO WHERE CODCLI = ? ORDER BY ID", (codcli,))
    soc = conexion.filas(con, "SELECT ID, AFILIACION_ID, FECHA_INGRESO, FECHA_VENCE, CARNET, ESTADO, ORIGEN FROM CRM_AFILIACION_CLIENTE "
                              "WHERE CODCLI = ? ORDER BY ID", (codcli,))
    notas = conexion.filas(con, "SELECT ID, TIPO, TEXTO, VENCE, HECHA, AUTOR, CREADO FROM CRM_NOTA WHERE CODCLI = ? ORDER BY CREADO DESC", (codcli,))
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {
        "mascotas": [{"id": str(m["ID"]), "tipoId": txt(m["TIPO_COD"]), "tipo": (cat.mascota(txt(m["TIPO_COD"])) or {}).get("nombre", "Otro"),
                      "nombre": txt(m["NOMBRE"]), "raza": txt(m["RAZA"]), "sexo": txt(m["SEXO"]) or "N",
                      "nacimiento": iso(m["FECHA_NAC"]), "notas": txt(m["NOTAS"]), "activa": bool(m["ACTIVA"]),
                      "origen": txt(m["ORIGEN"])} for m in masc],
        "vehiculos": [{"id": str(v["ID"]), "tipo": txt(v["TIPO"]), "marca": txt(v["MARCA"]), "linea": txt(v["LINEA"]),
                       "placa": txt(v["PLACA"]), "anio": v["ANIO"], "origen": txt(v["ORIGEN"])} for v in veh],
        "afiliaciones": [{"id": str(s["ID"]), "afiliacionId": str(s["AFILIACION_ID"]), "ingreso": iso(s["FECHA_INGRESO"]),
                          "vence": iso(s["FECHA_VENCE"]), "carnet": txt(s["CARNET"]), "estado": txt(s["ESTADO"]),
                          "origen": txt(s["ORIGEN"])} for s in soc],
        "notasLista": [{"id": str(n["ID"]), "tipo": txt(n["TIPO"]), "texto": txt(n["TEXTO"]), "vence": iso(n["VENCE"]),
                   "hecha": bool(n["HECHA"]), "autor": txt(n["AUTOR"]),
                   "fecha": n["CREADO"].date().isoformat() if n["CREADO"] else None} for n in notas],
    }


def ficha(cid: str) -> dict:
    ref = resolver(cid)
    cat = get_catalogos()
    with conexion.erp() as erp:
        fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
    with conexion.crm(lectura=True) as con:
        ext = _ext(con, ref["tarjeta"]) if "~" not in cid else None
        rel = _relaciones(con, ref["tarjeta"], cat) if "~" not in cid else {"mascotas": [], "vehiculos": [], "afiliaciones": [], "notasLista": []}
        fus = _fusionados(con, ref["tarjeta"])
    c = ficha_desde_erp(fila, cat)
    estado = txt(ext.get("ESTADO")) if ext else "activo"
    avisos = []
    if "~" in cid:
        avisos.append("El número de tarjeta de este cliente está repetido en el ERP: no se puede editar desde el CRM hasta que se corrija en el POS.")
    if ref.get("generico"):
        avisos.append("Registro genérico del POS (consumidor final): no es una persona. Se muestra, pero no se edita ni recibe ventas en el CRM.")
    if fila.get("CIUDAD") and not cat.ciudad(txt(fila["CIUDAD"])):
        avisos.append(f"La ciudad {txt(fila['CIUDAD'])} del ERP no está en el catálogo CIUDAD.")
    if fila.get("CODPROFE") and not cat.profesion(txt(fila["CODPROFE"])):
        avisos.append(f"La profesión {txt(fila['CODPROFE'])} del ERP no está en GANPROFE: se muestra el texto guardado.")
    c.update({
        "id": cid, "estado": estado if estado in ESTADOS else "activo",
        "motivoEstado": txt(ext.get("MOTIVO_ESTADO")) if ext else "", "fusionadoEn": txt(ext.get("FUSIONADO_EN")) if ext else "",
        "fusionados": [{"tarjeta": txt(f["CODCLI"]), "documento": txt(f["CEDCLI"])} for f in fus],
        "etiquetas": [e for e in txt(ext.get("ETIQUETAS")).split("|") if e] if ext else [],
        "notas": txt(ext.get("OBSERVACIONES")) if ext else "",
        "consentFecha": ext["CONSENT_FECHA"].isoformat() if ext and ext.get("CONSENT_FECHA") else None,
        "consentMedio": txt(ext.get("CONSENT_MEDIO")) if ext else "",
        "origen": txt(ext.get("ORIGEN")) if ext else "ERP",
        "editable": bool(ref["editable"]) and estado != "anonimizado",
        "avisos": avisos, "version": _version(fila, ext),
    })
    c.update(_metricas([c["documento"]] + [txt(f["CEDCLI"]) for f in fus]))
    c.update(rel)
    return c


def cambios(cid: str, limite: int = 200) -> list[dict]:
    ref = resolver(cid)
    with conexion.crm(lectura=True) as con:
        rows = conexion.filas(con, f"SELECT TOP {int(limite)} ID, FECHA, USUARIO, ROL, ACCION, TABLA, CAMPO, ANTES, DESPUES, ESTADO, DETALLE "
                                   "FROM CRM_AUDITORIA WHERE CODCLI = ? ORDER BY FECHA DESC, ID DESC", (ref["tarjeta"],))
    return [{"id": str(r["ID"]), "ts": r["FECHA"].isoformat(timespec="seconds") if r["FECHA"] else "", "autor": txt(r["USUARIO"]),
             "rol": txt(r["ROL"]), "accion": txt(r["ACCION"]), "tabla": txt(r["TABLA"]), "campo": txt(r["CAMPO"]),
             "antes": txt(r["ANTES"]), "despues": txt(r["DESPUES"]), "estado": txt(r["ESTADO"]), "detalle": txt(r["DETALLE"])}
            for r in rows]


def campanas(cid: str) -> list[dict]:
    ref = resolver(cid)
    return get_store().campanas_de_clientes([ref["documento"]])


# ------------------------------------------------------------------------------------------ edición
def _separar(cambios_: dict) -> tuple[dict, dict]:
    erp = {k: v for k, v in cambios_.items() if k in CAMPOS_FICHA}
    crm = {k: v for k, v in cambios_.items() if k in CAMPOS_CRM}
    otros = set(cambios_) - set(erp) - set(crm)
    if otros:
        raise DatoInvalido(sorted(otros)[0], "Ese dato no se puede editar desde el CRM.")
    return erp, crm


def _campos_ext(crm: dict, consentimiento: str | None, consent_fecha_actual) -> dict:
    out = {}
    if "etiquetas" in crm:
        etq = [re.sub(r"[|]", "", txt(e))[:24] for e in (crm["etiquetas"] or []) if txt(e)]
        s = "|".join(dict.fromkeys(etq))
        if len(s) > 250:
            raise DatoInvalido("etiquetas", "Demasiadas etiquetas (máximo 250 caracteres en total).")
        out["ETIQUETAS"] = s
    if "notas" in crm:
        out["OBSERVACIONES"] = txt(crm["notas"])[:2000]
    if "consentMedio" in crm:
        out["CONSENT_MEDIO"] = txt(crm["consentMedio"])[:40]
    if "consentFecha" in crm:
        v = crm["consentFecha"]
        try:
            out["CONSENT_FECHA"] = date.fromisoformat(v) if v else None
        except ValueError:
            raise DatoInvalido("consentFecha", "Fecha de consentimiento no válida.") from None
    if consentimiento in ("si", "no") and "CONSENT_FECHA" not in out and not consent_fecha_actual:
        out["CONSENT_FECHA"] = date.today()
    if consentimiento == "sin_registro":
        out["CONSENT_FECHA"], out["CONSENT_MEDIO"] = None, ""
    return out


def actualizar(cid: str, cambios_: dict, version_vista: str | None, actor: Actor, accion: str = "editar") -> dict:
    exigir_escritura(actor)
    ref = resolver(cid)
    if not ref["editable"]:
        raise Conflicto("Este cliente no se puede editar desde el CRM (anonimizado o con tarjeta repetida en el ERP).")
    erp_c, crm_c = _separar(cambios_)
    cat = get_catalogos()
    with conexion.ESCRITURA:
        with conexion.erp() as erp:
            fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
        with conexion.crm() as con:
            ext = _ext(con, ref["tarjeta"])
            if version_vista and version_vista != _version(fila, ext):
                raise Conflicto("Otra persona (o la caja) modificó este cliente mientras usted lo editaba. "
                                "Recargue la ficha para ver los datos actuales.")
            if ext and txt(ext.get("ESTADO")) == "anonimizado":
                raise Conflicto("El cliente está anonimizado: sus datos personales no se pueden volver a cargar.")
            cols = columnas_para(erp_c, fila, cat)
            escribir_poscli(con, actor, accion, ref["rid"], ref["tarjeta"], cols, fila)
            campos_ext = _campos_ext(crm_c, erp_c.get("consentimiento"), ext.get("CONSENT_FECHA") if ext else None)
            if campos_ext:
                for k, (a, d) in _upsert_ext(con, ref["tarjeta"], ref["documento"], actor, **campos_ext).items():
                    _auditar(con, actor, accion, "CRM_CLIENTE_EXT", ref["tarjeta"], k, a, d)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


def cambiar_estado(cid: str, estado: str, motivo: str, actor: Actor) -> dict:
    exigir_escritura(actor)
    if estado not in ("activo", "inactivo"):
        raise DatoInvalido("estado", "Estado no válido.")
    ref = resolver(cid)
    if "~" in cid:
        raise Conflicto("Cliente con tarjeta repetida en el ERP: corríjalo primero en el POS.")
    with conexion.ESCRITURA, conexion.crm() as con:
        ext = _ext(con, ref["tarjeta"])
        if ext and txt(ext.get("ESTADO")) == "anonimizado":
            raise Conflicto("Un cliente anonimizado no se puede reactivar.")
        campos = {"ESTADO": estado, "MOTIVO_ESTADO": txt(motivo)[:120]}
        if estado == "activo":
            campos["FUSIONADO_EN"] = ""
        for k, (a, d) in _upsert_ext(con, ref["tarjeta"], ref["documento"], actor, **campos).items():
            _auditar(con, actor, "reactivar" if estado == "activo" else "desactivar", "CRM_CLIENTE_EXT", ref["tarjeta"], k, a, d)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


# ------------------------------------------------------------------------------------------ altas
def crear(datos: dict, actor: Actor) -> dict:
    exigir_escritura(actor)
    documento = re.sub(r"\D", "", txt(datos.get("documento")))
    codcli = codigo_tarjeta(documento)
    erp_c, crm_c = _separar({k: v for k, v in datos.items() if k != "documento"})
    for oblig in ("nombre1", "apellido1"):
        if not txt(erp_c.get(oblig)):
            raise DatoInvalido(oblig, "El primer nombre y el primer apellido son obligatorios.")
    cat = get_catalogos()
    vacios = {k: v for k, v in erp_c.items() if v not in ("", None) or k in ("nombre1", "apellido1")}
    cols = columnas_para(vacios, {}, cat)
    with conexion.ESCRITURA:
        with conexion.erp() as erp:
            if conexion.filas(erp, "SELECT TOP 1 CODCLI FROM POSCLI WHERE CEDCLI = ?", (documento,)):
                raise Conflicto(f"Ya existe un cliente con el documento {documento}. Búsquelo para editarlo o fusionarlo.")
            if conexion.filas(erp, "SELECT TOP 1 CEDCLI FROM POSCLI WHERE CODCLI = ?", (codcli,)):
                raise Conflicto(f"La tarjeta {codcli} ya está asignada a otro cliente en el ERP.")
        nuevo = {"CODCLI": codcli, "CEDCLI": documento, "FECHAI": _hoy_num(), "FECHAMOD": _hoy_num(), **cols}
        if "TIPODOC" not in nuevo:
            nuevo["TIPODOC"], nuevo["TIPCLI"] = "13", "Cedula"
        suc = get_settings().clientes_sucursal_alta
        if suc:
            nuevo["SUCURSAL"] = suc[:3]
        with conexion.crm() as con:
            aid = _auditar(con, actor, "crear", "POSCLI", codcli, "Cliente", "", f"{documento} {nuevo.get('NOMCLI', '')}", estado="pendiente")
            try:
                with conexion.erp(lectura=False, transaccion=True) as erp:
                    erp.cursor().execute(f"INSERT INTO POSCLI ({', '.join(nuevo)}) VALUES ({', '.join('?' * len(nuevo))})",
                                         tuple(nuevo.values()))
            except Exception as e:
                _marcar(con, [aid], "fallido", str(e))
                raise
            _marcar(con, [aid], "aplicado")
            campos_ext = {"ORIGEN": "CRM", **_campos_ext(crm_c, erp_c.get("consentimiento"), None)}
            _upsert_ext(con, codcli, documento, actor, **campos_ext)
    get_indice().refrescar([codcli])
    return ficha(codcli)


# ------------------------------------------------------------------------------------------ bajas
def referencias(cid: str) -> dict:
    ref = resolver(cid)
    with conexion.erp() as erp:
        fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
    with conexion.crm(lectura=True) as con:
        n = lambda t: int(conexion.filas(con, f"SELECT COUNT(*) AS N FROM {t} WHERE CODCLI = ?", (ref["tarjeta"],))[0]["N"])  # noqa: E731
        ext = _ext(con, ref["tarjeta"])
        out = {"mascotas": n("CRM_MASCOTA"), "afiliaciones": n("CRM_AFILIACION_CLIENTE"), "vehiculos": n("CRM_VEHICULO"),
               "notas": n("CRM_NOTA")}
    m = _metricas([ref["documento"]])
    out["compras"] = m["visitas"]
    out["campanas"] = len(get_store().campanas_de_clientes([ref["documento"]]))
    out["puntos"] = float(fila.get("PUNTOS") or 0)
    motivos = []
    if not ext or txt(ext.get("ORIGEN")) != "CRM":
        motivos.append("fue creado en el ERP (la caja o la web), no en el CRM")
    if m["visitas"]:
        motivos.append(f"tiene {m['visitas']} compra(s) registradas")
    if float(fila.get("PUNTOS") or 0) or (fila.get("ULTPTOS") and int(float(fila.get("ULTPTOS") or 0))) or float(fila.get("VLRTOTAL") or 0):
        motivos.append("tiene movimiento de puntos Gana Mercaldas")
    if out["campanas"]:
        motivos.append("aparece en campañas enviadas")
    out["puedeEliminar"] = not motivos and "~" not in cid
    out["motivoNoEliminar"] = ("No se puede eliminar: " + "; ".join(motivos) + ". Desactívelo o anonimícelo.") if motivos else ""
    return out


def anonimizar(cid: str, actor: Actor) -> dict:
    exigir_escritura(actor, admin=True)
    ref = resolver(cid)
    if "~" in cid:
        raise Conflicto("Cliente con tarjeta repetida en el ERP: corríjalo primero en el POS.")
    cols = {**columnas_anonimizar(), **{k: False for k in CLUBES_POSCLI}}
    with conexion.ESCRITURA:
        with conexion.erp() as erp:
            fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
        with conexion.crm() as con:
            escribir_poscli(con, actor, "anonimizar", ref["rid"], ref["tarjeta"], cols, fila)
            cur = con.cursor()
            for t in ("CRM_MASCOTA", "CRM_VEHICULO", "CRM_NOTA", "CRM_AFILIACION_CLIENTE"):
                cur.execute(f"DELETE FROM {t} WHERE CODCLI = ?", (ref["tarjeta"],))
            _upsert_ext(con, ref["tarjeta"], ref["documento"], actor, ESTADO="anonimizado", MOTIVO_ESTADO="Supresión de datos (Ley 1581)",
                        ETIQUETAS="", OBSERVACIONES="", CONSENT_MEDIO="Supresión solicitada", CONSENT_FECHA=date.today())
            _auditar(con, actor, "anonimizar", "CRM", ref["tarjeta"], "Datos personales", "Eliminados", "Anonimizado (Ley 1581)")
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


def eliminar(cid: str, actor: Actor) -> None:
    exigir_escritura(actor, admin=True)
    ref = resolver(cid)
    r = referencias(cid)
    if not r["puedeEliminar"]:
        raise Conflicto(r["motivoNoEliminar"] or "No se puede eliminar este cliente.")
    with conexion.ESCRITURA, conexion.crm() as con:
        aid = _auditar(con, actor, "eliminar", "POSCLI", ref["tarjeta"], "Cliente", f"{ref['documento']}", "", estado="pendiente")
        try:
            with conexion.erp(lectura=False, transaccion=True) as erp:
                cur = erp.cursor()
                cur.execute("DELETE FROM POSCLI WHERE ROWID = ? AND CODCLI = ? AND CEDCLI = ?", (ref["rid"], ref["tarjeta"], ref["documento"]))
                if cur.rowcount != 1:
                    raise Conflicto("El borrado habría afectado un número inesperado de filas; se canceló.")
        except Exception as e:
            _marcar(con, [aid], "fallido", str(e))
            raise
        _marcar(con, [aid], "aplicado")
        cur = con.cursor()
        for t in ("CRM_MASCOTA", "CRM_VEHICULO", "CRM_NOTA", "CRM_AFILIACION_CLIENTE", "CRM_CLIENTE_EXT"):
            cur.execute(f"DELETE FROM {t} WHERE CODCLI = ?", (ref["tarjeta"],))
    get_indice().refrescar([ref["tarjeta"]])


# ------------------------------------------------------------------------------------------ sincronización con POSCLI
def _sync_mascotas(con, actor: Actor, ref: dict, cat: Catalogos) -> None:
    activas = conexion.filas(con, "SELECT TIPO_COD, NOMBRE FROM CRM_MASCOTA WHERE CODCLI = ? AND ACTIVA = TRUE ORDER BY ID", (ref["tarjeta"],))
    if activas:
        tipos = list(dict.fromkeys(txt(m["TIPO_COD"]) for m in activas))
        nombres = [(cat.mascota(t) or {}).get("nombre", "Otro").upper() for t in tipos]
        cols = {"MASCOTA": True, "CODMASCO": tipos[0], "TMASCOTA": " Y ".join(nombres)[:20], "NOMMASCO": txt(activas[0]["NOMBRE"]).upper()[:50]}
    else:
        cols = {"MASCOTA": False, "CODMASCO": "01", "TMASCOTA": "SIN MASCOTA", "NOMMASCO": ""}
    with conexion.erp() as erp:
        fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
    escribir_poscli(con, actor, "sincronizar", ref["rid"], ref["tarjeta"], cols, fila)


def _sync_vehiculos(con, actor: Actor, ref: dict, cat: Catalogos) -> None:
    tipos = [txt(v["TIPO"]) for v in conexion.filas(con, "SELECT TIPO FROM CRM_VEHICULO WHERE CODCLI = ?", (ref["tarjeta"],))]
    codigos = {VEHICULO_A_GANAUTOS.get(t, "VP") for t in tipos}
    cod = next((c for c in PRIORIDAD_GANAUTOS if c in codigos), "XX")
    nombre = next((v["nombre"] for v in cat.datos["vehiculos"] if v["id"] == cod), "")
    cols = {"TCARRO": cod == "VP", "CODVEHI": cod, "TVEHI": nombre.upper()[:50]}
    with conexion.erp() as erp:
        fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
    escribir_poscli(con, actor, "sincronizar", ref["rid"], ref["tarjeta"], cols, fila)


def _sync_clubes(con, actor: Actor, ref: dict) -> None:
    """Refleja en las banderas CLUB* de POSCLI (las que lee el POS para los descuentos) las afiliaciones activas del CRM.
    Una bandera vacía (NULL) y un 'no' significan lo mismo para el POS: no se reescribe NULL → falso."""
    afis = conexion.filas(con, "SELECT ID, CAMPO_POSCLI FROM CRM_AFILIACION WHERE CAMPO_POSCLI <> ''")
    activos = {int(r["AFILIACION_ID"]) for r in conexion.filas(
        con, "SELECT AFILIACION_ID FROM CRM_AFILIACION_CLIENTE WHERE CODCLI = ? AND ESTADO = 'activa'", (ref["tarjeta"],))}
    deseado = {txt(a["CAMPO_POSCLI"]): int(a["ID"]) in activos for a in afis if txt(a["CAMPO_POSCLI"]) in CLUBES_POSCLI}
    if not deseado:
        return
    with conexion.erp() as erp:
        fila = _fila_erp(erp, ref["rid"], ref["tarjeta"])
    cols = {k: v for k, v in deseado.items() if not (v is False and not fila.get(k))}
    escribir_poscli(con, actor, "sincronizar", ref["rid"], ref["tarjeta"], cols, fila)


def _ref_editable(cid: str) -> dict:
    ref = resolver(cid)
    if not ref["editable"]:
        raise Conflicto("Este cliente no se puede editar desde el CRM (anonimizado o con tarjeta repetida en el ERP).")
    return ref


# ------------------------------------------------------------------------------------------ mascotas
def guardar_mascota(cid: str, m: dict, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    cat = get_catalogos()
    tipo = txt(m.get("tipoId"))
    if not cat.mascota(tipo) or tipo == "01":
        raise DatoInvalido("tipoId", "Elija un tipo de mascota del catálogo GANMASCOTA.")
    nombre = re.sub(r"\s+", " ", txt(m.get("nombre"))).title()
    if len(nombre) < 1 or len(nombre) > 40:
        raise DatoInvalido("nombre", "Escriba el nombre de la mascota (máximo 40 caracteres).")
    sexo = txt(m.get("sexo")) or "N"
    if sexo not in ("H", "M", "N"):
        raise DatoInvalido("sexo", "Sexo no válido.")
    nac = m.get("nacimiento")
    try:
        nac = date.fromisoformat(nac) if nac else None
    except ValueError:
        raise DatoInvalido("nacimiento", "Fecha no válida.") from None
    if nac and nac > date.today():
        raise DatoInvalido("nacimiento", "La fecha no puede ser futura.")
    valores = (tipo, nombre, txt(m.get("raza"))[:40], sexo, nac, txt(m.get("notas"))[:120])
    with conexion.ESCRITURA, conexion.crm() as con:
        cur = con.cursor()
        if m.get("id"):
            r = conexion.filas(con, "SELECT ID, NOMBRE, TIPO_COD FROM CRM_MASCOTA WHERE ID = ? AND CODCLI = ?", (int(m["id"]), ref["tarjeta"]))
            if not r:
                raise NoEncontrado("La mascota no existe.")
            cur.execute("UPDATE CRM_MASCOTA SET TIPO_COD = ?, NOMBRE = ?, RAZA = ?, SEXO = ?, FECHA_NAC = ?, NOTAS = ?, ACTIVA = TRUE, "
                        "ACTUALIZADO = NOW(), USUARIO = ? WHERE ID = ?", (*valores, actor.usuario[:40], int(m["id"])))
            _auditar(con, actor, "editar", "CRM_MASCOTA", ref["tarjeta"], "Mascota", f"{txt(r[0]['NOMBRE'])}", f"{nombre}")
        else:
            cur.execute("INSERT INTO CRM_MASCOTA (CODCLI, CEDCLI, TIPO_COD, NOMBRE, RAZA, SEXO, FECHA_NAC, NOTAS, ACTIVA, ORIGEN, CREADO, "
                        "ACTUALIZADO, USUARIO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'CRM', NOW(), NOW(), ?)",
                        (ref["tarjeta"], ref["documento"], *valores, actor.usuario[:40]))
            _auditar(con, actor, "crear", "CRM_MASCOTA", ref["tarjeta"], "Mascota", "", f"{nombre} ({cat.mascota(tipo)['nombre']})")
        _sync_mascotas(con, actor, ref, cat)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


def borrar_mascota(cid: str, mid: str, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    cat = get_catalogos()
    with conexion.ESCRITURA, conexion.crm() as con:
        r = conexion.filas(con, "SELECT NOMBRE, TIPO_COD FROM CRM_MASCOTA WHERE ID = ? AND CODCLI = ?", (int(mid), ref["tarjeta"]))
        if not r:
            raise NoEncontrado("La mascota no existe.")
        con.cursor().execute("DELETE FROM CRM_MASCOTA WHERE ID = ?", (int(mid),))
        _auditar(con, actor, "eliminar", "CRM_MASCOTA", ref["tarjeta"], "Mascota",
                 f"{txt(r[0]['NOMBRE'])} ({(cat.mascota(txt(r[0]['TIPO_COD'])) or {}).get('nombre', '')})", "")
        _sync_mascotas(con, actor, ref, cat)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


# ------------------------------------------------------------------------------------------ vehículos
PLACA_RE = re.compile(r"^[A-Z]{3}\d{2}[A-Z0-9]$")


def guardar_vehiculo(cid: str, v: dict, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    cat = get_catalogos()
    tipo = txt(v.get("tipo"))
    if tipo not in VEHICULO_A_GANAUTOS:
        raise DatoInvalido("tipo", "Tipo de vehículo no válido.")
    placa = re.sub(r"[\s-]", "", txt(v.get("placa"))).upper()
    if placa and not PLACA_RE.match(placa):
        raise DatoInvalido("placa", "La placa debe verse como ABC123 (o ABC12D en moto).")
    anio = v.get("anio")
    if anio is not None and (not isinstance(anio, int) or not 1950 <= anio <= date.today().year + 1):
        raise DatoInvalido("anio", "Año no válido.")
    valores = (tipo, VEHICULO_A_GANAUTOS[tipo], txt(v.get("marca"))[:30], txt(v.get("linea"))[:30], placa, anio)
    with conexion.ESCRITURA, conexion.crm() as con:
        cur = con.cursor()
        if v.get("id"):
            if not conexion.filas(con, "SELECT ID FROM CRM_VEHICULO WHERE ID = ? AND CODCLI = ?", (int(v["id"]), ref["tarjeta"])):
                raise NoEncontrado("El vehículo no existe.")
            cur.execute("UPDATE CRM_VEHICULO SET TIPO = ?, COD_GANAUTOS = ?, MARCA = ?, LINEA = ?, PLACA = ?, ANIO = ?, ACTUALIZADO = NOW(), "
                        "USUARIO = ? WHERE ID = ?", (*valores, actor.usuario[:40], int(v["id"])))
            _auditar(con, actor, "editar", "CRM_VEHICULO", ref["tarjeta"], "Vehículo", "", f"{tipo} {placa}")
        else:
            cur.execute("INSERT INTO CRM_VEHICULO (CODCLI, CEDCLI, TIPO, COD_GANAUTOS, MARCA, LINEA, PLACA, ANIO, ORIGEN, CREADO, ACTUALIZADO, "
                        "USUARIO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CRM', NOW(), NOW(), ?)",
                        (ref["tarjeta"], ref["documento"], *valores, actor.usuario[:40]))
            _auditar(con, actor, "crear", "CRM_VEHICULO", ref["tarjeta"], "Vehículo", "", f"{tipo} {placa}")
        _sync_vehiculos(con, actor, ref, cat)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


def borrar_vehiculo(cid: str, vid: str, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    cat = get_catalogos()
    with conexion.ESCRITURA, conexion.crm() as con:
        r = conexion.filas(con, "SELECT TIPO, PLACA FROM CRM_VEHICULO WHERE ID = ? AND CODCLI = ?", (int(vid), ref["tarjeta"]))
        if not r:
            raise NoEncontrado("El vehículo no existe.")
        con.cursor().execute("DELETE FROM CRM_VEHICULO WHERE ID = ?", (int(vid),))
        _auditar(con, actor, "eliminar", "CRM_VEHICULO", ref["tarjeta"], "Vehículo", f"{txt(r[0]['TIPO'])} {txt(r[0]['PLACA'])}", "")
        _sync_vehiculos(con, actor, ref, cat)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


# ------------------------------------------------------------------------------------------ afiliaciones (catálogo)
def listar_afiliaciones() -> list[dict]:
    with conexion.crm(lectura=True) as con:
        afis = conexion.filas(con, "SELECT * FROM CRM_AFILIACION ORDER BY NOMBRE")
        conteo = {int(r["AFILIACION_ID"]): (int(r["N"]), int(r["A"])) for r in conexion.filas(
            con, "SELECT AFILIACION_ID, COUNT(*) AS N, SUM(CASE WHEN ESTADO = 'activa' THEN 1 ELSE 0 END) AS A "
                 "FROM CRM_AFILIACION_CLIENTE GROUP BY AFILIACION_ID")}
    return [{"id": str(a["ID"]), "codigo": txt(a["CODIGO"]), "nombre": txt(a["NOMBRE"]), "descripcion": txt(a["DESCRIPCION"]),
             "beneficios": txt(a["BENEFICIOS"]), "color": txt(a["COLOR"]) or "#64748b", "activa": bool(a["ACTIVA"]),
             "vigenciaMeses": int(a["VIGENCIA_MESES"] or 12), "campoPoscli": txt(a["CAMPO_POSCLI"]),
             "socios": conteo.get(int(a["ID"]), (0, 0))[0], "sociosActivos": conteo.get(int(a["ID"]), (0, 0))[1]} for a in afis]


def guardar_afiliacion(a: dict, actor: Actor) -> list[dict]:
    exigir_escritura(actor)
    nombre = re.sub(r"\s+", " ", txt(a.get("nombre")))
    if not 3 <= len(nombre) <= 40:
        raise DatoInvalido("nombre", "El nombre del club debe tener entre 3 y 40 caracteres.")
    color = txt(a.get("color")) or "#64748b"
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise DatoInvalido("color", "Color no válido.")
    vig = int(a.get("vigenciaMeses") or 12)
    if not 1 <= vig <= 60:
        raise DatoInvalido("vigenciaMeses", "La vigencia va de 1 a 60 meses.")
    with conexion.ESCRITURA, conexion.crm() as con:
        dup = conexion.filas(con, "SELECT ID FROM CRM_AFILIACION WHERE UPPER(NOMBRE) = ?", (nombre.upper(),))
        if dup and str(dup[0]["ID"]) != str(a.get("id") or ""):
            raise DatoInvalido("nombre", "Ya existe un club con ese nombre.")
        vals = (nombre, txt(a.get("descripcion"))[:120], txt(a.get("beneficios"))[:200], color, vig, bool(a.get("activa", True)))
        cur = con.cursor()
        if a.get("id"):
            cur.execute("UPDATE CRM_AFILIACION SET NOMBRE = ?, DESCRIPCION = ?, BENEFICIOS = ?, COLOR = ?, VIGENCIA_MESES = ?, ACTIVA = ?, "
                        "ACTUALIZADO = NOW() WHERE ID = ?", (*vals, int(a["id"])))
            _auditar(con, actor, "editar", "CRM_AFILIACION", "", "Club", "", nombre)
        else:
            base = re.sub(r"[^A-Z0-9]", "", sin_tildes_up(nombre))[:8] or "CLUB"
            codigo, i = base, 1
            while conexion.filas(con, "SELECT ID FROM CRM_AFILIACION WHERE CODIGO = ?", (codigo,)):
                i += 1
                codigo = f"{base[:8]}{i}"
            cur.execute("INSERT INTO CRM_AFILIACION (CODIGO, NOMBRE, DESCRIPCION, BENEFICIOS, COLOR, VIGENCIA_MESES, ACTIVA, CAMPO_POSCLI, "
                        "CREADO, ACTUALIZADO) VALUES (?, ?, ?, ?, ?, ?, ?, '', NOW(), NOW())", (codigo, *vals))
            _auditar(con, actor, "crear", "CRM_AFILIACION", "", "Club", "", nombre)
    return listar_afiliaciones()


def sin_tildes_up(s: str) -> str:
    from .mapeo import sin_tildes
    return sin_tildes(s).upper()


def borrar_afiliacion(aid: str, actor: Actor) -> list[dict]:
    exigir_escritura(actor, admin=True)
    with conexion.ESCRITURA, conexion.crm() as con:
        a = conexion.filas(con, "SELECT NOMBRE, CAMPO_POSCLI FROM CRM_AFILIACION WHERE ID = ?", (int(aid),))
        if not a:
            raise NoEncontrado("El club no existe.")
        if txt(a[0]["CAMPO_POSCLI"]):
            raise Conflicto("Es un club histórico del POS (tiene bandera en POSCLI): desactívelo en lugar de eliminarlo.")
        if conexion.filas(con, "SELECT TOP 1 ID FROM CRM_AFILIACION_CLIENTE WHERE AFILIACION_ID = ?", (int(aid),)):
            raise Conflicto("Tiene socios: desactívelo en lugar de eliminarlo.")
        con.cursor().execute("DELETE FROM CRM_AFILIACION WHERE ID = ?", (int(aid),))
        _auditar(con, actor, "eliminar", "CRM_AFILIACION", "", "Club", txt(a[0]["NOMBRE"]), "")
    return listar_afiliaciones()


# ------------------------------------------------------------------------------------------ socios
def _vence(ingreso: date, meses: int) -> date:
    return ingreso + timedelta(days=round(meses * 30.44))


def guardar_socio(cid: str, s: dict, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    estado = txt(s.get("estado")) or "activa"
    if estado not in ("activa", "suspendida", "vencida"):
        raise DatoInvalido("estado", "Estado no válido.")
    with conexion.ESCRITURA, conexion.crm() as con:
        cur = con.cursor()
        if s.get("id"):
            r = conexion.filas(con, "SELECT ESTADO, AFILIACION_ID FROM CRM_AFILIACION_CLIENTE WHERE ID = ? AND CODCLI = ?", (int(s["id"]), ref["tarjeta"]))
            if not r:
                raise NoEncontrado("La afiliación no existe.")
            cur.execute("UPDATE CRM_AFILIACION_CLIENTE SET ESTADO = ?, ACTUALIZADO = NOW(), USUARIO = ? WHERE ID = ?",
                        (estado, actor.usuario[:40], int(s["id"])))
            _auditar(con, actor, "editar", "CRM_AFILIACION_CLIENTE", ref["tarjeta"], "Afiliación", txt(r[0]["ESTADO"]), estado)
        else:
            afi = conexion.filas(con, "SELECT ID, NOMBRE, VIGENCIA_MESES, ACTIVA, CODIGO FROM CRM_AFILIACION WHERE ID = ?", (int(s.get("afiliacionId") or 0),))
            if not afi or not afi[0]["ACTIVA"]:
                raise DatoInvalido("afiliacionId", "Elija un club activo.")
            if conexion.filas(con, "SELECT TOP 1 ID FROM CRM_AFILIACION_CLIENTE WHERE CODCLI = ? AND AFILIACION_ID = ? AND ESTADO <> 'vencida'",
                              (ref["tarjeta"], int(afi[0]["ID"]))):
                raise Conflicto("El cliente ya pertenece a este club.")
            try:
                ingreso = date.fromisoformat(s["ingreso"]) if s.get("ingreso") else date.today()
            except ValueError:
                raise DatoInvalido("ingreso", "Fecha de ingreso no válida.") from None
            carnet = txt(s.get("carnet"))[:20] or f"{txt(afi[0]['CODIGO'])}-{ref['documento'][-6:]}"
            cur.execute("INSERT INTO CRM_AFILIACION_CLIENTE (AFILIACION_ID, CODCLI, CEDCLI, FECHA_INGRESO, FECHA_VENCE, CARNET, ESTADO, ORIGEN, "
                        "CREADO, ACTUALIZADO, USUARIO) VALUES (?, ?, ?, ?, ?, ?, 'activa', 'CRM', NOW(), NOW(), ?)",
                        (int(afi[0]["ID"]), ref["tarjeta"], ref["documento"], ingreso, _vence(ingreso, int(afi[0]["VIGENCIA_MESES"] or 12)),
                         carnet, actor.usuario[:40]))
            _auditar(con, actor, "crear", "CRM_AFILIACION_CLIENTE", ref["tarjeta"], "Afiliación", "", txt(afi[0]["NOMBRE"]))
        _sync_clubes(con, actor, ref)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


def borrar_socio(cid: str, sid: str, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    with conexion.ESCRITURA, conexion.crm() as con:
        r = conexion.filas(con, "SELECT s.ID, a.NOMBRE FROM CRM_AFILIACION_CLIENTE s JOIN CRM_AFILIACION a ON a.ID = s.AFILIACION_ID "
                                "WHERE s.ID = ? AND s.CODCLI = ?", (int(sid), ref["tarjeta"]))
        if not r:
            raise NoEncontrado("La afiliación no existe.")
        con.cursor().execute("DELETE FROM CRM_AFILIACION_CLIENTE WHERE ID = ?", (int(sid),))
        _auditar(con, actor, "eliminar", "CRM_AFILIACION_CLIENTE", ref["tarjeta"], "Afiliación", txt(r[0]["NOMBRE"]), "")
        _sync_clubes(con, actor, ref)
    get_indice().refrescar([ref["tarjeta"]])
    return ficha(cid)


# ------------------------------------------------------------------------------------------ notas
def agregar_nota(cid: str, n: dict, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    texto = txt(n.get("texto"))
    if not texto:
        raise DatoInvalido("texto", "Escriba el texto de la nota.")
    tipo = "tarea" if n.get("tipo") == "tarea" else "nota"
    try:
        vence = date.fromisoformat(n["vence"]) if tipo == "tarea" and n.get("vence") else None
    except ValueError:
        raise DatoInvalido("vence", "Fecha no válida.") from None
    with conexion.crm() as con:
        con.cursor().execute("INSERT INTO CRM_NOTA (CODCLI, TIPO, TEXTO, VENCE, HECHA, AUTOR, CREADO) VALUES (?, ?, ?, ?, FALSE, ?, NOW())",
                             (ref["tarjeta"], tipo, texto[:300], vence, actor.usuario[:40]))
    return ficha(cid)


def alternar_nota(cid: str, nid: str, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    with conexion.crm() as con:
        con.cursor().execute("UPDATE CRM_NOTA SET HECHA = NOT HECHA WHERE ID = ? AND CODCLI = ?", (int(nid), ref["tarjeta"]))
    return ficha(cid)


def borrar_nota(cid: str, nid: str, actor: Actor) -> dict:
    exigir_escritura(actor)
    ref = _ref_editable(cid)
    with conexion.crm() as con:
        con.cursor().execute("DELETE FROM CRM_NOTA WHERE ID = ? AND CODCLI = ?", (int(nid), ref["tarjeta"]))
    return ficha(cid)


# ------------------------------------------------------------------------------------------ masivos
def _lote(ids: list[str]) -> list[dict]:
    if len(ids) > MAX_MASIVO:
        raise DatoInvalido("ids", f"Máximo {MAX_MASIVO} clientes por acción masiva.")
    if not ids:
        return []
    filas = get_indice().query(f"SELECT id, rid, tarjeta, documento, editable FROM cli WHERE id IN ({','.join('?' * len(ids))})", ids)
    return [f for f in filas if f["editable"]]


def asignar_club_masivo(ids: list[str], afiliacion_id: str, actor: Actor) -> int:
    exigir_escritura(actor)
    n = 0
    for f in _lote(ids):
        try:
            guardar_socio_sin_ficha(f, afiliacion_id, actor)
            n += 1
        except Conflicto:
            pass  # ya era socio
    return n


def guardar_socio_sin_ficha(f: dict, afiliacion_id: str, actor: Actor) -> None:
    with conexion.ESCRITURA, conexion.crm() as con:
        afi = conexion.filas(con, "SELECT ID, NOMBRE, VIGENCIA_MESES, ACTIVA, CODIGO FROM CRM_AFILIACION WHERE ID = ?", (int(afiliacion_id),))
        if not afi or not afi[0]["ACTIVA"]:
            raise DatoInvalido("afiliacionId", "Elija un club activo.")
        if conexion.filas(con, "SELECT TOP 1 ID FROM CRM_AFILIACION_CLIENTE WHERE CODCLI = ? AND AFILIACION_ID = ? AND ESTADO <> 'vencida'",
                          (f["tarjeta"], int(afi[0]["ID"]))):
            raise Conflicto("ya es socio")
        hoy = date.today()
        con.cursor().execute(
            "INSERT INTO CRM_AFILIACION_CLIENTE (AFILIACION_ID, CODCLI, CEDCLI, FECHA_INGRESO, FECHA_VENCE, CARNET, ESTADO, ORIGEN, CREADO, "
            "ACTUALIZADO, USUARIO) VALUES (?, ?, ?, ?, ?, ?, 'activa', 'CRM', NOW(), NOW(), ?)",
            (int(afi[0]["ID"]), f["tarjeta"], f["documento"], hoy, _vence(hoy, int(afi[0]["VIGENCIA_MESES"] or 12)),
             f"{txt(afi[0]['CODIGO'])}-{f['documento'][-6:]}", actor.usuario[:40]))
        _auditar(con, actor, "crear", "CRM_AFILIACION_CLIENTE", f["tarjeta"], "Afiliación", "", f"{txt(afi[0]['NOMBRE'])} (masivo)")
        _sync_clubes(con, actor, f)
    get_indice().refrescar([f["tarjeta"]])


def etiquetar_masivo(ids: list[str], etiqueta: str, actor: Actor) -> int:
    exigir_escritura(actor)
    etq = re.sub(r"[|]", "", txt(etiqueta))[:24]
    if not etq:
        raise DatoInvalido("etiqueta", "Escriba la etiqueta.")
    n, tocados = 0, []
    with conexion.ESCRITURA, conexion.crm() as con:
        for f in _lote(ids):
            ext = _ext(con, f["tarjeta"])
            actuales = [e for e in txt(ext.get("ETIQUETAS")).split("|") if e] if ext else []
            if etq in actuales or len("|".join(actuales + [etq])) > 250:
                continue
            _upsert_ext(con, f["tarjeta"], f["documento"], actor, ETIQUETAS="|".join(actuales + [etq]))
            _auditar(con, actor, "etiquetar", "CRM_CLIENTE_EXT", f["tarjeta"], "ETIQUETAS", "", etq)
            n += 1
            tocados.append(f["tarjeta"])
    get_indice().refrescar(tocados)
    return n


def desactivar_masivo(ids: list[str], actor: Actor) -> int:
    exigir_escritura(actor, admin=True)
    n, tocados = 0, []
    with conexion.ESCRITURA, conexion.crm() as con:
        for f in _lote(ids):
            if _upsert_ext(con, f["tarjeta"], f["documento"], actor, ESTADO="inactivo", MOTIVO_ESTADO="Desactivación masiva"):
                _auditar(con, actor, "desactivar", "CRM_CLIENTE_EXT", f["tarjeta"], "ESTADO", "activo", "inactivo")
                n += 1
                tocados.append(f["tarjeta"])
    get_indice().refrescar(tocados)
    return n


# ------------------------------------------------------------------------------------------ fusión
CAMPOS_FUSION = ("nombre1", "nombre2", "apellido1", "apellido2", "celular", "email", "nacimiento", "direccion", "consentimiento",
                 "ciudadId", "barrioId", "sexo", "profesionId")


def fusionar(ganador: str, perdedor: str, tomar: list[str], actor: Actor) -> dict:
    """El que permanece recibe los datos elegidos del que se retira y todas sus relaciones del CRM. El que se retira queda
    inactivo con referencia a la fusión. Las ventas NO se mueven en el ERP: la ficha suma las compras de ambos."""
    exigir_escritura(actor, admin=True)
    if ganador == perdedor:
        raise DatoInvalido("perdedor", "Elija dos clientes distintos.")
    g, p = _ref_editable(ganador), _ref_editable(perdedor)
    malos = set(tomar) - set(CAMPOS_FUSION)
    if malos:
        raise DatoInvalido("tomar", "Campo no permitido en la fusión.")
    if tomar:
        datos_p = ficha(perdedor)
        actualizar(ganador, {k: datos_p[k] for k in tomar}, None, actor, accion="fusionar")
    cat = get_catalogos()
    with conexion.ESCRITURA, conexion.crm() as con:
        cur = con.cursor()
        ya = {int(r["AFILIACION_ID"]) for r in conexion.filas(con, "SELECT AFILIACION_ID FROM CRM_AFILIACION_CLIENTE WHERE CODCLI = ?", (g["tarjeta"],))}
        if ya:
            cur.execute(f"DELETE FROM CRM_AFILIACION_CLIENTE WHERE CODCLI = ? AND AFILIACION_ID IN ({','.join('?' * len(ya))})",
                        (p["tarjeta"], *ya))
        for t in ("CRM_MASCOTA", "CRM_VEHICULO", "CRM_AFILIACION_CLIENTE"):
            cur.execute(f"UPDATE {t} SET CODCLI = ?, CEDCLI = ? WHERE CODCLI = ?", (g["tarjeta"], g["documento"], p["tarjeta"]))
        cur.execute("UPDATE CRM_NOTA SET CODCLI = ? WHERE CODCLI = ?", (g["tarjeta"], p["tarjeta"]))
        cur.execute("UPDATE CRM_CLIENTE_EXT SET FUSIONADO_EN = ? WHERE FUSIONADO_EN = ?", (g["tarjeta"], p["tarjeta"]))
        ext_p, ext_g = _ext(con, p["tarjeta"]), _ext(con, g["tarjeta"])
        etq = [e for e in (txt(ext_g.get("ETIQUETAS")) if ext_g else "").split("|") + (txt(ext_p.get("ETIQUETAS")) if ext_p else "").split("|") if e]
        if etq:
            _upsert_ext(con, g["tarjeta"], g["documento"], actor, ETIQUETAS="|".join(dict.fromkeys(etq))[:250])
        _upsert_ext(con, p["tarjeta"], p["documento"], actor, ESTADO="inactivo", FUSIONADO_EN=g["tarjeta"],
                    MOTIVO_ESTADO=f"Fusionado en {g['documento']} ({g['tarjeta']})")
        _auditar(con, actor, "fusionar", "CRM", g["tarjeta"], "Cliente", f"{p['documento']} ({p['tarjeta']})", "Fusionado aquí")
        _auditar(con, actor, "fusionar", "CRM", p["tarjeta"], "Cliente", "", f"Fusionado en {g['documento']} ({g['tarjeta']})")
        _sync_mascotas(con, actor, g, cat)
        _sync_vehiculos(con, actor, g, cat)
        _sync_clubes(con, actor, g)
    get_indice().refrescar([g["tarjeta"], p["tarjeta"]])
    return ficha(ganador)


def descartar_duplicado(ids: list[str], actor: Actor) -> None:
    exigir_escritura(actor)
    firma = ",".join(sorted(ids))[:200]
    with conexion.crm() as con:
        con.cursor().execute("INSERT INTO CRM_DUPLICADO_DESCARTE (FIRMA, USUARIO, FECHA) VALUES (?, ?, NOW())", (firma, actor.usuario[:40]))


def descartados() -> set[str]:
    with conexion.crm(lectura=True) as con:
        return {txt(r["FIRMA"]) for r in conexion.filas(con, "SELECT FIRMA FROM CRM_DUPLICADO_DESCARTE")}


# ------------------------------------------------------------------------------------------ importación
def validar_import(filas: list[dict]) -> list[dict]:
    if len(filas) > 5000:
        raise DatoInvalido("filas", "Máximo 5.000 filas por archivo.")
    docs = [re.sub(r"\D", "", txt(f.get("documento") or f.get("cedula"))) for f in filas]
    existentes = {}
    validos = [d for d in docs if d]
    for i in range(0, len(validos), 1000):
        lote = validos[i:i + 1000]
        for r in get_indice().query(f"SELECT documento, id, editable FROM cli WHERE documento IN ({','.join('?' * len(lote))})", lote):
            existentes[r["documento"]] = r
    cat = get_catalogos()
    vistos, out = set(), []
    for i, (f, doc) in enumerate(zip(filas, docs)):
        err = []
        if not re.fullmatch(r"\d{5,10}", doc):
            err.append("Documento no válido (5 a 10 dígitos)")
        elif doc in vistos:
            err.append("Documento repetido en el archivo")
        vistos.add(doc)
        cel, mail = txt(f.get("celular")), txt(f.get("email")).lower()
        if cel and not celular_normalizado(cel):
            err.append("Celular no válido")
        if mail and not email_valido(mail):
            err.append("Correo no válido")
        ciudad_txt = txt(f.get("ciudad"))
        ciudad = next((c for c in cat.datos["ciudades"] if c["nombre"].lower() == ciudad_txt.lower()), None) if ciudad_txt else None
        if ciudad_txt and not ciudad:
            err.append("Ciudad no está en el catálogo")
        ex = existentes.get(doc)
        nombres, apellidos = txt(f.get("nombres")).split(), txt(f.get("apellidos")).split()
        if not ex and (not nombres or not apellidos):
            err.append("Cliente nuevo: faltan nombres o apellidos")
        if ex and not ex["editable"]:
            err.append("El cliente existente no se puede editar")
        out.append({"fila": i + 2, "id": doc, "existe": bool(ex), "nombres": " ".join(nombres), "apellidos": " ".join(apellidos),
                    "celular": cel, "email": mail, "ciudad": ciudad["id"] if ciudad else "", "errores": err})
    return out


def aplicar_import(filas: list[dict], actor: Actor) -> dict:
    exigir_escritura(actor, admin=True)
    validas = [f for f in validar_import(filas) if not f["errores"]]
    creados = actualizados = 0
    errores = []
    for f in validas:
        try:
            if f["existe"]:
                ex = get_indice().query("SELECT id FROM cli WHERE documento = ? AND editable LIMIT 1", [f["id"]])
                if not ex:
                    continue
                c = ficha(ex[0]["id"])
                patch = {}
                if f["celular"] and not celular_normalizado(c["celular"]):
                    patch["celular"] = f["celular"]
                if f["email"] and not email_valido(c["email"]):
                    patch["email"] = f["email"]
                if f["ciudad"] and not c["ciudadId"]:
                    patch["ciudadId"] = f["ciudad"]
                if patch:
                    actualizar(ex[0]["id"], patch, None, actor, accion="importar")
                    actualizados += 1
            else:
                n, a = f["nombres"].split(), f["apellidos"].split()
                crear({"documento": f["id"], "nombre1": n[0], "nombre2": " ".join(n[1:]), "apellido1": a[0], "apellido2": " ".join(a[1:]),
                       "celular": f["celular"], "email": f["email"], "ciudadId": f["ciudad"]}, actor)
                creados += 1
        except (DatoInvalido, Conflicto) as e:
            errores.append(f"Fila {f['fila']}: {e}")
    return {"creados": creados, "actualizados": actualizados, "errores": errores[:50]}
