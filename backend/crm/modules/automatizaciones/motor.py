"""Motor de Automatizaciones: a quién le toca hoy, qué edición se le ofrece y quién queda fuera (y por qué).

Reglas (las mismas de Campañas, verificadas contra el ERP en vivo y con falla CERRADA):

* solo clientes activos que AUTORIZAN el tratamiento de datos y no tienen BLOQUE;
* si la oferta o el mensaje mencionan licor o cigarrillo, nunca a menores de 18;
* solo por los canales que el cliente tiene y autorizó;
* no se repite a la misma persona antes del plazo de la automatización, y hay un tope diario de envíos.

Ventana de eventos: una ejecución real cubre los días desde la última evaluada hasta hoy (si el servidor estuvo apagado
recupera hasta 3 días); la primera vez, solo hoy. Así nunca se le escribe de golpe a toda la base.
"""

from __future__ import annotations

import calendar
import logging
import threading
import time
from collections import Counter
from datetime import date, datetime, timedelta

from ...warehouse import WarehouseNoDisponible, get_warehouse
from ..campanas.segmentos import COSTOS_DEFECTO, _canales_de, _mask_nombre, productos_restringidos
from ..clientes.consultas import restricciones_contacto
from ..clientes.indice import IndiceNoListo, get_indice
from .almacen import AutoAlmacen, get_almacen

log = logging.getLogger("crm.automatizaciones")

MAX_RECUPERA = 3
MOTIVOS = {
    "no_activo": "No está activo en el CRM o no aparece en el ERP",
    "no_autoriza_o_bloqueado": "No autoriza sus datos o tiene BLOQUE (no enviar campañas)",
    "sin_autorizacion": "Sin registro de autorización de datos",
    "menor_de_edad": "Menor de edad (la oferta incluye licor o cigarrillo)",
    "fuera_de_filtros": "No está en los clubes o segmentos elegidos",
    "sin_canal": "Sin un canal autorizado de los elegidos",
    "ya_recibio": "Ya lo recibió dentro del plazo de no repetir",
    "tope_diario": "Superó el máximo de envíos del día",
}


class SinDatos(RuntimeError):
    """No hay ventas cargadas del ERP (las reglas de compra no se pueden evaluar)."""


