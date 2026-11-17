"""Tablero de clientes: quiénes son, cuántos hay en cada club, cómo compran y qué tan contactables son.

Dos fuentes, cada una para lo que mejor sabe:

* **Índice de Clientes 360°** (POSCLI + tablas CRM_*, al día): población, demografía, clubes, mascotas, vehículos,
  consentimiento, canales, completitud de la ficha y las métricas de compra por cliente (RFM, ciclo).
* **Warehouse** (ventas del ERP hasta la fecha de corte): comportamiento en el tiempo — clientes activos por mes,
  día y hora de compra, categorías, marcas y sedes.

Los filtros se aplican al índice; la selección resultante (documentos) se cruza con el warehouse dentro de DuckDB.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from ...warehouse import WarehouseNoDisponible, get_warehouse
from ..clientes.consultas import SEGMENTOS
from ..clientes.indice import get_indice
from .comun import en_cache, entero, iso, meta_warehouse, pct, r2

log = logging.getLogger("crm.analitica.clientes")

BANDAS = ("menor", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "sin_dato")
CICLOS = ("adelantado", "en_ventana", "atrasado", "inactivo", "sin_historial")
SEXOS = ("F", "M", "N")
CONSENTIMIENTOS = ("si", "no", "sin_registro")

# Edad EXACTA (años cumplidos) desde la fecha de nacimiento del ERP; fechas futuras o imposibles → sin dato.
_EDAD = ("CASE WHEN c.nac IS NULL OR c.nac > current_date OR c.nac < DATE '1900-01-01' THEN NULL "
         "ELSE date_diff('year', c.nac, current_date) - CASE WHEN strftime(current_date, '%m%d') < strftime(c.nac, '%m%d') "
         "THEN 1 ELSE 0 END END")
_BANDA = ("CASE WHEN edad IS NULL THEN 'sin_dato' WHEN edad < 18 THEN 'menor' WHEN edad < 25 THEN '18-24' "
          "WHEN edad < 35 THEN '25-34' WHEN edad < 45 THEN '35-44' WHEN edad < 55 THEN '45-54' "
          "WHEN edad < 65 THEN '55-64' ELSE '65+' END")


def _lista(v, permitidos=None, maximo: int = 50) -> list[str]:
    if v is None:
        return []
    vals = v if isinstance(v, (list, tuple)) else str(v).split(",")
    out = []
    for x in vals:
        s = str(x).strip()[:20]
        if s and (permitidos is None or s in permitidos) and s not in out:
            out.append(s)
    return out[:maximo]


def normalizar(f: dict | None) -> dict:
    """Solo valores de listas blancas (o códigos alfanuméricos cortos para clubes y ciudades)."""
    f = f or {}
    codigo = lambda s: s.isalnum()  # noqa: E731
    return {
        "clubes": [c for c in _lista(f.get("clubes")) if codigo(c) or c == "ninguno"],
        "segmentos": _lista(f.get("segmentos"), set(SEGMENTOS)),
        "ciclos": _lista(f.get("ciclos"), set(CICLOS)),
        "sexos": _lista(f.get("sexos"), set(SEXOS)),
        "edades": _lista(f.get("edades"), set(BANDAS)),
        "ciudades": [c for c in _lista(f.get("ciudades")) if codigo(c)],
        "consentimiento": _lista(f.get("consentimiento"), set(CONSENTIMIENTOS)),
    }


def _where(f: dict) -> tuple[str, list]:
    w, p = [], []
    if f["clubes"]:
        conds = []
        ids = [c for c in f["clubes"] if c != "ninguno"]
        if ids:
            conds.append("list_has_any(string_split(clubes, ','), ?::VARCHAR[])")
            p.append(ids)
        if "ninguno" in f["clubes"]:
            conds.append("clubes = ''")
        w.append("(" + " OR ".join(conds) + ")")
    for clave, col in (("segmentos", "segmento"), ("ciclos", "ciclo"), ("edades", "banda"), ("ciudades", "ciudad_id"),
                       ("consentimiento", "consentimiento")):
        if f[clave]:
            w.append(f"{col} IN ({','.join('?' * len(f[clave]))})")
            p.extend(f[clave])
    if f["sexos"]:
        sex = [s for s in f["sexos"] if s != "N"]
        conds = [f"sexo IN ({','.join('?' * len(sex))})"] if sex else []
        p.extend(sex)
        if "N" in f["sexos"]:
            conds.append("sexo NOT IN ('F', 'M')")
        w.append("(" + " OR ".join(conds) + ")")
    return (" AND ".join(w) or "TRUE"), p


def _base(f: dict, corte: date) -> tuple[str, list]:
    """CTE ``b``: personas activas (sin registros genéricos del POS) con edad, banda y días sin comprar al corte."""
    where, params = _where(f)
    sql = f"""WITH x AS (SELECT c.*, {_EDAD} AS edad FROM cli c WHERE NOT c.generico AND c.estado = 'activo'),
      y AS (SELECT x.*, {_BANDA} AS banda,
                   CASE WHEN ultima_compra IS NULL THEN NULL ELSE GREATEST(0, date_diff('day', ultima_compra, ?::DATE)) END AS dias_sin
            FROM x),
      b AS (SELECT * FROM y WHERE {where})
    """
    return sql, [corte, *params]


def _poblacion(f: dict, corte: date) -> dict:
    ix = get_indice()
    base, p = _base(f, corte)
    q = lambda sql: ix.query(base + sql, p)  # noqa: E731

    k = q("""SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE COALESCE(visitas, 0) > 0) AS con_compras,
        COUNT(*) FILTER (WHERE dias_sin <= 90) AS activos_90,
        COUNT(*) FILTER (WHERE consentimiento = 'si') AS autorizan,
        COUNT(*) FILTER (WHERE consentimiento = 'no') AS no_autorizan,
        COUNT(*) FILTER (WHERE consentimiento = 'sin_registro') AS sin_registro,
        COUNT(*) FILTER (WHERE sin_campanas) AS bloque,
        COUNT(*) FILTER (WHERE cel_ok) AS con_celular,
        COUNT(*) FILTER (WHERE email_ok) AS con_email,
        COUNT(*) FILTER (WHERE cel_ok OR email_ok) AS alcanzables,
        COUNT(*) FILTER (WHERE (cel_ok OR email_ok) AND consentimiento = 'si') AS alcanzables_autorizan,
        COUNT(*) FILTER (WHERE (cel_ok OR email_ok) AND consentimiento = 'si' AND NOT sin_campanas) AS contactables,
        COUNT(*) FILTER (WHERE clubes <> '') AS en_clubes,
        COUNT(*) FILTER (WHERE n_mascotas > 0) AS con_mascotas, SUM(n_mascotas) AS mascotas,
        COUNT(*) FILTER (WHERE n_vehiculos > 0) AS con_vehiculos, SUM(n_vehiculos) AS vehiculos,
        COUNT(*) FILTER (WHERE autoriza_whatsapp IS TRUE) AS wa_si, COUNT(*) FILTER (WHERE autoriza_whatsapp IS FALSE) AS wa_no,
        COUNT(*) FILTER (WHERE autoriza_sms IS TRUE) AS sms_si, COUNT(*) FILTER (WHERE autoriza_sms IS FALSE) AS sms_no,
        COUNT(*) FILTER (WHERE autoriza_email IS TRUE) AS email_si, COUNT(*) FILTER (WHERE autoriza_email IS FALSE) AS email_no,
        COUNT(*) FILTER (WHERE creado >= current_date - INTERVAL 30 DAY) AS altas_30,
        COUNT(*) FILTER (WHERE edad IS NOT NULL) AS con_edad, AVG(edad) AS edad_prom,
        SUM(COALESCE(venta_total, 0)) AS venta, SUM(COALESCE(visitas, 0)) AS visitas, AVG(completitud) AS completitud
        FROM b""")[0]
    total = entero(k["total"])
    venta, visitas = float(k["venta"] or 0), entero(k["visitas"])
    con_compras = entero(k["con_compras"])
    kpis = {
        "total": total, "con_compras": con_compras, "pct_con_compras": pct(con_compras, total),
        "activos_90": entero(k["activos_90"]), "pct_activos_90": pct(k["activos_90"], con_compras),
        "autorizan": entero(k["autorizan"]), "pct_autorizan": pct(k["autorizan"], total),
        "contactables": entero(k["contactables"]), "pct_contactables": pct(k["contactables"], total),
        "en_clubes": entero(k["en_clubes"]), "pct_en_clubes": pct(k["en_clubes"], total),
        "con_mascotas": entero(k["con_mascotas"]), "mascotas": entero(k["mascotas"]),
        "con_vehiculos": entero(k["con_vehiculos"]), "vehiculos": entero(k["vehiculos"]),
        "venta": round(venta), "ticket": round(venta / visitas) if visitas else None,
        "visitas_prom": r2(visitas / con_compras, 1) if con_compras else None,
        "venta_prom": round(venta / con_compras) if con_compras else None,
        "completitud": r2(k["completitud"], 1), "altas_30": entero(k["altas_30"]),
        "edad_prom": r2(k["edad_prom"], 1), "pct_con_edad": pct(k["con_edad"], total),
    }
    contacto = {
        "embudo": [
            {"id": "total", "n": total},
            {"id": "alcanzables", "n": entero(k["alcanzables"])},
            {"id": "autorizan", "n": entero(k["alcanzables_autorizan"])},
            {"id": "contactables", "n": entero(k["contactables"])},
        ],
        "consentimiento": [{"id": "si", "n": entero(k["autorizan"])}, {"id": "no", "n": entero(k["no_autorizan"])},
                           {"id": "sin_registro", "n": entero(k["sin_registro"])}],
        "canales": [{"id": c, "si": entero(k[f"{c}_si"]), "no": entero(k[f"{c}_no"])} for c in ("wa", "sms", "email")],
        "datos": {"con_celular": entero(k["con_celular"]), "con_email": entero(k["con_email"]), "bloque": entero(k["bloque"])},
    }

    estados = {r["estado"]: entero(r["n"]) for r in ix.query(
        "SELECT estado, COUNT(*) AS n FROM cli WHERE NOT generico GROUP BY estado")}

    # Últimos 24 meses completos, con 0 en los meses sin fichas nuevas (la serie no salta meses).
    altas = q("""SELECT strftime(m.mes, '%Y-%m') AS mes, COUNT(b.id) AS n
                 FROM (SELECT unnest(generate_series(date_trunc('month', current_date) - INTERVAL 23 MONTH,
                                                     date_trunc('month', current_date), INTERVAL 1 MONTH)) AS mes) m
                 LEFT JOIN b ON date_trunc('month', b.creado) = m.mes GROUP BY 1 ORDER BY 1""")
    segmentos = q("""SELECT segmento AS id, COUNT(*) AS n, SUM(COALESCE(venta_total, 0)) AS venta,
                     SUM(COALESCE(visitas, 0)) AS visitas FROM b GROUP BY 1""")
    ciclos = q("SELECT ciclo AS id, COUNT(*) AS n FROM b GROUP BY 1")
    recencia = q("""SELECT CASE WHEN dias_sin <= 30 THEN '0-30' WHEN dias_sin <= 60 THEN '31-60' WHEN dias_sin <= 90 THEN '61-90'
                     WHEN dias_sin <= 180 THEN '91-180' ELSE '181+' END AS id, COUNT(*) AS n, SUM(venta_total) AS venta
                    FROM b WHERE dias_sin IS NOT NULL GROUP BY 1""")
    # Compras (días con compra) en el periodo de datos. Rangos pensados para un año: 6-12 ≈ mensual, 13-24 ≈ quincenal,
    # 25-52 ≈ semanal; solo la última barra queda abierta (101+).
    frecuencia = q("""SELECT CASE WHEN visitas <= 2 THEN '1-2' WHEN visitas <= 5 THEN '3-5' WHEN visitas <= 12 THEN '6-12'
                       WHEN visitas <= 24 THEN '13-24' WHEN visitas <= 52 THEN '25-52' WHEN visitas <= 100 THEN '53-100' ELSE '101+' END AS id,
                       COUNT(*) AS n, SUM(venta_total) AS venta FROM b WHERE visitas > 0 GROUP BY 1""")
    clubes = q("""SELECT trim(u.club) AS id, COUNT(*) AS n, SUM(COALESCE(venta_total, 0)) AS venta, SUM(COALESCE(visitas, 0)) AS visitas,
                    COUNT(*) FILTER (WHERE visitas > 0) AS con_compras, COUNT(*) FILTER (WHERE dias_sin <= 90) AS activos_90,
                    COUNT(*) FILTER (WHERE consentimiento = 'si') AS autorizan,
                    COUNT(*) FILTER (WHERE (cel_ok OR email_ok) AND consentimiento = 'si' AND NOT sin_campanas) AS contactables
                  FROM b, unnest(string_split(b.clubes, ',')) AS u(club) WHERE b.clubes <> '' GROUP BY 1
                  UNION ALL
                  SELECT 'ninguno', COUNT(*), SUM(COALESCE(venta_total, 0)), SUM(COALESCE(visitas, 0)),
                    COUNT(*) FILTER (WHERE visitas > 0), COUNT(*) FILTER (WHERE dias_sin <= 90),
                    COUNT(*) FILTER (WHERE consentimiento = 'si'),
                    COUNT(*) FILTER (WHERE (cel_ok OR email_ok) AND consentimiento = 'si' AND NOT sin_campanas)
                  FROM b WHERE b.clubes = ''""")
    n_clubes = q("""SELECT CASE WHEN clubes = '' THEN 0 ELSE LEAST(len(string_split(clubes, ',')), 4) END AS id, COUNT(*) AS n
                    FROM b GROUP BY 1 ORDER BY 1""")
    # Clientes que comparten dos clubes (para ver qué clubes se solapan).
    pares = q("""SELECT a.club AS a, c.club AS b, COUNT(*) AS n
                 FROM (SELECT id AS cid, trim(u.club) AS club FROM b, unnest(string_split(b.clubes, ',')) AS u(club) WHERE b.clubes LIKE '%,%') a
                 JOIN (SELECT id AS cid, trim(u.club) AS club FROM b, unnest(string_split(b.clubes, ',')) AS u(club) WHERE b.clubes LIKE '%,%') c
                   ON a.cid = c.cid AND a.club < c.club
                 GROUP BY 1, 2 ORDER BY n DESC LIMIT 20""")
    mascotas = q("""SELECT trim(u.t) AS id, COUNT(*) AS n, COUNT(DISTINCT b.id) AS clientes
                    FROM b, unnest(string_split(b.mascota_tipos, ',')) AS u(t) WHERE b.mascota_tipos <> '' GROUP BY 1 ORDER BY n DESC""")
    demografia = q("SELECT banda AS edad, CASE WHEN sexo IN ('F', 'M') THEN sexo ELSE 'N' END AS sexo, COUNT(*) AS n FROM b GROUP BY 1, 2")
    ciudades = q("""SELECT ciudad_id AS id, COUNT(*) AS n, SUM(COALESCE(venta_total, 0)) AS venta FROM b
                    GROUP BY 1 ORDER BY n DESC LIMIT 12""")
    sedes_alta = q("""SELECT sucursal AS id, COUNT(*) AS n FROM b WHERE sucursal <> '' GROUP BY 1 ORDER BY n DESC LIMIT 15""")
    completitud = q("""SELECT CASE WHEN completitud < 40 THEN '0-39' WHEN completitud < 60 THEN '40-59' WHEN completitud < 80 THEN '60-79'
                        ELSE '80-100' END AS id, COUNT(*) AS n FROM b GROUP BY 1""")
    return {"kpis": kpis, "contacto": contacto, "estados": estados, "altas": altas, "segmentos": segmentos, "ciclos": ciclos,
            "recencia": recencia, "frecuencia": frecuencia, "clubes": clubes, "n_clubes": n_clubes,
            "pares_clubes": pares, "mascotas": mascotas, "demografia": demografia, "ciudades": ciudades,
            "sedes_alta": sedes_alta, "completitud": completitud, "_sel": (base, p)}


def _comportamiento(base: str, params: list, corte: date, desde: date | None) -> dict:
    """Cruza la selección del índice con las ventas del warehouse (todo agregado en DuckDB)."""
    sel = get_indice().arrow(base + "SELECT DISTINCT documento AS cliente_id FROM b WHERE documento <> ''", params)
    consultas = {
        "mensual": ("""WITH p AS (SELECT cliente_id, MIN(fecha) AS primera FROM cli_dia GROUP BY 1),
                         d AS (SELECT c.* FROM cli_dia c JOIN sel USING (cliente_id) WHERE c.fecha <= ?)
                       SELECT strftime(d.fecha, '%Y-%m') AS mes, COUNT(DISTINCT d.cliente_id) AS clientes,
                              COUNT(DISTINCT d.cliente_id) FILTER (WHERE date_trunc('month', p.primera) = date_trunc('month', d.fecha)) AS nuevos,
                              COUNT(*) AS visitas, SUM(d.venta) AS venta
                       FROM d JOIN p USING (cliente_id) GROUP BY 1 ORDER BY 1""", [corte]),
        "calor": ("""SELECT isodow(c.fecha) AS dia, c.hora, COUNT(*) AS v FROM cli_dia c JOIN sel USING (cliente_id)
                     WHERE c.hora BETWEEN 5 AND 23 AND c.fecha <= ? GROUP BY 1, 2""", [corte]),
        "dia_pref": ("SELECT p.dia_semana_pref AS id, COUNT(*) AS n FROM cli_perfil p JOIN sel USING (cliente_id) "
                     "WHERE p.dia_semana_pref IS NOT NULL GROUP BY 1 ORDER BY 1", []),
        "franja": ("SELECT p.franja_pref AS id, COUNT(*) AS n FROM cli_perfil p JOIN sel USING (cliente_id) "
                   "WHERE p.franja_pref IS NOT NULL GROUP BY 1", []),
        "perfil": ("""SELECT AVG(p.items_por_visita) AS items, AVG(p.intervalo_dias) AS intervalo,
                             AVG(p.pct_descuento) FILTER (WHERE p.pct_descuento IS NOT NULL) AS descuento,
                             COUNT(*) FILTER (WHERE p.visitas_finde > p.visitas / 2.0) AS de_finde, COUNT(*) AS n
                      FROM cli_perfil p JOIN sel USING (cliente_id)""", []),
        "descuento": ("""SELECT CASE WHEN COALESCE(p.pct_descuento, 0) <= 0 THEN 'Sin descuento' WHEN p.pct_descuento < 0.05 THEN 'Menos de 5%'
                          WHEN p.pct_descuento < 0.15 THEN '5-15%' WHEN p.pct_descuento < 0.30 THEN '15-30%' ELSE '30% o más' END AS id,
                          COUNT(*) AS n FROM cli_perfil p JOIN sel USING (cliente_id) GROUP BY 1""", []),
        # Categorías = nivel «grupo» del ERP (Carnes, Lácteos, Licores…): la «familia» casi toda es GENERAL y no informa.
        "categorias": ("""SELECT n.codigo AS id, c.nombre, SUM(n.venta) AS venta, COUNT(DISTINCT n.cliente_id) AS clientes
                          FROM cli_nivel n JOIN sel USING (cliente_id) JOIN catalogo c ON c.codigo = n.codigo
                          WHERE n.nivel = 'grupo' GROUP BY 1, 2 ORDER BY venta DESC LIMIT 15""", []),
        "departamentos": ("""SELECT n.codigo AS id, c.nombre, SUM(n.venta) AS venta, COUNT(DISTINCT n.cliente_id) AS clientes
                             FROM cli_nivel n JOIN sel USING (cliente_id) JOIN catalogo c ON c.codigo = n.codigo
                             WHERE n.nivel = 'departamento' AND NOT regexp_matches(c.nombre, '^[0-9 ]+$')
                             GROUP BY 1, 2 ORDER BY venta DESC LIMIT 10""", []),
        "marcas": ("""SELECT m.marca AS nombre, COUNT(DISTINCT m.cliente_id) AS clientes, SUM(m.venta) AS venta
                      FROM cli_marca m JOIN sel USING (cliente_id)
                      WHERE COALESCE(trim(m.marca), '') <> '' AND upper(trim(m.marca)) NOT IN ('SIN MARCA', 'GENERICO', 'GENÉRICO')
                      GROUP BY 1 ORDER BY clientes DESC LIMIT 12""", []),
        "sedes": ("""SELECT v.sucursal_id AS id, COUNT(DISTINCT v.cliente_id) AS clientes, SUM(v.venta_neta) AS venta,
                            COUNT(DISTINCT v.factura || '|' || v.fecha) AS tickets
                     FROM venta v JOIN sel USING (cliente_id) WHERE v.sucursal_id IS NOT NULL GROUP BY 1 ORDER BY clientes DESC""", []),
    }
    out = get_warehouse().consultar_con({"sel": sel}, consultas)
    # El primer mes con datos no tiene historia previa: todos parecerían «nuevos». Se marca como no comparable.
    if out["mensual"] and desde is not None and out["mensual"][0]["mes"] == iso(desde)[:7]:
        out["mensual"][0]["nuevos"] = None
    return out


def _nombres(pob: dict, comp: dict | None) -> None:
    """Códigos → nombres legibles (ciudades, sedes, clubes, mascotas)."""
    from ..clientes import servicio
    from ..clientes.catalogos import get_catalogos

    try:
        cat = get_catalogos()
    except Exception:
        cat = None
    for c in pob["ciudades"]:
        c["nombre"] = (cat.nombre_ciudad(c["id"]) if cat and c["id"] else "") or ("Sin ciudad" if not c["id"] else f"Ciudad {c['id']}")
    for m in pob["mascotas"]:
        fila = cat.mascota(m["id"]) if cat else None
        m["nombre"] = (fila or {}).get("nombre") or f"Tipo {m['id']}"
    suc = servicio.nombres_sucursales()
    pob["sedes_alta"] = _por_sede(pob["sedes_alta"], suc, ("n",))
    if comp:
        comp["sedes"] = _por_sede(comp["sedes"], suc, ("clientes", "venta", "tickets"))


def _sede(codigo, suc: dict[str, str]) -> tuple[str, str]:
    """El ERP escribe la sede como '1', '01' o '001' según el programa: se normaliza al número para buscar el nombre."""
    s = str(codigo).strip()
    n = str(int(s)) if s.isdigit() else s
    nombre = suc.get(n.zfill(2)) or suc.get(n) or suc.get(s) or f"Sede {n}"
    return n, nombre


def _por_sede(filas: list[dict], suc: dict[str, str], sumas: tuple[str, ...]) -> list[dict]:
    """Une las filas de una misma sede escrita de formas distintas y las ordena de mayor a menor."""
    out: dict[str, dict] = {}
    for f in filas:
        n, nombre = _sede(f["id"], suc)
        acc = out.setdefault(nombre, {"id": n, "nombre": nombre, **{k: 0 for k in sumas}})
        for k in sumas:
            acc[k] += f.get(k) or 0
    return sorted(out.values(), key=lambda x: -x[sumas[0]])


def tablero(filtros: dict | None) -> dict:
    f = normalizar(filtros)
    ix = get_indice()
    try:
        meta = meta_warehouse()
    except WarehouseNoDisponible:
        meta = {"version": "", "corte": date.today(), "desde": None, "construido": None}
    clave = {"t": "clientes", "f": f, "wh": meta["version"], "ix": iso(ix.cargado_en)}
    return en_cache(clave, lambda: _calcular(f, meta))


def _calcular(f: dict, meta: dict) -> dict:
    corte = meta["corte"]
    base, params = _base(f, corte)
    comp, aviso = None, None
    # Población (índice) y comportamiento (warehouse) son independientes: se calculan a la vez.
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="analitica") as ex:
        fut = ex.submit(_comportamiento, base, params, corte, meta["desde"]) if meta["version"] else None
        pob = _poblacion(f, corte)
        if fut is None:
            aviso = "Aún no hay ventas cargadas del ERP: se muestra solo la información de las fichas."
        else:
            try:
                comp = fut.result()
            except WarehouseNoDisponible as e:
                aviso = str(e)
            except Exception:
                log.exception("No se pudo calcular el comportamiento de compra")
                aviso = "No se pudo calcular el comportamiento de compra (ventas del ERP)."
    pob.pop("_sel", None)
    _nombres(pob, comp)
    return {"filtros": f, "corte": iso(corte), "datos_desde": iso(meta["desde"]), "construido": iso(meta["construido"]),
            "poblacion": pob, "comportamiento": comp, "aviso": aviso}


def opciones() -> dict:
    """Valores para la barra de filtros (clubes con su color, ciudades con más clientes)."""
    from ..clientes import servicio
    from ..clientes.catalogos import get_catalogos

    clubes = [{"id": a["id"], "nombre": a["nombre"], "color": a["color"], "activa": a["activa"]} for a in servicio.listar_afiliaciones()]
    filas = get_indice().query("SELECT ciudad_id AS id, COUNT(*) AS n FROM cli WHERE NOT generico AND estado = 'activo' "
                               "AND ciudad_id <> '' GROUP BY 1 ORDER BY n DESC LIMIT 40")
    try:
        cat = get_catalogos()
    except Exception:
        cat = None
    ciudades = [{"id": r["id"], "nombre": (cat.nombre_ciudad(r["id"]) if cat else "") or f"Ciudad {r['id']}", "n": entero(r["n"])} for r in filas]
    return {"clubes": clubes, "ciudades": ciudades, "segmentos": list(SEGMENTOS), "ciclos": list(CICLOS), "edades": list(BANDAS)}
