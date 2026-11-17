"""Consultas de la lista, los indicadores, la calidad de datos y los duplicados (sobre el índice en memoria).

Todo filtro llega validado (listas blancas) y todo valor viaja como parámetro: no se arma SQL con texto del usuario.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .indice import get_indice
from .mapeo import norm_busqueda

ORDENES = {"nombre": "nombres || ' ' || apellidos", "ventaTotal": "venta_total", "ultimaCompra": "ultima_compra",
           "completitud": "completitud", "visitas": "visitas", "creado": "creado"}
SEGMENTOS = ("campeones", "leales", "potenciales", "nuevos", "prometedores", "atencion", "no_perder", "en_riesgo", "hibernando",
             "perdidos", "sin_compras")
PROBLEMAS = {
    "sin_celular": "NOT cel_ok",
    "sin_email": "NOT email_ok",
    "sin_consentimiento": "consentimiento = 'sin_registro'",
    "sin_nacimiento": "nac IS NULL AND cumple IS NULL",
    "sin_ubicacion": "(ciudad_id = '' OR barrio_id = '')",
    "nombre_corto": "(length(trim(nombres)) < 2 OR length(trim(apellidos)) < 2 OR regexp_matches(nombres || apellidos, '[0-9]'))",
}
_COLS_LISTA = ("id, tarjeta, documento, tipo_doc, nombres, apellidos, celular, email, cel_ok, email_ok, consentimiento, estado, "
               "segmento, ultima_compra, venta_total, visitas, clubes, n_mascotas, completitud, ciudad_id, editable, fusionado_en, etiquetas")


def _lista(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        v = v.split(",")
    return [str(x).strip() for x in v if str(x).strip()]


def _where(f: dict) -> tuple[list[str], list]:
    w, p = [], []
    est = [e for e in _lista(f.get("estado")) if e in ("activo", "inactivo", "anonimizado")]
    if est:
        w.append(f"estado IN ({','.join('?' * len(est))})")
        p += est
    q = (f.get("q") or "").strip()
    if q:
        dig = re.sub(r"\D", "", q)
        if "@" in q:
            w.append("email LIKE ?")
            p.append(f"%{q.lower()}%")
        elif dig and len(dig) >= 4 and len(dig) == len(re.sub(r"[\s.\-]", "", q)):
            w.append("(documento LIKE ? OR tarjeta LIKE ? OR celular LIKE ?)")
            p += [f"{dig}%", f"%{dig}%", f"%{dig}%"]
        else:
            for tok in norm_busqueda(q).split()[:6]:
                w.append("(busca LIKE ? OR mascota_nombres LIKE ?)")
                p += [f"%{tok}%", f"%{tok}%"]
    seg = [s for s in _lista(f.get("segmentos")) if s in SEGMENTOS]
    if seg:
        w.append(f"segmento IN ({','.join('?' * len(seg))})")
        p += seg
    con = [c for c in _lista(f.get("consentimiento")) if c in ("si", "no", "sin_registro")]
    if con:
        w.append(f"consentimiento IN ({','.join('?' * len(con))})")
        p += con
    club = (f.get("club") or "").strip()
    if club.isdigit():
        w.append("list_contains(string_split(clubes, ','), ?)")
        p.append(club)
    masc = (f.get("mascota") or "").strip()
    if re.fullmatch(r"\d{2}", masc):
        w.append("list_contains(string_split(mascota_tipos, ','), ?)")
        p.append(masc)
    elif masc == "con":
        w.append("n_mascotas > 0")
    ciudad = (f.get("ciudad") or "").strip()
    if re.fullmatch(r"\d{5}", ciudad):
        w.append("ciudad_id = ?")
        p.append(ciudad)
    etq = (f.get("etiqueta") or "").strip()
    if etq:
        w.append("list_contains(string_split(etiquetas, '|'), ?)")
        p.append(etq)
    try:
        cmax = int(f.get("completitudMax") or 100)
    except ValueError:
        cmax = 100
    if cmax < 100:
        w.append("completitud <= ?")
        p.append(cmax)
    prob = f.get("problema") or ""
    if prob in PROBLEMAS:
        w.append(PROBLEMAS[prob])
    if f.get("vista") == "cumple":
        hoy = date.today()
        dias = [(hoy + timedelta(days=i)).strftime("%m-%d") for i in range(8)]
        w.append(f"cumple IN ({','.join('?' * len(dias))})")
        p += dias
    return w, p


def listar(f: dict) -> dict:
    w, p = _where(f)
    where = f"WHERE {' AND '.join(w)}" if w else ""
    campo = ORDENES.get(f.get("orden") or "", "venta_total")
    direc = "ASC" if f.get("dir") == "asc" else "DESC"
    try:
        pagina = max(0, int(f.get("pagina") or 0))
        por = min(100, max(5, int(f.get("porPagina") or 25)))
    except ValueError:
        pagina, por = 0, 25
    ix = get_indice()
    total = int(ix.scalar(f"SELECT COUNT(*) FROM cli {where}", p) or 0)
    filas = ix.query(f"SELECT {_COLS_LISTA} FROM cli {where} ORDER BY {campo} {direc} NULLS LAST, id LIMIT ? OFFSET ?",
                     [*p, por, pagina * por])
    return {"total": total, "pagina": pagina, "porPagina": por, "filas": [_fila(r) for r in filas]}


def exportar(f: dict, limite: int = 50_000) -> list[dict]:
    w, p = _where(f)
    where = f"WHERE {' AND '.join(w)}" if w else ""
    return [_fila(r) for r in get_indice().query(f"SELECT {_COLS_LISTA} FROM cli {where} ORDER BY venta_total DESC NULLS LAST LIMIT ?",
                                                 [*p, limite])]


def _fila(r: dict) -> dict:
    return {
        "id": r["id"], "tarjeta": r["tarjeta"], "documento": r["documento"], "tipoDoc": r["tipo_doc"],
        "nombres": r["nombres"], "apellidos": r["apellidos"], "celular": r["celular"], "email": r["email"],
        "celOk": bool(r["cel_ok"]), "emailOk": bool(r["email_ok"]), "consentimiento": r["consentimiento"], "estado": r["estado"],
        "segmento": r["segmento"], "ultimaCompra": r["ultima_compra"].isoformat() if r["ultima_compra"] else None,
        "ventaTotal": float(r["venta_total"] or 0), "visitas": int(r["visitas"] or 0),
        "clubes": [c for c in (r["clubes"] or "").split(",") if c], "nMascotas": int(r["n_mascotas"] or 0),
        "completitud": int(r["completitud"]), "ciudadId": r["ciudad_id"], "editable": bool(r["editable"]),
        "fusionadoEn": r["fusionado_en"] or "", "etiquetas": [e for e in (r["etiquetas"] or "").split("|") if e],
    }


def kpis() -> dict:
    r = get_indice().query(
        "SELECT COUNT(*) total, SUM((consentimiento = 'si')::INT) consent, SUM(cel_ok::INT) cel, SUM(email_ok::INT) mail, "
        "ROUND(AVG(completitud)) comp, SUM((visitas > 0)::INT) compradores FROM cli WHERE estado = 'activo'")[0]
    otros = get_indice().query("SELECT estado, COUNT(*) n FROM cli WHERE estado <> 'activo' GROUP BY estado")
    return {"total": int(r["total"] or 0), "consent": int(r["consent"] or 0), "cel": int(r["cel"] or 0), "mail": int(r["mail"] or 0),
            "comp": int(r["comp"] or 0), "compradores": int(r["compradores"] or 0), "otros": {o["estado"]: int(o["n"]) for o in otros}}


def calidad() -> dict:
    ix = get_indice()
    conteos = ix.query("SELECT " + ", ".join(f"SUM(({cond})::INT) AS {k}" for k, cond in PROBLEMAS.items()) +
                       ", COUNT(*) AS activos, ROUND(AVG(completitud)) AS prom FROM cli WHERE estado = 'activo'")[0]
    cola = ix.query(f"SELECT {_COLS_LISTA} FROM cli WHERE estado = 'activo' AND editable AND completitud < 80 AND visitas > 0 "
                    "ORDER BY venta_total DESC NULLS LAST LIMIT 15")
    return {"activos": int(conteos.pop("activos") or 0), "prom": int(conteos.pop("prom") or 0),
            "problemas": {k: int(v or 0) for k, v in conteos.items()}, "cola": [_fila(c) for c in cola]}


def duplicados(descartados: set[str], limite: int = 150) -> dict:
    """Grupos de posibles duplicados entre clientes activos y editables. Un celular compartido por más de 6 fichas se
    ignora: suele ser un dato de relleno (3009999999), no una misma persona."""
    reglas = [
        ("Mismo documento", "documento", "documento <> ''"),
        ("Mismo celular", "cel_norm", "cel_norm IS NOT NULL"),
        ("Mismo correo", "email", "email_ok"),
        ("Mismo nombre y fecha de nacimiento", "busca || '|' || CAST(nac AS VARCHAR)", "nac IS NOT NULL AND length(busca) > 8"),
    ]
    ix = get_indice()
    grupos, vistos = [], set()
    for motivo, clave, cond in reglas:
        filas = ix.query(f"""
            SELECT {clave} AS k, list(id ORDER BY venta_total DESC NULLS LAST) AS ids, SUM(COALESCE(venta_total, 0)) AS venta
            FROM cli WHERE estado = 'activo' AND editable AND {cond}
            GROUP BY {clave} HAVING COUNT(*) BETWEEN 2 AND 6 ORDER BY venta DESC LIMIT ?""", [5000])
        for f in filas:
            ids = list(f["ids"])
            firma = ",".join(sorted(ids))
            if firma in vistos or firma in descartados:
                continue
            vistos.add(firma)
            grupos.append({"clave": f"{motivo}:{f['k']}", "motivo": motivo, "ids": ids, "venta": float(f["venta"] or 0)})
    total = len(grupos)
    grupos = grupos[:limite]
    ids = sorted({i for g in grupos for i in g["ids"]})
    detalle = {}
    if ids:
        for r in ix.query(f"SELECT {_COLS_LISTA} FROM cli WHERE id IN ({','.join('?' * len(ids))})", ids):
            detalle[r["id"]] = _fila(r)
    return {"total": total, "grupos": grupos, "clientes": detalle}


@dataclass(frozen=True)
class RestriccionesContacto:
    """Lo que Campañas debe respetar al armar y al ejecutar un envío, leído del ERP en vivo (índice de Clientes 360°).

    El warehouse solo se actualiza con el ETL nocturno; el índice se refresca tras cada edición del CRM y cada
    ``CRM_CLIENTES_REFRESCO_MIN`` minutos desde POSCLI. Por eso «No autoriza» se respeta desde el mismo momento en que se
    guarda, aunque el warehouse todavía diga lo contrario.
    """
    conocidos: frozenset[str]            # documentos presentes hoy en POSCLI (quien no está, no se contacta)
    excluir: frozenset[str]              # inactivos/anonimizados, «No autoriza» o BLOQUE marcado: nunca se contactan
    sin_autorizacion: frozenset[str]     # ninguna ficha activa con «Sí autoriza» (aplica en modo de consentimiento estricto)
    menores: frozenset[str]              # menores de 18 según la fecha de nacimiento del ERP (o fecha no confiable)
    canales_bloqueados: dict[str, frozenset[str]] = field(default_factory=dict)   # documento → canales que no autorizó

    def bloqueados_para(self, *, estricto: bool, restringido: bool) -> set[str]:
        out = set(self.excluir)
        if estricto:
            out |= self.sin_autorizacion
        if restringido:
            out |= self.menores
        return out


def restricciones_contacto() -> RestriccionesContacto:
    """Falla CERRADA: si la lista de clientes del ERP no está cargada lanza ``IndiceNoListo`` y no se envía nada."""
    filas = get_indice().query("""
        SELECT documento,
               bool_and(estado <> 'activo')                                   AS inactivo,
               bool_or(consentimiento = 'no')                                 AS niega,
               bool_or(sin_campanas)                                          AS sin_campanas,
               bool_or(consentimiento = 'si' AND estado = 'activo')           AS autoriza,
               bool_or(autoriza_whatsapp IS FALSE)                            AS no_whatsapp,
               bool_or(autoriza_sms IS FALSE)                                 AS no_sms,
               bool_or(autoriza_email IS FALSE)                               AS no_email,
               -- menor si ALGUNA ficha dice que no ha cumplido 18 (edad exacta, contada al día de hoy)
               bool_or(nac IS NOT NULL AND nac > current_date - INTERVAL 18 YEAR)  AS menor
        FROM cli WHERE documento <> '' GROUP BY documento""")
    conocidos, excluir, sin_aut, menores, canales = set(), set(), set(), set(), {}
    for r in filas:
        d = r["documento"]
        conocidos.add(d)
        if r["inactivo"] or r["niega"] or r["sin_campanas"]:
            excluir.add(d)
        if not r["autoriza"]:
            sin_aut.add(d)
        if r["menor"]:
            menores.add(d)
        ch = frozenset(c for c, k in (("whatsapp", "no_whatsapp"), ("sms", "no_sms"), ("email", "no_email")) if r[k])
        if ch:
            canales[d] = ch
    return RestriccionesContacto(frozenset(conocidos), frozenset(excluir), frozenset(sin_aut), frozenset(menores), canales)
