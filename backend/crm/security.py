"""Seguridad de la API: autenticación por clave, límite de tasa y cabeceras.

* ``CRM_API_KEY``   → uso normal del CRM (X-API-Key o Authorization: Bearer <clave>).
* ``CRM_ADMIN_KEY`` → además, administración (cargar datos del ERP).
* En producción el servidor NO arranca sin claves. En desarrollo sin claves se permite todo (aviso en el log).
"""

from __future__ import annotations

import hmac
import logging
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from .config import Settings, get_settings

log = logging.getLogger("crm.security")


class ConfiguracionInsegura(RuntimeError):
    """El servidor se niega a arrancar con una configuración insegura."""


def verificar_configuracion(s: Settings) -> None:
    if s.api_key or s.admin_key:
        if s.is_production and not s.admin_key:
            log.warning("CRM_ADMIN_KEY no está definida: la carga de datos desde el ERP queda deshabilitada.")
        return
    if s.is_production:
        raise ConfiguracionInsegura(
            "CRM_ENV=production exige autenticación: defina CRM_API_KEY y CRM_ADMIN_KEY en .env. "
            'Genere una con: python -c "import secrets; print(secrets.token_urlsafe(32))"')
    log.warning("SIN AUTENTICACIÓN (modo %s): solo para desarrollo local.", s.environment)


def _clave(request: Request) -> str | None:
    k = request.headers.get("x-api-key")
    if k:
        return k.strip()
    auth = request.headers.get("authorization", "")
    return auth[7:].strip() if auth[:7].lower() == "bearer " else None


def _igual(dada: str | None, esperada: str) -> bool:
    return bool(dada) and bool(esperada) and hmac.compare_digest(dada.encode(), esperada.encode())


def _rol(request: Request, s: Settings) -> str | None:
    if not s.api_key and not s.admin_key:
        return None if s.is_production else "abierto"
    dada = _clave(request)
    if _igual(dada, s.admin_key):
        return "admin"
    if _igual(dada, s.api_key):
        return "lectura"
    return None


async def require_api_key(request: Request) -> None:
    rol = _rol(request, get_settings())
    if rol is None:
        raise HTTPException(401, "Falta o es inválida la clave de acceso.", headers={"WWW-Authenticate": "Bearer"})
    request.state.rol = rol


async def require_admin(request: Request) -> None:
    rol = _rol(request, get_settings())
    if rol is None:
        raise HTTPException(401, "Falta o es inválida la clave de acceso.", headers={"WWW-Authenticate": "Bearer"})
    if rol not in ("admin", "abierto"):
        raise HTTPException(403, "Esta operación requiere la clave de administración.")
    request.state.rol = rol


# ----------------------------------------------------------------- límite de tasa (ventana deslizante)
class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> None:
        if limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(429, "Demasiadas solicitudes a la IA. Espere un momento.",
                                    headers={"Retry-After": str(int(window))})
            q.append(now)
            if len(self._hits) > 5000:  # evita crecer sin límite con IPs distintas
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > window]:
                    self._hits.pop(k, None)


_limiter = RateLimiter()


async def limitar_ia(request: Request) -> None:
    ip = request.client.host if request.client else "?"
    _limiter.check(f"ia:{ip}", get_settings().ia_rate_limit)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
}
