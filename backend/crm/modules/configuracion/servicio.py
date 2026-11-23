"""Configuración de canales guardada en crm.sqlite (tabla ``configuracion_canal``).

* Los datos normales (ids, servidor, remitente, costo…) se guardan como JSON.
* Los secretos (tokens, contraseñas, API keys) se guardan CIFRADOS y nunca se devuelven a la pantalla: solo se informa
  si están guardados y sus últimos 4 caracteres.
* Un canal está **disponible** para campañas y automatizaciones solo si está activo y tiene todos los campos obligatorios.
* Cada cambio queda en la bitácora de auditoría con quién y qué campos cambiaron (nunca los valores).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from ...config import get_settings
from ...store import Store, get_store
from . import catalogo as cat
from .cifrado import SecretosIlegibles, cifrar, descifrar

log = logging.getLogger("crm.configuracion")

DDL = """
-- Configuración de los canales de difusión. secretos = JSON cifrado (Fernet). plantillas = plantillas aprobadas de Meta.
CREATE TABLE IF NOT EXISTS configuracion_canal (
    canal           TEXT PRIMARY KEY,
    proveedor       TEXT NOT NULL,
    activo          INTEGER NOT NULL DEFAULT 1,
    datos           TEXT NOT NULL DEFAULT '{}',
    secretos        TEXT NOT NULL DEFAULT '',
    plantillas      TEXT NOT NULL DEFAULT '[]',
    actualizado     TEXT,
    actualizado_por TEXT,
    prueba_ts       TEXT,
    prueba_ok       INTEGER,
    prueba_detalle  TEXT
);
"""


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _final(v: str) -> str:
    return f"…{v[-4:]}" if len(v) >= 8 else "…"


class Configuracion:
    def __init__(self, store: Store, data_dir) -> None:
        self.store = store
        self.data_dir = data_dir
        with store._lock:
            store._db.executescript(DDL)

    # ------------------------------------------------------------------------------------------ lectura
    def _fila(self, canal: str) -> dict | None:
        with self.store._lock:
            r = self.store._db.execute("SELECT * FROM configuracion_canal WHERE canal = ?", (canal,)).fetchone()
        return dict(r) if r else None

    def _secretos(self, fila: dict | None) -> tuple[dict, str | None]:
        if not fila:
            return {}, None
        try:
            return descifrar(fila["secretos"], self.data_dir), None
        except SecretosIlegibles as e:
            return {}, str(e)

    def faltantes(self, canal: str, fila: dict | None = None, secretos: dict | None = None) -> list[str]:
        fila = fila if fila is not None else self._fila(canal)
        if not fila or not cat.proveedor_valido(canal, fila["proveedor"]):
            return ["Elegir el proveedor y llenar sus datos"]
        datos = json.loads(fila["datos"] or "{}")
        if secretos is None:
            secretos, _ = self._secretos(fila)
        out = []
        for c in cat.campos(canal, fila["proveedor"]):
            if not c["requerido"]:
                continue
            v = secretos.get(c["clave"]) if c["tipo"] == "secreto" else datos.get(c["clave"])
            if v in (None, "", []):
                out.append(c["etiqueta"])
        return out

    def estado(self, canal: str) -> dict:
        fila = self._fila(canal)
        secretos, error = self._secretos(fila)
        falt = self.faltantes(canal, fila, secretos)
        base = {"canal": canal, "nombre": cat.NOMBRE_CANAL[canal], "proveedor": None, "activo": False, "datos": {},
                "secretos": {}, "faltantes": falt, "configurado": False, "disponible": False, "error_secretos": error,
                "plantillas": [], "actualizado": None, "actualizado_por": None, "prueba": None}
        if not fila:
            return base
        datos = json.loads(fila["datos"] or "{}")
        sec = {}
        if cat.proveedor_valido(canal, fila["proveedor"]):
            for c in cat.campos(canal, fila["proveedor"]):
                if c["tipo"] == "secreto":
                    v = secretos.get(c["clave"])
                    sec[c["clave"]] = {"guardado": bool(v), "final": _final(v) if v else None}
        configurado = not falt and not error
        return {**base, "proveedor": fila["proveedor"], "activo": bool(fila["activo"]), "datos": datos, "secretos": sec,
                "configurado": configurado, "disponible": configurado and bool(fila["activo"]),
                "plantillas": json.loads(fila["plantillas"] or "[]"), "actualizado": fila["actualizado"],
                "actualizado_por": fila["actualizado_por"],
                "prueba": {"fecha": fila["prueba_ts"], "ok": bool(fila["prueba_ok"]), "detalle": fila["prueba_detalle"]}
                if fila["prueba_ts"] else None}

    def todos(self) -> list[dict]:
        return [self.estado(c) for c in cat.CANALES]

    def disponibles(self) -> set[str]:
        out = set()
        for c in cat.CANALES:
            fila = self._fila(c)
            if fila and fila["activo"] and not self._secretos(fila)[1] and not self.faltantes(c, fila):
                out.add(c)
        return out

    def credenciales(self, canal: str) -> tuple[str, dict, dict]:
        """(proveedor, datos, secretos) para probar la conexión o enviar. Solo para uso interno del servidor."""
        fila = self._fila(canal)
        if not fila:
            raise ValueError(f"El canal {cat.NOMBRE_CANAL[canal]} no está configurado.")
        secretos, error = self._secretos(fila)
        if error:
            raise ValueError(error)
        return fila["proveedor"], json.loads(fila["datos"] or "{}"), secretos

    def costos(self) -> dict[str, float]:
        out = dict(cat.COSTO_DEFECTO)
        with self.store._lock:
            filas = self.store._db.execute("SELECT canal, datos FROM configuracion_canal").fetchall()
        for canal, datos in filas:
            v = json.loads(datos or "{}").get("costo_mensaje")
            if isinstance(v, (int, float)) and canal in out:
                out[canal] = float(v)
        return out

    # ------------------------------------------------------------------------------------------ escritura
    def guardar(self, canal: str, proveedor: str, datos: dict, secretos_nuevos: dict, borrar: list[str], activo: bool,
                origen: str) -> dict:
        if canal not in cat.CANALES:
            raise ValueError("Canal desconocido.")
        if not cat.proveedor_valido(canal, proveedor):
            raise ValueError("Proveedor no válido para este canal.")
        campos = cat.campos(canal, proveedor)
        fila = self._fila(canal)
        previos_datos = json.loads(fila["datos"]) if fila else {}
        previos_sec, error = self._secretos(fila)
        if error or (fila and fila["proveedor"] != proveedor):
            previos_sec = {}                              # otro proveedor: sus credenciales no sirven
        limpios, sec = {}, {}
        for c in campos:
            k = c["clave"]
            if c["tipo"] == "secreto":
                v = (secretos_nuevos or {}).get(k)
                if isinstance(v, str) and v.strip():
                    if len(v.strip()) > 4000:
                        raise ValueError(f"«{c['etiqueta']}» es demasiado largo.")
                    sec[k] = v.strip()
                elif k in previos_sec and k not in (borrar or []):
                    sec[k] = previos_sec[k]
                continue
            v = c["defecto"] if c["fijo"] else (datos or {}).get(k)
            v = cat.validar_valor(c, v)
            if v is not None:
                limpios[k] = v
        cambios = sorted({k for k in limpios if limpios.get(k) != previos_datos.get(k)}
                         | {k for k in previos_datos if k not in limpios}
                         | {k for k in sec if sec.get(k) != previos_sec.get(k)} | {k for k in previos_sec if k not in sec})
        credencial_cambio = bool(set(cambios) - {"costo_mensaje", "limite_diario", "remitente_nombre", "responder_a"}) \
            or (fila is not None and fila["proveedor"] != proveedor)
        quien = origen[:200]
        with self.store._lock:
            self.store._db.execute(
                "INSERT INTO configuracion_canal (canal, proveedor, activo, datos, secretos, actualizado, actualizado_por) "
                "VALUES (?,?,?,?,?,?,?) ON CONFLICT (canal) DO UPDATE SET proveedor=excluded.proveedor, activo=excluded.activo, "
                "datos=excluded.datos, secretos=excluded.secretos, actualizado=excluded.actualizado, "
                "actualizado_por=excluded.actualizado_por",
                (canal, proveedor, int(bool(activo)), json.dumps(limpios, ensure_ascii=False), cifrar(sec, self.data_dir),
                 _ahora(), quien))
            if credencial_cambio:   # la prueba anterior ya no dice nada de los datos nuevos
                self.store._db.execute("UPDATE configuracion_canal SET prueba_ts=NULL, prueba_ok=NULL, prueba_detalle=NULL "
                                       "WHERE canal=?", (canal,))
        self.store.auditar("configuracion", None, f"{canal} · {proveedor} · {'activo' if activo else 'inactivo'} · "
                                                  f"campos cambiados: {', '.join(cambios) or 'ninguno'}", quien)
        return self.estado(canal)

    def registrar_prueba(self, canal: str, ok: bool, detalle: str) -> None:
        with self.store._lock:
            self.store._db.execute("UPDATE configuracion_canal SET prueba_ts=?, prueba_ok=?, prueba_detalle=? WHERE canal=?",
                                   (_ahora(), int(ok), detalle[:500], canal))

    def guardar_plantillas(self, canal: str, plantillas: list[dict]) -> None:
        with self.store._lock:
            self.store._db.execute("UPDATE configuracion_canal SET plantillas=? WHERE canal=?",
                                   (json.dumps(plantillas[:500], ensure_ascii=False), canal))


_inst: Configuracion | None = None


def get_configuracion() -> Configuracion:
    global _inst
    store = get_store()
    if _inst is None or _inst.store is not store:   # se ata a la base actual (en las pruebas cambia entre casos)
        _inst = Configuracion(store, get_settings().data_dir)
    return _inst


def modo_desarrollo() -> bool:
    """TEMPORAL (mientras se desarrolla el CRM y los envíos son simulados): con el modo desarrollo encendido, los canales
    sin configurar o desactivados se pueden usar igual. Apagado, rige la regla normal. Se cambia en Configuración › Canales."""
    try:
        from .general import get_general
        return bool(get_general().interno("modo_desarrollo"))
    except Exception:
        return False


def motivos_bloqueo() -> dict[str, str | None]:
    """Por qué NO se puede usar cada canal ahora (None = se puede): sin configurar o desactivado, tope mensual agotado,
    o lista del RNE vencida (si el RNE está activo y cubre el canal). Falla cerrada ante cualquier error."""
    try:
        cfg = get_configuracion()
        ok = cfg.disponibles() | (set(cat.CANALES) if modo_desarrollo() else set())
        out: dict[str, str | None] = {}
        for c in cat.CANALES:
            e = cfg._fila(c)
            out[c] = None if c in ok else ("Desactivado en Configuración" if e and e["activo"] is not None and not e["activo"]
                                            and not cfg.faltantes(c, e) else "Sin configurar en Configuración")
        from .legal import get_legal
        from .presupuesto import consumo
        rne = get_legal().estado_rne()
        con = consumo()["canales"]
        for c in cat.CANALES:
            if out[c]:
                continue
            if con[c]["agotado"]:
                out[c] = "Tope mensual de presupuesto alcanzado"
            elif rne["vencida"] and c in rne["canales"]:
                out[c] = "La lista del RNE está desactualizada (Configuración › Legal)"
        return out
    except Exception:
        log.exception("No se pudo leer la configuración de canales")
        return {c: "No se pudo verificar la configuración" for c in cat.CANALES}


def canales_disponibles() -> set[str]:
    return {c for c, m in motivos_bloqueo().items() if m is None}


def costos_por_mensaje() -> dict[str, float]:
    try:
        return get_configuracion().costos()
    except Exception:
        return dict(cat.COSTO_DEFECTO)
