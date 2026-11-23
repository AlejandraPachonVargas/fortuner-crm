"""Presupuesto mensual por canal: cuánto se ha gastado este mes y si se alcanzó el tope.

Gasto del mes = campañas publicadas o programadas para este mes (sus destinatarios del grupo «envío») + envíos de las
automatizaciones, cada uno al costo por mensaje vigente en Configuración. Igual que en las estimaciones: un cliente con
celular cuenta por WhatsApp si lo tiene, si no por SMS; el correo se suma.
"""

from __future__ import annotations

from datetime import date

from ...store import get_store
from .general import get_general
from .servicio import costos_por_mensaje

CANALES = ("whatsapp", "sms", "email")


def _mes(hoy: date | None = None) -> tuple[str, str]:
    h = hoy or date.today()
    ini = h.replace(day=1)
    fin = (ini.replace(year=ini.year + 1, month=1) if ini.month == 12 else ini.replace(month=ini.month + 1))
    return ini.isoformat(), fin.isoformat()


def _contar(listas: list[str]) -> dict[str, int]:
    n = {c: 0 for c in CANALES}
    for ch in listas:
        cs = set((ch or "").split(","))
        if "whatsapp" in cs:
            n["whatsapp"] += 1
        elif "sms" in cs:
            n["sms"] += 1
        if "email" in cs:
            n["email"] += 1
    return n


def gasto_mes(hoy: date | None = None) -> dict[str, float]:
    ini, fin = _mes(hoy)
    s = get_store()
    with s._lock:
        camp = [r[0] for r in s._db.execute(
            "SELECT d.canales FROM destinatario d JOIN campana c ON c.id = d.campana_id "
            "WHERE c.eliminada_en IS NULL AND d.grupo = 'envio' AND c.estado IN ('publicada', 'programada') "
            "AND substr(COALESCE(c.publicada_en, c.programada_para), 1, 10) >= ? "
            "AND substr(COALESCE(c.publicada_en, c.programada_para), 1, 10) < ?", (ini, fin))]
        auto = [r[0] for r in s._db.execute("SELECT canales FROM automatizacion_envio WHERE fecha >= ? AND fecha < ?", (ini, fin))]
    n = _contar(camp + auto)
    k = costos_por_mensaje()
    return {c: round(n[c] * k[c]) for c in CANALES}


def consumo(hoy: date | None = None) -> dict:
    cfg = get_general().seccion("presupuesto")
    gasto = gasto_mes(hoy)
    alerta = float(cfg["alerta_pct"])
    out = {}
    for c in CANALES:
        tope = float(cfg[f"tope_{c}"] or 0)
        pct = round(100 * gasto[c] / tope, 1) if tope else None
        out[c] = {"gastado": gasto[c], "tope": tope or None, "pct": pct, "disponible": max(0.0, tope - gasto[c]) if tope else None,
                  "alerta": bool(pct is not None and pct >= alerta), "agotado": bool(tope and gasto[c] >= tope)}
    return {"mes": _mes(hoy)[0][:7], "alerta_pct": alerta, "canales": out}


def costo_por_canal(por_canal: dict[str, int]) -> dict[str, float]:
    """Costo de una campaña por canal a partir de cuántos mensajes van por cada uno."""
    k = costos_por_mensaje()
    return {c: round((por_canal.get(c) or 0) * k[c]) for c in CANALES}


def excede(por_canal_costo: dict[str, float]) -> list[str]:
    """Mensajes para la persona si esta campaña haría pasar algún canal de su tope mensual."""
    con = consumo()["canales"]
    malos = []
    nombres = {"whatsapp": "WhatsApp", "sms": "SMS", "email": "correo"}
    for c, costo in por_canal_costo.items():
        t = con[c]
        if t["tope"] and costo > 0 and t["gastado"] + costo > t["tope"]:
            malos.append(f"{nombres[c]}: esta campaña cuesta ${costo:,.0f} y quedan ${t['disponible']:,.0f} de ${t['tope']:,.0f}"
                         .replace(",", "."))
    return malos