class Ocupada(RuntimeError):
    """La automatización ya se está ejecutando."""


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_de(aid: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(aid, threading.Lock())


# ------------------------------------------------------------------------------------------ ventana y candidatos
def dias_ventana(ultima_ref: str | None, fecha: date) -> list[date]:
    """Días de eventos que cubre una ejecución real: desde el último evaluado (exclusivo) hasta ``fecha``, máximo 3."""
    ref = date.fromisoformat(ultima_ref) if ultima_ref else None
    if ref is None or ref >= fecha:
        return [fecha]
    return [ref + timedelta(days=i) for i in range(1, (fecha - ref).days + 1)][-MAX_RECUPERA:]


def cumples_de(dias: list[date], dias_antes: int) -> list[str]:
    """Cumpleaños ('MM-DD') que se saludan en esos días. El 29-feb se celebra el 28 en años no bisiestos."""
    out: list[str] = []
    for d in dias:
        obj = d + timedelta(days=dias_antes)
        out.append(obj.strftime("%m-%d"))
        if obj.month == 2 and obj.day == 28 and not calendar.isleap(obj.year):
            out.append("02-29")
    return list(dict.fromkeys(out))


def _candidatos(a: dict, dias: list[date]) -> list[tuple[str, float]]:
    """(documento, valor para priorizar) de quienes cumplen el disparo en esos días."""
    p, tipo = a["params"], a["tipo"]
    if tipo == "cumpleanos":
        filas = get_indice().query(
            "SELECT documento, MAX(COALESCE(venta_total, 0)) AS v FROM cli WHERE NOT generico AND estado = 'activo' "
            "AND documento <> '' AND list_contains(?::VARCHAR[], cumple) GROUP BY documento", [cumples_de(dias, int(p["dias_antes"]))])
        return [(f["documento"], float(f["v"] or 0)) for f in filas]
    if tipo == "bienvenida":
        fechas = [d - timedelta(days=int(p["dias_despues"])) for d in dias]
        filas = get_indice().query(
            "SELECT documento, MAX(COALESCE(venta_total, 0)) AS v FROM cli WHERE NOT generico AND estado = 'activo' "
            "AND documento <> '' AND list_contains(?::DATE[], creado) GROUP BY documento", [fechas])
        return [(f["documento"], float(f["v"] or 0)) for f in filas]
    try:
        wh = get_warehouse()
        if tipo == "segunda_compra":
            fechas = [d - timedelta(days=int(p["dias_despues"])) for d in dias]
            filas = wh.query("SELECT cliente_id, venta_total FROM cli_perfil WHERE visitas = 1 AND list_contains(?::DATE[], primera_compra)",
                             [fechas])
        else:   # reactivación: estado actual (no depende de la ventana); el plazo de «no repetir» evita insistir
            filas = wh.query("SELECT r.cliente_id, p.venta_total FROM cli_rfm r JOIN cli_perfil p USING (cliente_id) "
                             "WHERE p.visitas >= ? AND r.ratio_ciclo >= ? AND r.dias_sin_compra <= ?",
                             [int(p["min_visitas"]), float(p["umbral_ratio"]), int(p["max_dias_sin_compra"])])
    except WarehouseNoDisponible as e:
        raise SinDatos(f"Aún no hay ventas cargadas del ERP para evaluar esta automatización: {e}") from None
    return [(f["cliente_id"], float(f["venta_total"] or 0)) for f in filas]


def _info(documentos: list[str], filtros: dict) -> dict[str, dict]:
    """Datos de contacto y pertenencia (clubes, segmento) de los candidatos, desde el índice en vivo."""
    if not documentos:
        return {}
    filas = get_indice().query(
        "SELECT documento, any_value(nombres) AS nombres, any_value(apellidos) AS apellidos, bool_or(cel_ok) AS cel, "
        "bool_or(email_ok) AS mail, bool_or(list_has_any(string_split(clubes, ','), ?::VARCHAR[])) AS en_club, "
        "bool_or(list_contains(?::VARCHAR[], segmento)) AS en_seg "
        "FROM cli WHERE NOT generico AND estado = 'activo' AND list_contains(?::VARCHAR[], documento) GROUP BY documento",
        [filtros.get("clubes") or [], filtros.get("segmentos") or [], documentos])
    return {f["documento"]: f for f in filas}


def restringida(ed: dict) -> bool:
    """¿La oferta o el mensaje mencionan licor o cigarrillo? (entonces se excluyen menores de edad)."""
    o = ed.get("oferta") or {}
    textos = " ".join(str(v) for c in (ed.get("textos") or {}).values() for v in (c or {}).values())
    piezas = [*(o.get("productos") or []), {"producto": o.get("descripcion", "")}, {"producto": textos}]
    return bool(o.get("restringido")) or bool(productos_restringidos(piezas))


def costo_de(canales: list[str]) -> float:
    c = COSTOS_DEFECTO["whatsapp"] if "whatsapp" in canales else COSTOS_DEFECTO["sms"] if "sms" in canales else 0.0
    return c + (COSTOS_DEFECTO["email"] if "email" in canales else 0.0)


# ------------------------------------------------------------------------------------------ evaluación
def evaluar(a: dict, ed: dict, fecha: date, dias: list[date], alm: AutoAlmacen) -> dict:
    """Aplica todas las reglas y devuelve elegibles (en orden de prioridad) y excluidos por motivo."""
    r = restricciones_contacto()            # falla cerrada: sin la lista del ERP, IndiceNoListo
    cands: dict[str, float] = {}
    for doc, v in _candidatos(a, dias):
        if doc:
            cands[doc] = max(v, cands.get(doc, 0.0))
    orden = sorted(cands, key=lambda d: (-cands[d], d))
    info = _info(orden, a["filtros"])
    ya = alm.ya_recibieron(a["id"], fecha - timedelta(days=int(a["params"]["cooldown_dias"])), orden)
    menores_fuera = restringida(ed)
    fuera: Counter = Counter()
    elegibles: list[dict] = []
    clubes, segs = a["filtros"].get("clubes"), a["filtros"].get("segmentos")
    for doc in orden:
        i = info.get(doc)
        motivo = None
        if i is None or doc not in r.conocidos:
            motivo = "no_activo"
        elif doc in r.excluir:
            motivo = "no_autoriza_o_bloqueado"
        elif doc in r.sin_autorizacion:
            motivo = "sin_autorizacion"
        elif menores_fuera and doc in r.menores:
            motivo = "menor_de_edad"
        elif (clubes and not i["en_club"]) or (segs and not i["en_seg"]):
            motivo = "fuera_de_filtros"
        else:
            chs = _canales_de({"celular": bool(i["cel"]), "email_valido": bool(i["mail"]), "canales_bloqueados": r.canales_bloqueados.get(doc)},
                              ed["canales"])
            if not chs:
                motivo = "sin_canal"
            elif doc in ya:
                motivo = "ya_recibio"
            else:
                elegibles.append({"cliente_id": doc, "canales": chs, "nombre": f"{i['nombres'] or ''} {i['apellidos'] or ''}".strip()})
        if motivo:
            fuera[motivo] += 1
    tope = int(a["params"]["tope_diario"])
    if len(elegibles) > tope:
        fuera["tope_diario"] += len(elegibles) - tope
        elegibles = elegibles[:tope]
    por_canal = Counter(c for e in elegibles for c in e["canales"])
    return {"candidatos": len(orden), "elegibles": elegibles, "excluidos": {k: fuera.get(k, 0) for k in MOTIVOS if fuera.get(k)},
            "por_canal": {c: por_canal.get(c, 0) for c in ("whatsapp", "sms", "email")},
            "costo": round(sum(costo_de(e["canales"]) for e in elegibles)), "excluye_menores": menores_fuera}


def _resumen_edicion(ed: dict | None) -> dict | None:
    return {"id": ed["id"], "nombre": ed["nombre"], "oferta": ed["oferta"].get("descripcion"), "validez_dias": ed["validez_dias"]} if ed else None


def ejecutar(aid: str, *, fecha: date | None = None, origen: str = "manual", probar: bool = False, edicion_id: str | None = None) -> dict:
    """Evalúa la automatización. ``probar=True`` solo calcula (no registra nada): «¿a quién le tocaría ese día?».
    En una ejecución real los envíos quedan registrados (SIMULADOS) y el día queda marcado como evaluado."""
    alm = get_almacen()
    a = alm.exigir(aid)
    fecha = fecha or date.today()
    lock = _lock_de(aid)
    if not lock.acquire(blocking=False):
        raise Ocupada("Esta automatización ya se está ejecutando. Intente en unos segundos.")
    inicio = datetime.now().isoformat(timespec="seconds")
    try:
        ed = alm.edicion(aid, edicion_id) if edicion_id else alm.vigente(a, fecha)
        base = {"fecha": fecha.isoformat(), "edicion": _resumen_edicion(ed), "simulado": True, "probar": probar}
        if ed is None:
            res = {**base, "estado": "sin_edicion", "aviso": f"No hay una edición vigente el {fecha.isoformat()}: ese día no se envía nada."}
            if not probar:
                _registrar_una_vez(alm, aid, fecha, origen, "sin_edicion", None, res["aviso"], inicio)
            return res
        if ed["problemas"]:
            res = {**base, "estado": "incompleta", "aviso": "La edición está incompleta: " + " ".join(ed["problemas"])}
            if not probar:
                _registrar_una_vez(alm, aid, fecha, origen, "incompleta", ed["id"], res["aviso"], inicio)
            return res
        dias = [fecha] if probar else dias_ventana(a.get("ultima_ref"), fecha)
        ev = evaluar(a, ed, fecha, dias, alm)
        res = {**base, "estado": "ok", "dias": [d.isoformat() for d in dias], "candidatos": ev["candidatos"],
               "elegibles": len(ev["elegibles"]), "excluidos": ev["excluidos"], "por_canal": ev["por_canal"], "costo": ev["costo"],
               "excluye_menores": ev["excluye_menores"],
               "vigencia_desde": fecha.isoformat(), "vigencia_hasta": (fecha + timedelta(days=ed["validez_dias"] - 1)).isoformat()}
        if probar:
            res["muestra"] = [{"cliente": _mask_nombre(e["nombre"]), "canales": e["canales"]} for e in ev["elegibles"][:8]]
            return res
        reg = alm.registrar(aid, fecha=fecha, origen=origen, estado="ok", edicion_id=ed["id"], candidatos=ev["candidatos"],
                            envios=[(e["cliente_id"], ",".join(e["canales"])) for e in ev["elegibles"]], validez=ed["validez_dias"],
                            costo=ev["costo"], detalle={"excluidos": ev["excluidos"], "por_canal": ev["por_canal"], "dias": res["dias"]},
                            inicio=inicio)
        alm.marcar_ref(aid, fecha)
        res.update({"ejecucion_id": reg["id"], "enviados": reg["enviados"]})
        log.info("Automatización %s (%s): %s envíos simulados", a["nombre"], fecha, reg["enviados"])
        return res
    finally:
        lock.release()


def _registrar_una_vez(alm: AutoAlmacen, aid: str, fecha: date, origen: str, estado: str, eid: str | None, aviso: str, inicio: str) -> None:
    """Para estados sin envío (sin edición, incompleta): una sola fila por día, no una cada 30 s del planificador."""
    u = alm.ultima_ejecucion(aid)
    if u and u["fecha"] == fecha.isoformat() and u["estado"] == estado:
        return
    alm.registrar(aid, fecha=fecha, origen=origen, estado=estado, edicion_id=eid, detalle={"aviso": aviso}, inicio=inicio)


# ------------------------------------------------------------------------------------------ planificador
_avisos: dict[str, float] = {}


def _avisar(clave: str, msg: str, *args) -> None:
    """Advierte en el log como máximo una vez por hora por motivo (el planificador corre cada 30 s)."""
    if time.monotonic() - _avisos.get(clave, -1e9) > 3600:
        _avisos[clave] = time.monotonic()
        log.warning(msg, *args)


def ejecutar_pendientes(ahora: datetime | None = None) -> list[str]:
    """Corre las automatizaciones activas cuya hora ya pasó y que no se han evaluado hoy. Idempotente."""
    ahora = ahora or datetime.now()
    hoy, hora = ahora.date(), ahora.strftime("%H:%M")
    hechas = []
    for a in get_almacen().listar(solo_activas=True):
        if a.get("ultima_ref") == hoy.isoformat() or hora < a["hora"]:
            continue
        try:
            res = ejecutar(a["id"], fecha=hoy, origen="planificador")
            if res["estado"] == "ok":
                hechas.append(a["id"])
        except (IndiceNoListo, SinDatos) as e:   # falla cerrada: se reintenta en el siguiente ciclo
            _avisar(f"espera-{a['id']}", "Automatización %s en espera: %s", a["nombre"], e)
        except Ocupada:
            continue
        except Exception:
            if time.monotonic() - _avisos.get(f"error-{a['id']}", -1e9) > 3600:
                _avisos[f"error-{a['id']}"] = time.monotonic()
                log.exception("Falló la automatización %s", a["nombre"])
    return hechas
