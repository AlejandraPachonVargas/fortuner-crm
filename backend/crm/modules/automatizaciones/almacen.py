"""Persistencia de Automatizaciones en la misma base SQLite de Campañas (``data/crm.sqlite``).

Usa la conexión y el cerrojo del ``Store`` de Campañas: así los envíos automáticos cuentan como «contactado
recientemente» para las campañas y todo vive en un solo archivo con un solo respaldo.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta

from ...store import Store, get_store
from . import catalogo


class NoEncontrada(LookupError):
    pass


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _mas_anios(iso: str, n: int) -> str:
    d = date.fromisoformat(iso)
    try:
        return d.replace(year=d.year + n).isoformat()
    except ValueError:   # 29 de febrero → 28 de febrero
        return d.replace(year=d.year + n, day=28).isoformat()


class AutoAlmacen:
    def __init__(self, store: Store):
        self._s = store
        self._db = store._db
        self._lock = store._lock

    # ---------------------------------------------------------------- lectura
    @staticmethod
    def _auto(r) -> dict:
        d = dict(r)
        d["activa"] = bool(d["activa"])
        d["params"] = catalogo.normalizar_params(d["tipo"], json.loads(d["params"] or "{}"))
        d["filtros"] = catalogo.normalizar_filtros(json.loads(d["filtros"] or "{}"))
        return d

    @staticmethod
    def _edicion(r) -> dict:
        d = dict(r)
        for k, defecto in (("oferta", {}), ("canales", []), ("textos", {})):
            d[k] = json.loads(d[k]) if d.get(k) else defecto
        d["problemas"] = catalogo.problemas_edicion(d)
        return d

    def _ediciones(self, aid: str) -> list[dict]:
        rows = self._db.execute("SELECT * FROM automatizacion_edicion WHERE automatizacion_id = ? AND eliminada_en IS NULL "
                                "ORDER BY desde, creada", (aid,)).fetchall()
        return [self._edicion(r) for r in rows]

    def obtener(self, aid: str) -> dict | None:
        with self._lock:
            r = self._db.execute("SELECT * FROM automatizacion WHERE id = ? AND eliminada_en IS NULL", (aid,)).fetchone()
            if r is None:
                return None
            a = self._auto(r)
            a["ediciones"] = self._ediciones(aid)
        return a

    def listar(self, solo_activas: bool = False) -> list[dict]:
        sql = "SELECT * FROM automatizacion WHERE eliminada_en IS NULL" + (" AND activa = 1" if solo_activas else "") + " ORDER BY creada"
        with self._lock:
            out = []
            for r in self._db.execute(sql).fetchall():
                a = self._auto(r)
                a["ediciones"] = self._ediciones(a["id"])
                out.append(a)
        return out

    def exigir(self, aid: str) -> dict:
        a = self.obtener(aid)
        if a is None:
            raise NoEncontrada("La automatización no existe o fue eliminada.")
        return a

    # ---------------------------------------------------------------- automatización
    def crear(self, tipo: str, nombre: str | None = None, hoy: date | None = None) -> dict:
        if tipo not in catalogo.TIPOS:
            raise ValueError("Tipo de automatización desconocido.")
        aid, ahora = uuid.uuid4().hex[:12], _ahora()
        nombre = (nombre or "").strip()[:80] or catalogo.TIPOS[tipo]["nombre"]
        ed = catalogo.edicion_por_defecto(tipo, (hoy or date.today()).year)
        with self._lock:
            def hacer() -> None:
                self._db.execute("INSERT INTO automatizacion (id, tipo, nombre, activa, hora, params, filtros, creada, actualizada) "
                                 "VALUES (?,?,?,0,'09:00',?,?,?,?)",
                                 (aid, tipo, nombre, json.dumps(catalogo.normalizar_params(tipo, {})),
                                  json.dumps(catalogo.normalizar_filtros({})), ahora, ahora))
                self._insertar_edicion(aid, ed, ahora)
            self._s._transaccion(hacer)
        return self.exigir(aid)

    def actualizar(self, aid: str, datos: dict) -> dict:
        a = self.exigir(aid)
        nombre = (str(datos.get("nombre", a["nombre"])) or "").strip()[:80] or a["nombre"]
        hora = catalogo.normalizar_hora(datos.get("hora", a["hora"]))
        params = catalogo.normalizar_params(a["tipo"], {**a["params"], **(datos.get("params") or {})})
        filtros = catalogo.normalizar_filtros(datos.get("filtros", a["filtros"]))
        with self._lock:
            self._db.execute("UPDATE automatizacion SET nombre=?, hora=?, params=?, filtros=?, actualizada=? WHERE id=?",
                             (nombre, hora, json.dumps(params), json.dumps(filtros), _ahora(), aid))
        return self.exigir(aid)

    def activar(self, aid: str, activa: bool) -> dict:
        a = self.exigir(aid)
        if activa:
            if not any(not e["problemas"] for e in a["ediciones"]):
                raise ValueError("Para activarla necesita al menos una edición completa (oferta, canales y mensajes).")
        with self._lock:
            if activa and not a["activa"]:
                # Desde hoy: no se recuperan eventos anteriores a la activación (evita escribirle a toda la base de golpe).
                self._db.execute("UPDATE automatizacion SET activa=1, activada_en=?, ultima_ref=NULL, actualizada=? WHERE id=?",
                                 (_ahora(), _ahora(), aid))
            elif not activa:
                self._db.execute("UPDATE automatizacion SET activa=0, actualizada=? WHERE id=?", (_ahora(), aid))
        return self.exigir(aid)

    def eliminar(self, aid: str) -> None:
        self.exigir(aid)
        with self._lock:
            self._db.execute("UPDATE automatizacion SET eliminada_en=?, activa=0 WHERE id=?", (_ahora(), aid))

    def marcar_ref(self, aid: str, fecha: date) -> None:
        with self._lock:
            self._db.execute("UPDATE automatizacion SET ultima_ref=? WHERE id=?", (fecha.isoformat(), aid))

    # ---------------------------------------------------------------- ediciones
    def _insertar_edicion(self, aid: str, ed: dict, ahora: str) -> str:
        eid = uuid.uuid4().hex[:12]
        self._db.execute("INSERT INTO automatizacion_edicion (id, automatizacion_id, nombre, desde, hasta, oferta, validez_dias, "
                         "canales, textos, creada, actualizada) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (eid, aid, ed["nombre"], ed["desde"], ed["hasta"], json.dumps(ed["oferta"], ensure_ascii=False),
                          ed["validez_dias"], json.dumps(ed["canales"]), json.dumps(ed["textos"], ensure_ascii=False), ahora, ahora))
        return eid

    def _sin_cruce(self, aid: str, desde: str, hasta: str, excluir: str | None = None) -> None:
        for e in self._ediciones(aid):
            if e["id"] != excluir and not (hasta < e["desde"] or desde > e["hasta"]):
                raise ValueError(f"Las fechas se cruzan con la edición «{e['nombre']}» ({e['desde']} a {e['hasta']}). "
                                 "Cada día solo puede tener una edición vigente.")

    def crear_edicion(self, aid: str, datos: dict) -> dict:
        self.exigir(aid)
        ed = catalogo.normalizar_edicion(datos)
        with self._lock:
            self._sin_cruce(aid, ed["desde"], ed["hasta"])
            eid = self._insertar_edicion(aid, ed, _ahora())
            self._db.execute("UPDATE automatizacion SET actualizada=? WHERE id=?", (_ahora(), aid))
        return self.edicion(aid, eid)

    def edicion(self, aid: str, eid: str) -> dict:
        with self._lock:
            r = self._db.execute("SELECT * FROM automatizacion_edicion WHERE id=? AND automatizacion_id=? AND eliminada_en IS NULL",
                                 (eid, aid)).fetchone()
        if r is None:
            raise NoEncontrada("La edición no existe o fue eliminada.")
        return self._edicion(r)

    def actualizar_edicion(self, aid: str, eid: str, datos: dict) -> dict:
        self.edicion(aid, eid)
        ed = catalogo.normalizar_edicion(datos)
        with self._lock:
            self._sin_cruce(aid, ed["desde"], ed["hasta"], excluir=eid)
            self._db.execute("UPDATE automatizacion_edicion SET nombre=?, desde=?, hasta=?, oferta=?, validez_dias=?, canales=?, "
                             "textos=?, actualizada=? WHERE id=?",
                             (ed["nombre"], ed["desde"], ed["hasta"], json.dumps(ed["oferta"], ensure_ascii=False), ed["validez_dias"],
                              json.dumps(ed["canales"]), json.dumps(ed["textos"], ensure_ascii=False), _ahora(), eid))
            self._db.execute("UPDATE automatizacion SET actualizada=? WHERE id=?", (_ahora(), aid))
        return self.edicion(aid, eid)

    def eliminar_edicion(self, aid: str, eid: str) -> None:
        self.edicion(aid, eid)
        with self._lock:
            self._db.execute("UPDATE automatizacion_edicion SET eliminada_en=? WHERE id=?", (_ahora(), eid))
            # Una automatización activa sin ediciones completas se pausa sola (no puede enviar nada).
            if not any(not e["problemas"] for e in self._ediciones(aid)):
                self._db.execute("UPDATE automatizacion SET activa=0 WHERE id=?", (aid,))

    def duplicar_edicion(self, aid: str, eid: str, anios: int = 1) -> dict:
        """Copia la edición corrida N años (para preparar la del año siguiente y cambiarle la oferta)."""
        e = self.edicion(aid, eid)
        a1, a2 = e["desde"][:4], str(int(e["desde"][:4]) + anios)
        nombre = e["nombre"].replace(a1, a2) if a1 in e["nombre"] else f"{e['nombre']} (copia)"
        datos = {**e, "nombre": nombre, "desde": _mas_anios(e["desde"], anios), "hasta": _mas_anios(e["hasta"], anios)}
        return self.crear_edicion(aid, datos)

    @staticmethod
    def vigente(a: dict, fecha: date) -> dict | None:
        f = fecha.isoformat()
        cands = [e for e in a.get("ediciones") or [] if e["desde"] <= f <= e["hasta"]]
        return max(cands, key=lambda e: e["desde"]) if cands else None

    # ---------------------------------------------------------------- envíos y ejecuciones
    def ya_recibieron(self, aid: str, desde: date, clientes: list[str]) -> set[str]:
        """Clientes que recibieron esta automatización desde ``desde`` (regla de «no repetir antes de N días»)."""
        out: set[str] = set()
        with self._lock:
            for i in range(0, len(clientes), 500):
                lote = clientes[i:i + 500]
                out.update(r[0] for r in self._db.execute(
                    f"SELECT DISTINCT cliente_id FROM automatizacion_envio WHERE automatizacion_id = ? AND fecha >= ? "
                    f"AND cliente_id IN ({','.join('?' * len(lote))})", (aid, desde.isoformat(), *lote)))
        return out

    def registrar(self, aid: str, *, fecha: date, origen: str, estado: str, edicion_id: str | None = None,
                  candidatos: int = 0, envios: list[tuple[str, str]] | None = None, validez: int = 0,
                  costo: float = 0.0, detalle: dict | None = None, inicio: str | None = None) -> dict:
        """Guarda la ejecución y sus envíos en una sola transacción. Devuelve {id, enviados}."""
        ejid, fin = uuid.uuid4().hex[:12], _ahora()
        envios = envios or []
        vd, vh = fecha.isoformat(), (fecha + timedelta(days=max(1, validez) - 1)).isoformat()
        res = {"id": ejid, "enviados": 0}

        def hacer() -> None:
            antes = self._db.total_changes
            if envios:
                self._db.executemany(
                    "INSERT OR IGNORE INTO automatizacion_envio (automatizacion_id, edicion_id, cliente_id, fecha, canales, "
                    "vigencia_desde, vigencia_hasta, ejecucion_id) VALUES (?,?,?,?,?,?,?,?)",
                    [(aid, edicion_id, c, fecha.isoformat(), ch, vd, vh, ejid) for c, ch in envios])
            res["enviados"] = self._db.total_changes - antes
            self._db.execute("INSERT INTO automatizacion_ejecucion (id, automatizacion_id, fecha, inicio, fin, origen, estado, edicion_id, "
                             "candidatos, enviados, costo, detalle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                             (ejid, aid, fecha.isoformat(), inicio or fin, fin, origen[:40], estado, edicion_id, candidatos,
                              res["enviados"], round(costo, 2), json.dumps(detalle or {}, ensure_ascii=False)))

        with self._lock:
            self._s._transaccion(hacer)
        return res

    def ultima_ejecucion(self, aid: str) -> dict | None:
        with self._lock:
            r = self._db.execute("SELECT * FROM automatizacion_ejecucion WHERE automatizacion_id=? ORDER BY inicio DESC LIMIT 1",
                                 (aid,)).fetchone()
        return self._ejec(r) if r else None

    @staticmethod
    def _ejec(r) -> dict:
        d = dict(r)
        d["detalle"] = json.loads(d.get("detalle") or "{}")
        return d

    def ejecuciones(self, aid: str, n: int = 30) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM automatizacion_ejecucion WHERE automatizacion_id=? ORDER BY inicio DESC LIMIT ?",
                                    (aid, n)).fetchall()
        return [self._ejec(r) for r in rows]

    def resumen_envios(self, aid: str | None = None, dias: int = 30, hoy: date | None = None) -> dict:
        """Envíos de los últimos ``dias`` (de una automatización o de todas): totales, personas, costo y serie diaria."""
        from ..campanas.segmentos import COSTOS_DEFECTO as C

        desde = ((hoy or date.today()) - timedelta(days=dias - 1)).isoformat()
        filtro, params = ("AND automatizacion_id = ?", [aid]) if aid else ("", [])
        costo = ("(CASE WHEN canales LIKE '%whatsapp%' THEN ? WHEN canales LIKE '%sms%' THEN ? ELSE 0 END"
                 " + CASE WHEN canales LIKE '%email%' THEN ? ELSE 0 END)")
        with self._lock:
            t = self._db.execute(f"SELECT COUNT(*), COUNT(DISTINCT cliente_id), COALESCE(SUM({costo}), 0) FROM automatizacion_envio "
                                 f"WHERE fecha >= ? {filtro}", (C["whatsapp"], C["sms"], C["email"], desde, *params)).fetchone()
            serie = self._db.execute(f"SELECT fecha, COUNT(*) FROM automatizacion_envio WHERE fecha >= ? {filtro} GROUP BY fecha ORDER BY fecha",
                                     (desde, *params)).fetchall()
            canales = self._db.execute(f"SELECT canales FROM automatizacion_envio WHERE fecha >= ? {filtro}", (desde, *params)).fetchall()
            total = self._db.execute(f"SELECT COUNT(*) FROM automatizacion_envio WHERE 1=1 {filtro}", params).fetchone()[0]
        por_canal = {c: 0 for c in catalogo.CANALES}
        for (ch,) in canales:
            for c in (ch or "").split(","):
                if c in por_canal:
                    por_canal[c] += 1
        return {"dias": dias, "envios": t[0], "personas": t[1], "costo": round(t[2]), "total_historico": total,
                "por_dia": [{"fecha": f, "n": n} for f, n in serie], "por_canal": por_canal}


    def por_automatizacion(self, desde: str | None, hasta: str | None) -> list[dict]:
        """Envíos, personas y costo de cada automatización (no eliminada) entre dos fechas (para la Analítica)."""
        from ..campanas.segmentos import COSTOS_DEFECTO as C

        d, h = desde or "0000-01-01", hasta or "9999-12-31"
        costo = ("(CASE WHEN e.canales LIKE '%whatsapp%' THEN ? WHEN e.canales LIKE '%sms%' THEN ? ELSE 0 END"
                 " + CASE WHEN e.canales LIKE '%email%' THEN ? ELSE 0 END)")
        with self._lock:
            rows = self._db.execute(
                f"SELECT a.id, a.nombre, a.tipo, a.activa, COUNT(e.id) AS envios, COUNT(DISTINCT e.cliente_id) AS personas, "
                f"COALESCE(SUM({costo}), 0) AS costo FROM automatizacion a "
                f"LEFT JOIN automatizacion_envio e ON e.automatizacion_id = a.id AND e.fecha BETWEEN ? AND ? "
                f"WHERE a.eliminada_en IS NULL GROUP BY a.id ORDER BY envios DESC, a.creada",
                (C["whatsapp"], C["sms"], C["email"], d, h)).fetchall()
        return [{"id": r[0], "nombre": r[1], "tipo": r[2], "activa": bool(r[3]), "envios": r[4], "personas": r[5], "costo": round(r[6])}
                for r in rows]


_alm: AutoAlmacen | None = None


def get_almacen() -> AutoAlmacen:
    global _alm
    s = get_store()
    if _alm is None or _alm._s is not s:
        _alm = AutoAlmacen(s)
    return _alm
