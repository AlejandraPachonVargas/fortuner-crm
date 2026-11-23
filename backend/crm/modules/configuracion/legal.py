"""Cumplimiento legal: cancelación de suscripción (bajas) y Registro de Números Excluidos (RNE) de la CRC.

* **Bajas.** Cada correo lleva un enlace «Cancelar suscripción» con un token cifrado (no lleva la cédula a la vista).
  Al confirmarlo, el cliente queda excluido de ese canal en el CRM al instante y, si la escritura en el ERP está
  habilitada, se marca también en POSCLI (INFOELEC/INFOTEX/INFOWAS = false).
* **RNE.** La CRC no ofrece una API pública: la empresa se inscribe en www.tramitescrcom.gov.co y consulta el listado.
  Aquí se importa el archivo descargado (los teléfonos y correos que contenga). La lista se aplica a los canales
  elegidos en Configuración y tiene una antigüedad máxima: vencida, esos canales se bloquean hasta actualizarla.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime

from cryptography.fernet import InvalidToken

from ...config import get_settings
from ...store import Store, get_store
from .cifrado import _fernet

log = logging.getLogger("crm.configuracion.legal")

DDL = """
-- Bajas de suscripción por canal (por documento del cliente). Se aplican aunque el ERP no se haya podido actualizar.
CREATE TABLE IF NOT EXISTS baja_canal (
    documento   TEXT NOT NULL,
    canal       TEXT NOT NULL,
    fecha       TEXT NOT NULL,
    origen      TEXT,
    erp         TEXT,            -- 'ok' si también quedó en POSCLI; si no, el motivo
    PRIMARY KEY (documento, canal)
);
-- Lista del RNE importada (la última reemplaza a la anterior). tipo = tel | email.
CREATE TABLE IF NOT EXISTS rne_registro (
    valor TEXT NOT NULL,
    tipo  TEXT NOT NULL,
    PRIMARY KEY (valor, tipo)
);
"""

CANALES_BAJA = ("email", "sms", "whatsapp")
_CEL = re.compile(r"(?<!\d)(?:\+?57[\s-]?)?(3\d{2})[\s-]?(\d{3})[\s-]?(\d{4})(?!\d)")
_FIJO = re.compile(r"(?<!\d)(?:\+?57[\s-]?)?(60\d)[\s-]?(\d{3})[\s-]?(\d{4})(?!\d)")
_MAIL = re.compile(r"[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,255}\.[A-Za-z]{2,}")


def tel10(v: str | None) -> str:
    """Celular normalizado a 10 dígitos (sin el 57)."""
    d = re.sub(r"\D", "", v or "")
    if len(d) == 12 and d.startswith("57"):
        d = d[2:]
    return d if len(d) == 10 else ""


class Legal:
    def __init__(self, store: Store, data_dir) -> None:
        self.store, self.data_dir = store, data_dir
        with store._lock:
            store._db.executescript(DDL)

    # ------------------------------------------------------------------------------------------ bajas
    def token_baja(self, documento: str, canal: str = "email") -> str:
        return _fernet(self.data_dir).encrypt(json.dumps({"d": documento, "c": canal}).encode()).decode()

    def leer_token(self, token: str) -> tuple[str, str]:
        try:
            d = json.loads(_fernet(self.data_dir).decrypt((token or "").encode()))
        except (InvalidToken, ValueError, TypeError):
            raise ValueError("El enlace no es válido o está incompleto.") from None
        if d.get("c") not in CANALES_BAJA or not d.get("d"):
            raise ValueError("El enlace no es válido.")
        return str(d["d"]), d["c"]

    def registrar_baja(self, documento: str, canal: str, origen: str) -> dict:
        erp = _baja_en_erp(documento, canal)
        with self.store._lock:
            self.store._db.execute("INSERT INTO baja_canal (documento, canal, fecha, origen, erp) VALUES (?,?,?,?,?) "
                                   "ON CONFLICT (documento, canal) DO UPDATE SET fecha=excluded.fecha, erp=excluded.erp",
                                   (documento, canal, datetime.now().isoformat(timespec="seconds"), origen[:100], erp))
        self.store.auditar("baja_suscripcion", None, f"canal {canal} · ERP: {erp}", origen[:100])
        return {"canal": canal, "erp": erp}

    def bajas(self) -> dict[str, frozenset[str]]:
        with self.store._lock:
            filas = self.store._db.execute("SELECT documento, canal FROM baja_canal").fetchall()
        out: dict[str, set] = {}
        for d, c in filas:
            out.setdefault(d, set()).add(c)
        return {d: frozenset(c) for d, c in out.items()}

    def resumen_bajas(self, n: int = 20) -> dict:
        with self.store._lock:
            total = dict(self.store._db.execute("SELECT canal, COUNT(*) FROM baja_canal GROUP BY canal").fetchall())
            ult = self.store._db.execute("SELECT documento, canal, fecha, erp FROM baja_canal ORDER BY fecha DESC LIMIT ?", (n,)).fetchall()
        return {"por_canal": total, "ultimas": [{"documento": f"***{d[-4:]}", "canal": c, "fecha": f, "erp": e} for d, c, f, e in ult]}

    # ------------------------------------------------------------------------------------------ RNE
    def importar_rne(self, texto: str, origen: str) -> dict:
        tels = {a + b + c for a, b, c in _CEL.findall(texto)} | {a + b + c for a, b, c in _FIJO.findall(texto)}
        mails = {m.lower() for m in _MAIL.findall(texto)}
        if not tels and not mails:
            raise ValueError("El archivo no tiene teléfonos ni correos reconocibles.")
        ahora = datetime.now().isoformat(timespec="seconds")
        with self.store._lock:
            with self.store._db:
                self.store._db.execute("DELETE FROM rne_registro")
                self.store._db.executemany("INSERT OR IGNORE INTO rne_registro (valor, tipo) VALUES (?, 'tel')", [(t,) for t in tels])
                self.store._db.executemany("INSERT OR IGNORE INTO rne_registro (valor, tipo) VALUES (?, 'email')", [(m,) for m in mails])
        from .general import get_general
        get_general().fijar_interno("rne", {"fecha": ahora, "telefonos": len(tels), "correos": len(mails), "por": origen[:100]})
        self.store.auditar("rne_importado", None, f"{len(tels)} teléfonos, {len(mails)} correos", origen[:100])
        return self.estado_rne()

    def estado_rne(self) -> dict:
        from .general import get_general
        g = get_general()
        cfg = g.seccion("legal")
        info = g.interno("rne") or {}
        dias = None
        if info.get("fecha"):
            dias = (datetime.now() - datetime.fromisoformat(info["fecha"])).days
        vencida = bool(cfg["rne_activo"]) and (dias is None or dias > int(cfg["rne_max_dias"]))
        return {"activo": bool(cfg["rne_activo"]), "canales": cfg["rne_canales"], "max_dias": cfg["rne_max_dias"],
                "fecha": info.get("fecha"), "dias": dias, "telefonos": info.get("telefonos", 0), "correos": info.get("correos", 0),
                "vencida": vencida, "exentos_autorizados": bool(cfg["rne_exentos_autorizados"])}

    def en_rne(self, valor: str) -> bool:
        t = tel10(valor)
        v, tipo = (t, "tel") if t else ((valor or "").strip().lower(), "email")
        with self.store._lock:
            return self.store._db.execute("SELECT 1 FROM rne_registro WHERE valor=? AND tipo=?", (v, tipo)).fetchone() is not None

    def lista_rne(self) -> tuple[set[str], set[str]]:
        with self.store._lock:
            filas = self.store._db.execute("SELECT valor, tipo FROM rne_registro").fetchall()
        return {v for v, t in filas if t == "tel"}, {v for v, t in filas if t == "email"}


def _baja_en_erp(documento: str, canal: str) -> str:
    """Marca el canal como NO autorizado en todas las fichas del cliente en POSCLI (si la escritura está habilitada)."""
    if not get_settings().clientes_escritura:
        return "pendiente: escritura en el ERP deshabilitada"
    campo = {"email": "autorizaEmail", "sms": "autorizaSms", "whatsapp": "autorizaWhatsapp"}[canal]
    try:
        from ..clientes import servicio
        from ..clientes.indice import get_indice
        ids = [r["id"] for r in get_indice().query("SELECT id FROM cli WHERE documento = ?", [documento])]
        for cid in ids:
            servicio.actualizar(cid, {campo: False}, None, servicio.Actor("baja-suscripcion", "admin"), accion="baja")
        return "ok" if ids else "pendiente: cliente no encontrado en el ERP"
    except Exception as e:   # la baja igual queda en el CRM y se respeta
        log.warning("No se pudo reflejar la baja en el ERP: %s", type(e).__name__)
        return f"pendiente: {type(e).__name__}"


_inst: Legal | None = None


def get_legal() -> Legal:
    global _inst
    store = get_store()
    if _inst is None or _inst.store is not store:
        _inst = Legal(store, get_settings().data_dir)
    return _inst


def exclusiones(filas: list[dict]) -> dict[str, frozenset[str]]:
    """Canales excluidos por bajas y por el RNE para cada documento.

    ``filas`` = [{documento, celulares: [...], correos: [...], autoriza: bool}] (del índice de clientes).
    Falla cerrada: si algo no se puede leer, el error sube y no se envía.
    """
    lg = get_legal()
    out: dict[str, set] = {d: set(c) for d, c in lg.bajas().items()}
    est = lg.estado_rne()
    if est["activo"]:
        tels, mails = lg.lista_rne()
        canales_tel = [c for c in est["canales"] if c in ("whatsapp", "sms")]
        canal_mail = "email" in est["canales"]
        for f in filas:
            if est["exentos_autorizados"] and f.get("autoriza"):
                continue
            ch = set()
            if canales_tel and any(tel10(t) in tels for t in f.get("celulares") or []):
                ch.update(canales_tel)
            if canal_mail and any((m or "").lower() in mails for m in f.get("correos") or []):
                ch.add("email")
            if ch:
                out.setdefault(f["documento"], set()).update(ch)
    return {d: frozenset(c) for d, c in out.items()}
