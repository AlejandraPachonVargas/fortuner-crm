"""Cliente LLM agnóstico de proveedor (API compatible con OpenAI: DeepSeek por defecto).

* Un único ``httpx.AsyncClient`` compartido, con reintentos y espera exponencial ante 429/5xx/timeouts.
* Los mensajes de ``LLMError`` son seguros para el cliente: el detalle del proveedor solo va al log.
* Devuelve también el consumo de tokens (``usage``) para que la interfaz muestre cuánto se gasta.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass

import httpx

from ..config import Settings, get_settings

log = logging.getLogger("crm.ai.llm")

_GENERICO = "El servicio de IA no está disponible en este momento. Intente de nuevo en unos segundos."
REINTENTOS = 3
_REINTENTABLES = {408, 425, 429, 500, 502, 503, 504}


class LLMError(RuntimeError):
    def __init__(self, mensaje: str = _GENERICO, *, publico: str | None = None):
        super().__init__(mensaje)
        self.publico = publico or _GENERICO


@dataclass
class Respuesta:
    datos: dict
    tokens_entrada: int = 0
    tokens_salida: int = 0

    @property
    def tokens(self) -> int:
        return self.tokens_entrada + self.tokens_salida


_http: httpx.AsyncClient | None = None
_loop: asyncio.AbstractEventLoop | None = None


def _cliente() -> httpx.AsyncClient:
    global _http, _loop
    loop = asyncio.get_running_loop()
    if _http is None or _http.is_closed or _loop is not loop:
        _http = httpx.AsyncClient(timeout=90, limits=httpx.Limits(max_connections=10, max_keepalive_connections=5))
        _loop = loop
    return _http


async def cerrar_http() -> None:
    global _http, _loop
    cli, _http, _loop = _http, None, None
    if cli is not None and not cli.is_closed:
        try:
            await cli.aclose()
        except Exception:
            log.debug("Error cerrando el cliente HTTP", exc_info=True)


def _espera(n: int) -> float:
    return 0.5 * (2 ** n) * (0.5 + random.random() / 2)


def _parse_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    raise LLMError("El modelo no devolvió JSON válido", publico="La IA devolvió una respuesta que no se pudo interpretar. Intente de nuevo.")


class LLMClient:
    def __init__(self, s: Settings | None = None):
        self.s = s or get_settings()

    @property
    def enabled(self) -> bool:
        return bool(self.s.effective_llm_key)

    async def chat_json(self, messages: list[dict], *, temperature: float = 0.3, max_tokens: int = 2000) -> Respuesta:
        if not self.enabled:
            raise LLMError("LLM sin configurar", publico="La IA no está configurada en el servidor (falta la API key).")
        url = self.s.llm_base_url.rstrip("/") + "/chat/completions"
        payload = {"model": self.s.llm_model, "messages": messages, "temperature": temperature,
                   "max_tokens": max_tokens, "response_format": {"type": "json_object"}}
        headers = {"Authorization": f"Bearer {self.s.effective_llm_key}"}
        r: httpx.Response | None = None
        ultimo: Exception | None = None
        for n in range(REINTENTOS):
            try:
                r = await _cliente().post(url, json=payload, headers=headers, timeout=self.s.llm_timeout_seconds)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                ultimo = e
                log.warning("LLM falló (intento %s/%s): %s", n + 1, REINTENTOS, type(e).__name__)
            else:
                if r.status_code not in _REINTENTABLES or n == REINTENTOS - 1:
                    break
                log.warning("LLM respondió %s (intento %s/%s)", r.status_code, n + 1, REINTENTOS)
            if n < REINTENTOS - 1:
                await asyncio.sleep(_espera(n))
        if r is None:
            log.error("No fue posible contactar el servicio de IA: %r", ultimo)
            raise LLMError("Fallo de red con el servicio de IA")
        if r.status_code != 200:
            log.error("Servicio de IA respondió %s: %s", r.status_code, r.text[:300])
            raise LLMError(f"Servicio de IA respondió {r.status_code}")
        try:
            body = r.json()
            content = body["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            log.error("Respuesta inesperada del servicio de IA: %s", r.text[:300])
            raise LLMError("Respuesta inesperada del servicio de IA") from e
        uso = body.get("usage") or {}
        return Respuesta(_parse_json(content), int(uso.get("prompt_tokens", 0)), int(uso.get("completion_tokens", 0)))
