"""Tablero de campañas: cuántas se hacen, a quién llegan, por qué canal, cuánto cuestan y si funcionan.

**Efectividad (incrementalidad).** Para cada campaña publicada o programada se mira la ventana de su oferta
(vigencia; si no tiene, los 7 días desde el lanzamiento) y se compara, con las ventas del ERP:

* grupo **envío**: % que compró alguno de los productos promocionados y venta de esos productos por persona;
* grupo **control** (reservado al azar, sin mensaje): lo mismo.

La diferencia es el efecto real de la campaña (lo que no se habría vendido igual). Solo se mide lo que las ventas
cubren: si la ventana empieza después de la fecha de corte, la campaña queda «sin datos aún»; si la cubre a medias,
«parcial». Los envíos hoy son SIMULADOS: la medición queda lista para cuando la difusión sea real.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date, datetime, timedelta

import pyarrow as pa

from ...store import get_store
from ...warehouse import WarehouseNoDisponible, get_warehouse
from ..campanas.segmentos import COSTOS_DEFECTO, OBJETIVOS, SEGMENTOS_RFM, costos_vigentes
from .comun import en_cache, entero, iso, meta_warehouse, pct, r2

log = logging.getLogger("crm.analitica.campanas")

ESTADOS = ("borrador", "programada", "publicada")
VENTANA_SIN_VIGENCIA = 7


def _fecha(v) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)).date() if "T" in str(v) or " " in str(v) else date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def normalizar(f: dict | None) -> dict:
    f = f or {}
    desde, hasta = _fecha(f.get("desde")), _fecha(f.get("hasta"))
    if desde and hasta and desde > hasta:
        desde, hasta = hasta, desde
    est = f.get("estados") or []
    est = est if isinstance(est, list) else str(est).split(",")
    return {"desde": iso(desde), "hasta": iso(hasta), "estados": [e for e in ESTADOS if e in est]}


def _referencia(c: dict) -> date | None:
    """Fecha que ubica la campaña en el tiempo: lanzamiento si existe; si no, creación."""
    return _fecha(c.get("publicada_en")) or _fecha(c.get("programada_para")) or _fecha(c.get("creada"))


def _ventana(c: dict) -> tuple[date, date, bool] | None:
    """(desde, hasta, es_vigencia_real). Sin vigencia: 7 días desde el lanzamiento (supuesto, se marca)."""
    d, h = _fecha(c.get("vigencia_desde")), _fecha(c.get("vigencia_hasta"))
    if d and h:
        return d, h, True
    ini = _fecha(c.get("publicada_en")) or _fecha(c.get("programada_para"))
    return (ini, ini + timedelta(days=VENTANA_SIN_VIGENCIA - 1), False) if ini else None


def tablero(filtros: dict | None) -> dict:
    f = normalizar(filtros)
    store = get_store()
    try:
        meta = meta_warehouse()
    except WarehouseNoDisponible:
        meta = {"version": "", "corte": None, "desde": None, "construido": None}
    clave = {"t": "campanas", "f": f, "st": store.huella(), "wh": meta["version"]}
    return en_cache(clave, lambda: _calcular(f, meta))


def _calcular(f: dict, meta: dict) -> dict:
    store = get_store()
    todas = store.listar()
    camps = []
    for c in todas:
        ref = _referencia(c)
        if f["estados"] and c["estado"] not in f["estados"]:
            continue
        if f["desde"] and (ref is None or ref < date.fromisoformat(f["desde"])):
            continue
        if f["hasta"] and (ref is None or ref > date.fromisoformat(f["hasta"])):
            continue
        camps.append((c, ref))

    lanzadas = [(c, ref) for c, ref in camps if c["estado"] in ("publicada", "programada")]
    dest = store.destinatarios_de([c["id"] for c, _ in lanzadas])
    n_envio = sum(1 for g in dest["grupo"] if g == "envio")
    n_control = len(dest["grupo"]) - n_envio
    unicos = len({cl for cl, g in zip(dest["cliente_id"], dest["grupo"]) if g == "envio"})

    por_estado = Counter(c["estado"] for c, _ in camps)
    costo = sum(float(c.get("costo_estimado") or 0) for c, _ in lanzadas)
    vigencias = [((_fecha(c.get("vigencia_hasta")) - _fecha(c.get("vigencia_desde"))).days + 1) for c, _ in lanzadas
                 if _fecha(c.get("vigencia_desde")) and _fecha(c.get("vigencia_hasta"))]

    # ------------------------------------------------------------------ en el tiempo
    meses: dict[str, dict] = {}
    for c, ref in camps:
        m = meses.setdefault(ref.isoformat()[:7] if ref else "sin fecha", {"mes": ref.isoformat()[:7] if ref else "sin fecha",
                                                                         "borrador": 0, "programada": 0, "publicada": 0,
                                                                         "destinatarios": 0, "costo": 0.0})
        m[c["estado"]] += 1
        if c["estado"] != "borrador":
            m["destinatarios"] += entero(c.get("audiencia"))
            m["costo"] += float(c.get("costo_estimado") or 0)
    por_mes = sorted(meses.values(), key=lambda x: x["mes"])

    # ------------------------------------------------------------------ canales, productos, objetivos
    canales = Counter()
    for ch, g in zip(dest["canales"], dest["grupo"]):
        if g == "envio":
            canales.update(x for x in (ch or "").split(",") if x)
    productos, grupos_prod = Counter(), Counter()
    for c, _ in camps:
        for p in c.get("productos") or []:
            productos[(p.get("producto") or p.get("producto_id") or "?")[:60]] += 1
            if p.get("grupo"):
                grupos_prod[str(p["grupo"])[:40]] += 1
    objetivos = Counter(((c.get("segmentacion") or {}).get("filtros") or {}).get("objetivo") or "equilibrado" for c, _ in camps)
    consent = Counter(((c.get("segmentacion") or {}).get("filtros") or {}).get("consentimiento") or "estricto" for c, _ in camps)
    canales_campana = Counter()
    for c, _ in camps:
        canales_campana.update((c.get("mensaje") or {}).get("canales") or [])
    borradores_paso = Counter(min(4, max(1, entero(c.get("paso")))) for c, _ in camps if c["estado"] == "borrador")

    # ------------------------------------------------------------------ presión de contacto (personas × campañas)
    por_persona = Counter(cl for cl, g in zip(dest["cliente_id"], dest["grupo"]) if g == "envio")
    presion = Counter(min(v, 4) for v in por_persona.values())

    # ------------------------------------------------------------------ cruce con ventas (perfil y efectividad)
    perfil, efect, aviso = None, {}, None
    corte = meta.get("corte")
    if not meta.get("version"):
        aviso = "Aún no hay ventas cargadas del ERP: no se puede medir el perfil ni la efectividad."
    elif dest["cliente_id"]:
        try:
            perfil, efect = _cruce(lanzadas, dest, corte)
        except WarehouseNoDisponible as e:
            aviso = str(e)
        except Exception:
            log.exception("No se pudo cruzar las campañas con las ventas")
            aviso = "No se pudo cruzar las campañas con las ventas del ERP."

    filas = []
    for c, ref in camps:
        v = _ventana(c) if c["estado"] != "borrador" else None
        e = efect.get(c["id"], {})
        env, ctl = e.get("envio", {}), e.get("control", {})
        cobertura = None
        if v and corte:
            cobertura = "sin_datos" if v[0] > corte else ("parcial" if v[1] > corte else "completa")
        tasa_env, tasa_ctl = pct(env.get("compradores_promo"), env.get("n")), pct(ctl.get("compradores_promo"), ctl.get("n"))
        vpp_env = (env.get("venta_promo") or 0) / env["n"] if env.get("n") else None
        vpp_ctl = (ctl.get("venta_promo") or 0) / ctl["n"] if ctl.get("n") else None
        incremental = round((vpp_env - vpp_ctl) * env["n"]) if vpp_env is not None and vpp_ctl is not None else None
        filas.append({
            "id": c["id"], "nombre": c["nombre"], "estado": c["estado"], "fecha": iso(ref), "paso": entero(c.get("paso")),
            "destinatarios": entero(c.get("audiencia")) if c["estado"] != "borrador" else 0,
            "control": entero(ctl.get("n")), "costo": round(float(c.get("costo_estimado") or 0)) if c["estado"] != "borrador" else 0,
            "productos": len(c.get("productos") or []), "canales": (c.get("mensaje") or {}).get("canales") or [],
            "objetivo": OBJETIVOS.get(((c.get("segmentacion") or {}).get("filtros") or {}).get("objetivo") or "equilibrado", ""),
            "ventana_desde": iso(v[0]) if v else None, "ventana_hasta": iso(v[1]) if v else None,
            "vigencia_real": bool(v and v[2]), "cobertura": cobertura,
            "tasa_envio": tasa_env, "tasa_control": tasa_ctl,
            "lift_pp": r2(tasa_env - tasa_ctl, 2) if tasa_env is not None and tasa_ctl is not None else None,
            "venta_promo": round(env.get("venta_promo") or 0) if env else None,
            "venta_por_dest_envio": r2(vpp_env, 0), "venta_por_dest_control": r2(vpp_ctl, 0),
            "incremental": incremental,
            "roi": r2(incremental / float(c["costo_estimado"]), 2) if incremental is not None and float(c.get("costo_estimado") or 0) > 0 else None,
        })
    medidas = [x for x in filas if x["cobertura"] in ("completa", "parcial") and x["tasa_envio"] is not None]

    kpis = {
        "campanas": len(camps), "borradores": por_estado.get("borrador", 0), "programadas": por_estado.get("programada", 0),
        "publicadas": por_estado.get("publicada", 0), "destinatarios": n_envio, "control": n_control, "personas_unicas": unicos,
        "costo": round(costo), "costo_por_contacto": r2(costo / n_envio, 1) if n_envio else None,
        "vigencia_prom": r2(sum(vigencias) / len(vigencias), 1) if vigencias else None,
        "productos_distintos": len(productos),
        "campanas_por_persona": r2(n_envio / unicos, 2) if unicos else None,
        "medidas": len(medidas),
        "tasa_envio": r2(sum(x["tasa_envio"] for x in medidas) / len(medidas), 2) if medidas else None,
        "lift_pp": r2(sum(x["lift_pp"] for x in medidas if x["lift_pp"] is not None) / max(1, sum(1 for x in medidas if x["lift_pp"] is not None)), 2)
        if any(x["lift_pp"] is not None for x in medidas) else None,
        "incremental": sum(x["incremental"] for x in medidas if x["incremental"] is not None) if any(x["incremental"] is not None for x in medidas) else None,
    }
    return {
        "filtros": f, "corte": iso(corte), "aviso": aviso, "kpis": kpis, "por_mes": por_mes,
        "canales": [{"id": k, "n": canales.get(k, 0), "costo_unitario": costos_vigentes()[k]} for k in COSTOS_DEFECTO],
        "canales_campana": [{"id": k, "n": canales_campana.get(k, 0)} for k in COSTOS_DEFECTO],
        "productos": [{"nombre": k, "n": v} for k, v in productos.most_common(12)],
        "categorias": [{"nombre": k, "n": v} for k, v in grupos_prod.most_common(10)],
        "objetivos": [{"id": k, "nombre": OBJETIVOS.get(k, k), "n": v} for k, v in objetivos.most_common()],
        "consentimiento": [{"id": k, "n": v} for k, v in consent.most_common()],
        "borradores_paso": [{"paso": p, "n": borradores_paso.get(p, 0)} for p in (1, 2, 3, 4)],
        "presion": [{"campanas": k, "personas": presion.get(k, 0)} for k in (1, 2, 3, 4)],
        "perfil": perfil, "campanas_tabla": filas,
        # Automatizaciones (envíos simulados por cliente y día) en el mismo periodo.
        "automatizaciones": _automatizaciones(f),
    }


def _automatizaciones(f: dict) -> list[dict]:
    from ..automatizaciones.almacen import get_almacen

    try:
        return get_almacen().por_automatizacion(f["desde"], f["hasta"])
    except Exception:
        log.exception("No se pudieron leer las automatizaciones")
        return []


def _cruce(lanzadas: list, dest: dict, corte: date | None) -> tuple[dict, dict]:
    """Perfil de quienes recibieron (RFM, edad, sexo) y compras durante la ventana de cada campaña."""
    t_dest = pa.table({k: pa.array(v, pa.string()) for k, v in dest.items()})
    prod_c, prod_p, win_c, win_d, win_h = [], [], [], [], []
    for c, _ in lanzadas:
        for p in c.get("productos") or []:
            if p.get("producto_id"):
                prod_c.append(c["id"])
                prod_p.append(str(p["producto_id"]))
        v = _ventana(c)
        if v:
            win_c.append(c["id"])
            win_d.append(v[0])
            win_h.append(v[1])
    t_prod = pa.table({"campana_id": pa.array(prod_c, pa.string()), "producto_id": pa.array(prod_p, pa.string())})
    t_win = pa.table({"campana_id": pa.array(win_c, pa.string()), "desde": pa.array(win_d, pa.date32()),
                      "hasta": pa.array(win_h, pa.date32())})
    corte = corte or date.today()
    consultas = {
        "rfm": ("""SELECT COALESCE(r.segmento_rfm, 'sin_compras') AS id, COUNT(DISTINCT d.cliente_id) AS n
                   FROM dest d LEFT JOIN cli_rfm r USING (cliente_id) WHERE d.grupo = 'envio' GROUP BY 1 ORDER BY n DESC""", []),
        "edad_sexo": ("""SELECT CASE WHEN c.edad IS NULL THEN 'sin_dato' WHEN c.edad < 25 THEN '18-24' WHEN c.edad < 35 THEN '25-34'
                          WHEN c.edad < 45 THEN '35-44' WHEN c.edad < 55 THEN '45-54' WHEN c.edad < 65 THEN '55-64' ELSE '65+' END AS edad,
                          COALESCE(c.sexo, 'N') AS sexo, COUNT(DISTINCT d.cliente_id) AS n
                         FROM dest d LEFT JOIN cliente c USING (cliente_id) WHERE d.grupo = 'envio' GROUP BY 1, 2""", []),
        "efectividad": ("""WITH w AS (SELECT campana_id, desde, LEAST(hasta, ?::DATE) AS hasta FROM ventana WHERE desde <= ?::DATE),
                             dd AS (SELECT DISTINCT d.campana_id, d.cliente_id, d.grupo FROM dest d JOIN w USING (campana_id)),
                             c AS (SELECT dd.campana_id, dd.cliente_id, SUM(v.venta_neta) AS total,
                                          SUM(v.venta_neta) FILTER (WHERE p.producto_id IS NOT NULL) AS promo
                                   FROM dd JOIN w USING (campana_id)
                                   JOIN venta v ON v.cliente_id = dd.cliente_id AND v.fecha BETWEEN w.desde AND w.hasta
                                   LEFT JOIN prod p ON p.campana_id = dd.campana_id AND p.producto_id = v.producto_id
                                   GROUP BY 1, 2)
                           SELECT dd.campana_id, dd.grupo, COUNT(*) AS n,
                                  COUNT(*) FILTER (WHERE c.promo > 0) AS compradores_promo,
                                  COUNT(*) FILTER (WHERE c.total > 0) AS compradores,
                                  SUM(COALESCE(c.promo, 0)) AS venta_promo, SUM(COALESCE(c.total, 0)) AS venta_total
                           FROM dd LEFT JOIN c USING (campana_id, cliente_id) GROUP BY 1, 2""", [corte, corte]),
    }
    r = get_warehouse().consultar_con({"dest": t_dest, "prod": t_prod, "ventana": t_win}, consultas)
    efect: dict[str, dict] = {}
    for x in r["efectividad"]:
        efect.setdefault(x["campana_id"], {})[x["grupo"]] = {
            "n": entero(x["n"]), "compradores_promo": entero(x["compradores_promo"]), "compradores": entero(x["compradores"]),
            "venta_promo": float(x["venta_promo"] or 0), "venta_total": float(x["venta_total"] or 0)}
    perfil = {"rfm": [{"id": x["id"], "nombre": SEGMENTOS_RFM.get(x["id"], "Sin compras" if x["id"] == "sin_compras" else x["id"]),
                       "n": entero(x["n"])} for x in r["rfm"]],
              "edad_sexo": r["edad_sexo"]}
    return perfil, efect
