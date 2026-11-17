"""Piezas compartidas por los tableros: caché, fecha de corte, rangos y redondeo.

Los tableros solo devuelven CONTEOS y SUMAS: nunca nombres, documentos ni datos de contacto. Así cualquier rol puede
verlos sin exponer datos personales (Ley 1581).
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date
from typing import Any, Callable

from ...warehouse import WarehouseNoDisponible, get_warehouse

TTL_SEGUNDOS = 300
_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
_en_curso: dict[str, threading.Lock] = {}


def en_cache(clave: dict, calcular: Callable[[], Any]) -> Any:
    """Cachea el tablero 5 minutos por combinación de filtros y versión de los datos. Si dos personas piden lo mismo a la
    vez, se calcula una sola vez (la segunda espera el resultado de la primera)."""
    k = json.dumps(clave, sort_keys=True, default=str)
    ahora = time.monotonic()
    with _cache_lock:
        hit = _cache.get(k)
        if hit and ahora - hit[0] < TTL_SEGUNDOS:
            return hit[1]
        lock = _en_curso.setdefault(k, threading.Lock())
    with lock:
        try:
            with _cache_lock:
                hit = _cache.get(k)
                if hit and time.monotonic() - hit[0] < TTL_SEGUNDOS:
                    return hit[1]
            valor = calcular()
            with _cache_lock:
                if len(_cache) > 200:   # tope de memoria: se descarta lo más viejo
                    for viejo in sorted(_cache, key=lambda x: _cache[x][0])[:100]:
                        _cache.pop(viejo, None)
                _cache[k] = (time.monotonic(), valor)
            return valor
        finally:
            with _cache_lock:
                _en_curso.pop(k, None)


def limpiar_cache() -> None:
    with _cache_lock:
        _cache.clear()


def meta_warehouse() -> dict:
    """Fecha de corte (último día con ventas completas), rango de los datos y versión del warehouse."""
    wh = get_warehouse()
    try:
        m = wh.query("SELECT * FROM meta")[0]
    except WarehouseNoDisponible:
        raise
    corte = m.get("corte") or m.get("fecha_max")
    return {"version": wh.version(), "corte": corte, "desde": m.get("fecha_min"), "construido": m.get("construido")}


def iso(v) -> str | None:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v is not None else None)


def r2(v, nd: int = 2):
    try:
        return None if v is None else round(float(v), nd)
    except (TypeError, ValueError):
        return None


def entero(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def pct(parte, total, nd: int = 1) -> float | None:
    return round(100.0 * float(parte or 0) / float(total), nd) if total else None


def mes_label(d: date | str) -> str:
    s = iso(d) or ""
    return s[:7]
