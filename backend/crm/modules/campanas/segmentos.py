"""Segmentación de clientes para campañas.

Combina varias técnicas (no solo las básicas), todas calculadas sobre el historial real del ERP:

1. **RFM** (recencia, frecuencia, valor) en quintiles → 10 segmentos de negocio (campeones, leales, en riesgo…).
2. **Ciclo de recompra personal**: compara los días sin comprar con el intervalo *propio* de cada cliente. Quien está
   en su «ventana de recompra» responde mejor que quien compró ayer o ya se perdió.
3. **Afinidad de producto/categoría/marca** con *noisy-OR*: combina la evidencia «compró este producto», «gasta mucho
   en este grupo/familia» y «prefiere esta marca» como probabilidades independientes.
4. **Estacionalidad individual**: ¿este cliente compra en los meses de la temporada?
5. **Sensibilidad al descuento** (terciles del % de descuento histórico) y **valor** (M del RFM).
6. **Hábitos**: día de la semana y franja horaria preferidos, quincena.
7. **Demografía** (sexo, edad), **clubes** del POS y **ciudad**.
8. **Contactabilidad y consentimiento**: celular válido para WhatsApp/SMS, correo válido, autorización de datos
   (Ley 1581), exclusión de quien ya recibió una campaña reciente, y exclusión de menores si hay licor/cigarrillos.
9. **Puntaje de propensión (0-100)** = combinación ponderada y explicable de lo anterior, con pesos según el objetivo.
10. **Curva de concentración (Pareto)**: muestra cuánto del «potencial» se captura con cada porcentaje de la audiencia,
    para decidir el corte óptimo según el costo por mensaje y no gastar en quien casi no responderá.

Honestidad metodológica: el puntaje es un modelo heurístico explicable. Cuando se registren respuestas reales
(conversiones por campaña) se debe reemplazar por un modelo supervisado (regresión logística / gradient boosting)
y calibrar probabilidades. Ver README, sección «Roadmap de segmentación».
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import date

from ...warehouse import Warehouse

log = logging.getLogger("crm.campanas.segmentos")

SEGMENTOS_RFM = {
    "campeones": "Campeones", "leales": "Leales", "potenciales": "Potenciales leales", "nuevos": "Nuevos",
    "prometedores": "Prometedores", "atencion": "Necesitan atención", "no_perder": "No se pueden perder",
    "en_riesgo": "En riesgo", "hibernando": "Hibernando", "perdidos": "Perdidos",
}
CICLOS = {"adelantado": "Compró hace poco", "en_ventana": "En su ventana de recompra", "atrasado": "Atrasado en su ciclo",
          "inactivo": "Inactivo", "sin_historial": "Sin historial suficiente"}
BANDAS_EDAD = ("18-24", "25-34", "35-44", "45-54", "55-64", "65+", "sin_dato", "menor")
CLUBS = {"vino": "club_vino", "salud": "club_salud", "mascotas": "club_mascotas", "parrilla": "club_parrilla"}
OBJETIVOS = {
    "equilibrado": "Equilibrado", "rotar_inventario": "Rotar inventario (promoción)",
    "premium": "Clientes de alto valor", "reactivar": "Reactivar clientes dormidos",
}
COSTOS_DEFECTO = {"whatsapp": 120.0, "sms": 45.0, "email": 3.0}   # COP por mensaje: SUPUESTO editable, validar con el proveedor
CANALES = tuple(COSTOS_DEFECTO)

# Pesos del puntaje por objetivo: afinidad, momento (ciclo), valor, recencia, estacionalidad, descuento.
_PESOS = {
    "equilibrado":      dict(af=.40, mo=.20, va=.15, re=.15, es=.10, de=0.0),
    "rotar_inventario": dict(af=.30, mo=.15, va=.05, re=.15, es=.10, de=.25),
    "premium":          dict(af=.35, mo=.15, va=.30, re=.10, es=.10, de=0.0),
    "reactivar":        dict(af=.30, mo=.40, va=.15, re=.05, es=.10, de=0.0),
}
# Qué tan «a tiempo» está un cliente según su ciclo. En «reactivar» se invierte: interesan los atrasados.
_MOMENTO = {
    "normal":    {"en_ventana": 1.0, "atrasado": .70, "adelantado": .45, "sin_historial": .45, "inactivo": .20},
    "reactivar": {"atrasado": 1.0, "inactivo": .75, "en_ventana": .55, "sin_historial": .35, "adelantado": .10},
}

_ALCOHOL = re.compile(r"licor|aguardiente|ron\b|whisky|whiskey|vodka|tequila|ginebra|cerveza|vino|espumoso|champ|brandy|cognac|"
                      r"cigarr|tabaco", re.I)


def productos_restringidos(productos: list[dict]) -> list[str]:
    """Nombres de productos con venta restringida a mayores de edad (licor, cerveza, vino, cigarrillos)."""
    out = []
    for p in productos:
        texto = f"{p.get('producto', '')} {p.get('familia', '')} {p.get('departamento', '')} {p.get('grupo', '')} {p.get('tipo_producto', '')}"
        if _ALCOHOL.search(texto):
            out.append(p.get("producto", ""))
    return out


# ---------------------------------------------------------------------------- enmascarado de datos personales
def _mask_nombre(n: str | None) -> str:
    toks = [t for t in re.split(r"\s+", (n or "").strip()) if t][:2]
    return " ".join(t[0].upper() + "***" for t in toks) or "—"


def _mask_cel(c: str | None) -> str:
    return f"*** *** {c[-4:]}" if c else "—"


def _mask_mail(e: str | None) -> str:
    if not e or "@" not in e:
        return "—"
    u, d = e.split("@", 1)
    return f"{u[:1]}***@{d}"


# ---------------------------------------------------------------------------- consulta de audiencia
def _lista(v) -> list:
    return list(v) if isinstance(v, (list, tuple, set)) else []


def _ints(v, lo: int, hi: int) -> list[int]:
    out = []
    for x in _lista(v):
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if lo <= n <= hi:
            out.append(n)
    return out


def _validos(v, permitidos) -> list[str]:
    return [str(x) for x in _lista(v) if str(x) in permitidos]


def normalizar(f: dict) -> dict:
    """Limpia y valida los filtros (todo lo desconocido se descarta)."""
    f = f or {}
    try:
        minimo = max(0, min(100, int(f.get("afinidad_minima") or 0)))
    except (TypeError, ValueError):
        minimo = 0
    obj = f.get("objetivo")
    objetivo = obj if isinstance(obj, str) and obj in OBJETIVOS else "equilibrado"
    ciudades = [str(c)[:60] for c in _lista(f.get("ciudades"))][:50]
    costos = dict(COSTOS_DEFECTO)
    for k, v in (f.get("costos") if isinstance(f.get("costos"), dict) else {}).items():
        if k in costos:
            try:
                costos[k] = max(0.0, min(5000.0, float(v)))
            except (TypeError, ValueError):
                pass
    tope = f.get("tope_contactos")
    try:
        tope = int(tope) if tope not in (None, "", 0) else None
        tope = max(1, min(tope, 1_000_000)) if tope else None
    except (TypeError, ValueError):
        tope = None
    return {
        "productos": [str(p) for p in _lista(f.get("productos"))][:500],
        "canales": _validos(f.get("canales"), CANALES) or list(CANALES),
        "segmentos_rfm": _validos(f.get("segmentos_rfm"), SEGMENTOS_RFM),
        "ciclo": _validos(f.get("ciclo"), CICLOS),
        "sexo": _validos(f.get("sexo"), ("F", "M", "N")),
        "edades": _validos(f.get("edades"), BANDAS_EDAD),
        "clubs": _validos(f.get("clubs"), CLUBS),
        "afinidad_requerida": _validos(f.get("afinidad_requerida"), ("producto", "grupo", "familia", "marca")),
        "afinidad_minima": minimo,
        "valor": _validos(f.get("valor"), ("alto", "medio", "bajo")),
        "descuento": _validos(f.get("descuento"), ("alta", "media", "baja")),
        "dias_pref": _ints(f.get("dias_pref"), 1, 7),
        "franjas": _validos(f.get("franjas"), ("mañana", "tarde", "noche")),
        "ciudades": ciudades,
        "min_visitas": max(0, min(int(f.get("min_visitas") or 0), 1000)) if str(f.get("min_visitas") or "0").isdigit() else 0,
        "max_dias_sin_compra": int(f["max_dias_sin_compra"]) if str(f.get("max_dias_sin_compra") or "").isdigit() else None,
        "meses_temporada": _ints(f.get("meses_temporada"), 1, 12),
        "solo_compran_temporada": bool(f.get("solo_compran_temporada")),
        "consentimiento": "incluir_sin_registro" if f.get("consentimiento") == "incluir_sin_registro" else "estricto",
        "excluir_contactados_dias": max(0, min(int(f.get("excluir_contactados_dias") or 0), 365)) if str(f.get("excluir_contactados_dias") or "0").isdigit() else 0,
        "objetivo": objetivo,
        "tope_contactos": tope,
        "costos": costos,
    }


_EDAD_SQL = """CASE WHEN c.edad IS NULL THEN 'sin_dato' WHEN c.edad < 18 THEN 'menor' WHEN c.edad < 25 THEN '18-24'
 WHEN c.edad < 35 THEN '25-34' WHEN c.edad < 45 THEN '35-44' WHEN c.edad < 55 THEN '45-54' WHEN c.edad < 65 THEN '55-64' ELSE '65+' END"""


def _consulta(f: dict, restringido: bool, excluidos: list[str]) -> tuple[str, list]:
    """SQL único que calcula las características y el puntaje de cada cliente y aplica los filtros."""
    params: list = []
    ids = f["productos"]
    pesos = _PESOS[f["objetivo"]]
    momento = _MOMENTO["reactivar" if f["objetivo"] == "reactivar" else "normal"]
    mom_sql = "CASE estado_ciclo " + " ".join(f"WHEN '{k}' THEN {v}" for k, v in momento.items()) + " ELSE 0.4 END"
    usa_est = bool(f["meses_temporada"])
    w = dict(pesos)
    if not usa_est:                      # sin temporada, su peso se reparte en afinidad
        w["af"] += w["es"]
        w["es"] = 0.0

    ctes = ["sel AS (SELECT * FROM producto WHERE list_contains(?::VARCHAR[], producto_id))"]
    params.append(ids)
    ctes += [
        "aff_p AS (SELECT cp.cliente_id, SUM(cp.compras) AS compras_prod, MAX(cp.ultima) AS ultima_prod, "
        "SUM(cp.unidades) AS uds_prod FROM cli_producto cp JOIN sel USING (producto_id) GROUP BY 1)",
        "aff_g AS (SELECT cliente_id, SUM(venta) AS v FROM cli_nivel WHERE nivel = 'grupo' "
        "AND codigo IN (SELECT grupo_id FROM sel) GROUP BY 1)",
        "aff_f AS (SELECT cliente_id, SUM(venta) AS v FROM cli_nivel WHERE nivel = 'familia' "
        "AND codigo IN (SELECT familia_id FROM sel) GROUP BY 1)",
        "aff_m AS (SELECT cliente_id, SUM(venta) AS v FROM cli_marca WHERE marca IN (SELECT marca FROM sel) GROUP BY 1)",
    ]
    if usa_est:
        ctes.append("est AS (SELECT cliente_id, SUM(visitas) AS v FROM cli_mes WHERE list_contains(?::INTEGER[], mes) GROUP BY 1)")
        params.append(f["meses_temporada"])
    else:
        ctes.append("est AS (SELECT NULL::VARCHAR AS cliente_id, 0::BIGINT AS v WHERE FALSE)")

    base = f"""
    base AS (
      SELECT c.cliente_id, c.nombre, c.email, c.celular, c.email_valido, c.sexo, c.edad, c.ciudad, c.autoriza_datos,
             c.club_vino, c.club_salud, c.club_mascotas, c.club_parrilla,
             {_EDAD_SQL} AS banda_edad,
             rf.segmento_rfm, rf.estado_ciclo, rf.dias_sin_compra, rf.r, rf.f, rf.m, rf.sens_desc, rf.ratio_ciclo,
             p.visitas, p.venta_total, p.ticket_prom, p.intervalo_dias, p.dia_semana_pref, p.franja_pref,
             COALESCE(ap.compras_prod, 0) AS compras_prod, ap.ultima_prod,
             COALESCE(ag.v, 0) / NULLIF(p.venta_total, 0) AS share_g,
             COALESCE(af.v, 0) / NULLIF(p.venta_total, 0) AS share_f,
             COALESCE(am.v, 0) / NULLIF(p.venta_total, 0) AS share_m,
             COALESCE(e.v, 0) AS visitas_temporada
      FROM cliente c
      JOIN cli_rfm rf USING (cliente_id)
      JOIN cli_perfil p USING (cliente_id)
      LEFT JOIN aff_p ap USING (cliente_id)
      LEFT JOIN aff_g ag USING (cliente_id)
      LEFT JOIN aff_f af USING (cliente_id)
      LEFT JOIN aff_m am USING (cliente_id)
      LEFT JOIN est e USING (cliente_id)
      WHERE NOT c.bloqueado
    ),
    punt AS (
      SELECT *,
        LEAST(1.0, 0.55 + 0.15 * compras_prod) * (compras_prod > 0)::INT AS a_prod,
        LEAST(1.0, 2.5 * GREATEST(COALESCE(share_g, 0), 0.7 * COALESCE(share_f, 0))) AS a_cat,
        LEAST(1.0, 3.0 * COALESCE(share_m, 0)) AS a_marca
      FROM base
    ),
    fin AS (
      SELECT *,
        100 * (1 - (1 - 0.9 * a_prod) * (1 - 0.8 * a_cat) * (1 - 0.5 * a_marca)) AS afinidad,
        {mom_sql} AS s_momento,
        ((0.6 * m + 0.4 * f) - 1) / 4.0 AS s_valor,
        (r - 1) / 4.0 AS s_rec,
        LEAST(1.0, visitas_temporada / 2.0) AS s_est,
        (sens_desc - 1) / 2.0 AS s_desc
      FROM punt
    ),
    score AS (
      SELECT *, ROUND(LEAST(100, GREATEST(0, {w['af']} * afinidad + 100 * ({w['mo']} * s_momento + {w['va']} * s_valor
               + {w['re']} * s_rec + {w['es']} * s_est + {w['de']} * s_desc))), 1) AS puntaje
      FROM fin
    )
    """
    where = ["TRUE"]
    # Consentimiento (Ley 1581): estricto = solo quien autorizó; el resto de los datos nunca se asume.
    where.append("autoriza_datos IS TRUE" if f["consentimiento"] == "estricto" else "autoriza_datos IS NOT FALSE")
    cond_canal = []
    if "whatsapp" in f["canales"] or "sms" in f["canales"]:
        cond_canal.append("celular IS NOT NULL")
    if "email" in f["canales"]:
        cond_canal.append("email_valido")
    where.append("(" + " OR ".join(cond_canal) + ")")
    if restringido:
        where.append("edad >= 18")
    if f["segmentos_rfm"]:
        where.append("list_contains(?::VARCHAR[], segmento_rfm)")
        params.append(f["segmentos_rfm"])
    if f["ciclo"]:
        where.append("list_contains(?::VARCHAR[], estado_ciclo)")
        params.append(f["ciclo"])
    if f["sexo"]:
        where.append("list_contains(?::VARCHAR[], COALESCE(sexo, 'N'))")
        params.append(f["sexo"])
    if f["edades"]:
        where.append("list_contains(?::VARCHAR[], banda_edad)")
        params.append(f["edades"])
    if f["clubs"]:
        where.append("(" + " OR ".join(CLUBS[k] for k in f["clubs"]) + ")")   # nombres de columna de una lista blanca
    if f["afinidad_requerida"]:
        mapa = {"producto": "compras_prod > 0", "grupo": "COALESCE(share_g, 0) > 0",
                "familia": "COALESCE(share_f, 0) > 0", "marca": "COALESCE(share_m, 0) > 0"}
        where.append("(" + " OR ".join(mapa[k] for k in f["afinidad_requerida"]) + ")")
    if f["afinidad_minima"]:
        where.append("puntaje >= ?")
        params.append(f["afinidad_minima"])
    if f["valor"]:
        where.append("list_contains(?::VARCHAR[], CASE WHEN m >= 4 THEN 'alto' WHEN m = 3 THEN 'medio' ELSE 'bajo' END)")
        params.append(f["valor"])
    if f["descuento"]:
        where.append("list_contains(?::VARCHAR[], CASE sens_desc WHEN 3 THEN 'alta' WHEN 2 THEN 'media' ELSE 'baja' END)")
        params.append(f["descuento"])
    if f["dias_pref"]:
        where.append("list_contains(?::INTEGER[], dia_semana_pref)")
        params.append(f["dias_pref"])
    if f["franjas"]:
        where.append("list_contains(?::VARCHAR[], franja_pref)")
        params.append(f["franjas"])
    if f["ciudades"]:
        where.append("list_contains(?::VARCHAR[], upper(ciudad))")
        params.append([c.upper() for c in f["ciudades"]])
    if f["min_visitas"]:
        where.append("visitas >= ?")
        params.append(f["min_visitas"])
    if f["max_dias_sin_compra"] is not None:
        where.append("dias_sin_compra <= ?")
        params.append(f["max_dias_sin_compra"])
    if f["solo_compran_temporada"] and usa_est:
        where.append("visitas_temporada > 0")
    if excluidos:
        where.append("NOT list_contains(?::VARCHAR[], cliente_id)")
        params.append(excluidos)
    sql = ("WITH " + ",\n".join(ctes) + ",\n" + base +
           "SELECT cliente_id, nombre, email, celular, email_valido, sexo, banda_edad, ciudad, segmento_rfm, estado_ciclo, "
           "dias_sin_compra, visitas, venta_total, ticket_prom, compras_prod, ultima_prod, share_g, share_m, afinidad, puntaje, "
           "dia_semana_pref, franja_pref, sens_desc, m "
           "FROM score WHERE " + " AND ".join(where) + " ORDER BY puntaje DESC, cliente_id")
    return sql, params


def calcular(wh: Warehouse, filtros: dict, restringido: bool = False, excluidos: set[str] | None = None) -> tuple[dict, list[tuple]]:
    """Devuelve (filtros normalizados, filas ordenadas por puntaje desc)."""
    f = normalizar(filtros)
    if not f["productos"]:
        raise ValueError("Seleccione al menos un producto antes de segmentar.")
    sql, params = _consulta(f, restringido, sorted(excluidos or []))
    cols, rows = wh.tuples(sql, params)
    f["_cols"] = cols
    return f, rows


def _fila(cols: list[str], r: tuple) -> dict:
    return dict(zip(cols, r))


def _canales_de(d: dict, canales: list[str]) -> list[str]:
    out = []
    if d["celular"]:
        out += [c for c in ("whatsapp", "sms") if c in canales]
    if d["email_valido"] and "email" in canales:
        out.append("email")
    return out


def _motivos(d: dict) -> list[str]:
    m = []
    if d["compras_prod"]:
        m.append(f"Compró estos productos {int(d['compras_prod'])} vez(es)" + (f" (última: {d['ultima_prod']})" if d["ultima_prod"] else ""))
    if d["share_g"] and d["share_g"] >= 0.1:
        m.append(f"Destina {d['share_g'] * 100:.0f}% de su gasto a la misma categoría")
    if d["share_m"] and d["share_m"] >= 0.1:
        m.append(f"Prefiere la marca ({d['share_m'] * 100:.0f}% de su gasto)")
    if d["estado_ciclo"] == "en_ventana":
        m.append("Está en su ventana habitual de recompra")
    elif d["estado_ciclo"] == "atrasado":
        m.append("Lleva más tiempo del habitual sin comprar")
    m.append(SEGMENTOS_RFM.get(d["segmento_rfm"], d["segmento_rfm"]))
    return m[:4]


def momento_de_compra(dias: Counter, franjas: Counter) -> dict:
    """Cuándo suele comprar la audiencia (día ISO 1=lunes y franja): base para sugerir el día y la hora de envío."""
    return {
        "dias": [{"id": d, "n": dias.get(d, 0)} for d in range(1, 8)],
        "franjas": [{"id": k, "n": franjas.get(k, 0)} for k in ("mañana", "tarde", "noche")],
        "mejor_dia": dias.most_common(1)[0][0] if dias else None,
        "mejor_franja": franjas.most_common(1)[0][0] if franjas else None,
    }


def resumen(cols: list[str], rows: list[tuple], f: dict, total_base: int) -> dict:
    """Agregados de la audiencia: alcance por canal, costos, composición y curva de concentración."""
    canales = f["canales"]
    costos = f["costos"]
    tope = f["tope_contactos"]
    n_total = len(rows)
    sel = rows[:tope] if tope else rows
    ci = {c: i for i, c in enumerate(cols)}

    por_canal = Counter()
    seg, sexo, edad, ciclo, ciud = Counter(), Counter(), Counter(), Counter(), Counter()
    dias, franjas = Counter(), Counter()
    costo = 0.0
    puntajes = []
    i_dia, i_fr = ci.get("dia_semana_pref"), ci.get("franja_pref")
    for r in sel:
        if i_dia is not None and r[i_dia]:
            dias[int(r[i_dia])] += 1
        if i_fr is not None and r[i_fr]:
            franjas[r[i_fr]] += 1
        cel, mail = r[ci["celular"]], r[ci["email_valido"]]
        chs = (["whatsapp", "sms"] if cel else []) + (["email"] if mail else [])
        chs = [c for c in chs if c in canales]
        for c in chs:
            por_canal[c] += 1
        # Costo: cada cliente con celular recibe por WhatsApp si está elegido y, si no, por SMS (no se duplica el gasto).
        usa = "whatsapp" if ("whatsapp" in chs) else ("sms" if "sms" in chs else None)
        if usa:
            costo += costos[usa]
        if "email" in chs:
            costo += costos["email"]
        seg[r[ci["segmento_rfm"]]] += 1
        sexo[r[ci["sexo"]] or "N"] += 1
        edad[r[ci["banda_edad"]]] += 1
        ciclo[r[ci["estado_ciclo"]]] += 1
        ciud[(r[ci["ciudad"]] or "SIN CIUDAD").upper()] += 1
        puntajes.append(r[ci["puntaje"]])

    # Curva de concentración sobre TODA la audiencia candidata (antes del tope) para recomendar el corte.
    # «Potencial relativo» = (puntaje/100)^3: la respuesta real se concentra en los mejores candidatos (típicamente el
    # decil superior responde varias veces más que el inferior), así que el puntaje se pondera de forma convexa.
    todos = [r[ci["puntaje"]] for r in rows]
    suma = sum((p / 100) ** 3 for p in todos) or 1.0
    curva, acum = [], 0.0
    paso = max(1, n_total // 20)
    for i, p in enumerate(todos, 1):
        acum += (p / 100) ** 3
        if i % paso == 0 or i == n_total:
            curva.append({"pct_audiencia": round(100 * i / n_total, 1), "pct_potencial": round(100 * acum / suma, 1),
                          "contactos": i, "puntaje_corte": p})
    corte = next((c for c in curva if c["pct_potencial"] >= 80), curva[-1] if curva else None)
    return {
        "base_clientes": total_base, "audiencia_candidata": n_total, "audiencia": len(sel),
        "por_canal": {c: por_canal.get(c, 0) for c in CANALES if c in canales},
        "costo_estimado": round(costo), "costo_por_contacto": round(costo / len(sel), 1) if sel else 0,
        "puntaje_promedio": round(sum(puntajes) / len(puntajes), 1) if puntajes else 0,
        "segmentos_rfm": [{"id": k, "nombre": SEGMENTOS_RFM.get(k, k), "n": v} for k, v in seg.most_common()],
        "sexo": [{"id": k, "n": v} for k, v in sexo.most_common()],
        "edades": [{"id": k, "n": edad.get(k, 0)} for k in BANDAS_EDAD if edad.get(k)],
        "ciclo": [{"id": k, "nombre": CICLOS.get(k, k), "n": v} for k, v in ciclo.most_common()],
        "ciudades": [{"id": k, "n": v} for k, v in ciud.most_common(8)],
        "momento": momento_de_compra(dias, franjas),
        "curva": curva,
        "corte_recomendado": ({"contactos": corte["contactos"], "pct_audiencia": corte["pct_audiencia"],
                               "pct_potencial": corte["pct_potencial"], "puntaje_minimo": corte["puntaje_corte"]} if corte else None),
    }


def muestra(cols: list[str], rows: list[tuple], canales: list[str], n: int = 25) -> list[dict]:
    """Primeros clientes del ranking con datos personales ENMASCARADOS y el porqué de su puntaje."""
    out = []
    for r in rows[:n]:
        d = _fila(cols, r)
        out.append({"cliente": _mask_nombre(d["nombre"]), "celular": _mask_cel(d["celular"]), "correo": _mask_mail(d["email"]),
                    "puntaje": d["puntaje"], "afinidad": round(d["afinidad"], 0), "segmento": SEGMENTOS_RFM.get(d["segmento_rfm"], d["segmento_rfm"]),
                    "canales": _canales_de(d, canales), "motivos": _motivos(d)})
    return out


def destinatarios(cols: list[str], rows: list[tuple], f: dict) -> list[tuple[str, str]]:
    sel = rows[: f["tope_contactos"]] if f["tope_contactos"] else rows
    out = []
    for r in sel:
        d = _fila(cols, r)
        chs = _canales_de(d, f["canales"])
        if chs:
            out.append((d["cliente_id"], ",".join(chs)))
    return out


# ---------------------------------------------------------------------------- perfil del comprador ideal (lookalike)
def perfil_ideal(wh: Warehouse, productos: list[str], meses_temporada: list[int]) -> dict:
    """¿Quién compra estos productos? Compara el perfil de sus compradores con el de toda la base.
    Un valor con *lift* alto (p. ej. 1.8×) está sobrerrepresentado entre los compradores → candidato a filtro."""
    f = normalizar({"productos": productos, "consentimiento": "incluir_sin_registro", "meses_temporada": meses_temporada,
                    "canales": list(CANALES)})
    sql, params = _consulta(f, False, [])
    cols, rows = wh.tuples(sql, params)
    ci = {c: i for i, c in enumerate(cols)}
    base_n = wh.scalar("SELECT COUNT(*) FROM cli_perfil") or 1
    compradores = [r for r in rows if r[ci["compras_prod"]] and r[ci["compras_prod"]] > 0]
    cohorte = "compradores"
    if len(compradores) < 30:  # casi nadie compró estos SKU: se usa afinidad por categoría
        compradores = [r for r in rows if (r[ci["share_g"]] or 0) >= 0.05]
        cohorte = "afines_categoria"
    n = len(compradores)
    if n == 0:
        return {"cohorte": cohorte, "n": 0, "dimensiones": {}, "recomendado": {}}

    def dist(col: str, vacio: str = "N"):
        c = Counter((r[ci[col]] if r[ci[col]] is not None else vacio) for r in compradores)
        return c

    def dist_base(sql_expr: str) -> dict:
        return {k: v for k, v in wh.tuples(f"SELECT {sql_expr} AS k, COUNT(*) FROM cliente c JOIN cli_rfm rf USING (cliente_id) JOIN cli_perfil p USING (cliente_id) GROUP BY 1")[1]}

    dims = {}
    for nombre, col, expr, vacio in (("sexo", "sexo", "COALESCE(c.sexo, 'N')", "N"),
                                       ("edades", "banda_edad", _EDAD_SQL, "sin_dato"),
                                       ("segmentos_rfm", "segmento_rfm", "rf.segmento_rfm", "hibernando"),
                                       ("ciclo", "estado_ciclo", "rf.estado_ciclo", "sin_historial"),
                                       ("dias_pref", "dia_semana_pref", "p.dia_semana_pref", 0),
                                       ("franjas", "franja_pref", "p.franja_pref", "tarde")):
        c = dist(col, vacio)
        b = dist_base(expr)
        tb = sum(b.values()) or 1
        dims[nombre] = sorted(
            [{"valor": k, "pct": round(100 * v / n, 1), "base_pct": round(100 * b.get(k, 0) / tb, 1),
              "lift": round((v / n) / max(b.get(k, 0) / tb, 1e-9), 2)} for k, v in c.items() if k not in (None, 0, "sin_dato")],
            key=lambda x: -x["pct"])
    club_pct = {}
    # Clubes: se leen del modelo (no están en la consulta de puntaje)
    ids = [r[ci["cliente_id"]] for r in compradores][:20000]
    cl = wh.tuples("SELECT SUM(club_vino::INT), SUM(club_salud::INT), SUM(club_mascotas::INT), SUM(club_parrilla::INT) "
                   "FROM cliente WHERE list_contains(?::VARCHAR[], cliente_id)", [ids])[1][0]
    clb = wh.tuples("SELECT SUM(club_vino::INT), SUM(club_salud::INT), SUM(club_mascotas::INT), SUM(club_parrilla::INT), COUNT(*) FROM cliente c JOIN cli_perfil USING (cliente_id)")[1][0]
    for (k, _), a, b in zip(CLUBS.items(), cl, clb[:4]):
        pa = (a or 0) / max(len(ids), 1)
        pb = (b or 0) / max(clb[4], 1)
        club_pct[k] = {"pct": round(100 * pa, 1), "base_pct": round(100 * pb, 1), "lift": round(pa / max(pb, 1e-9), 2)}
    dims["clubs"] = club_pct

    # Recomendación basada en datos: valores con lift ≥ 1.25 y al menos 8 % de los compradores.
    rec: dict = {}
    for nombre in ("sexo", "edades", "segmentos_rfm", "ciclo", "franjas"):
        elegidos = [x["valor"] for x in dims[nombre] if x["lift"] >= 1.25 and x["pct"] >= 8]
        if elegidos and len(elegidos) < len(dims[nombre]):
            rec[nombre if nombre != "franjas" else "franjas"] = elegidos
    dd = [int(x["valor"]) for x in dims["dias_pref"] if x["lift"] >= 1.25 and x["pct"] >= 12]
    if dd and len(dd) < 5:
        rec["dias_pref"] = dd
    cl_rec = [k for k, v in club_pct.items() if v["lift"] >= 1.5 and v["pct"] >= 8]
    if cl_rec:
        rec["clubs"] = cl_rec
    return {"cohorte": cohorte, "n": n, "base": int(base_n), "dimensiones": dims, "recomendado": rec}
