"""Programación de la publicación y grupo de control.

* La fecha/hora programada se interpreta en la **hora del servidor** (en un servidor Windows en Colombia es la hora
  local). Se guarda sin zona horaria, en ISO (``2026-11-14T16:30:00``).
* El grupo de control es una muestra aleatoria *estable* de la audiencia a la que NO se le envía nada: al comparar
  después sus compras con las de quienes sí recibieron el mensaje se mide el efecto real de la campaña (incrementalidad).
  La selección usa un hash del par campaña+cliente: es repetible, no depende del puntaje y no se puede «manipular».
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

MIN_ANTICIPACION = timedelta(minutes=2)
MAX_ANTICIPACION = timedelta(days=365)

# Ventana de contacto comercial por SMS/llamada: Resolución CRC 5111 de 2017 (L–V 7:00–19:00; sáb., dom. y festivos
# 8:00–15:00). No se bloquea (los festivos no se conocen aquí): se avisa para que el equipo lo confirme.
_VENTANA_SEMANA = (7, 19)
_VENTANA_FIN_SEMANA = (8, 15)


class FechaInvalida(ValueError):
    pass


def parsear(texto: str, ahora: datetime | None = None) -> datetime:
    """Convierte el texto del formulario en la hora local del servidor (sin zona) y valida que sea futura."""
    ahora = ahora or datetime.now()
    try:
        d = datetime.fromisoformat(texto.strip())
    except (ValueError, AttributeError):
        raise FechaInvalida("La fecha y hora de programación no es válida.") from None
    if d.tzinfo is not None:
        d = d.astimezone().replace(tzinfo=None)
    d = d.replace(microsecond=0)
    if d < ahora + MIN_ANTICIPACION:
        raise FechaInvalida("La hora programada debe estar en el futuro (al menos 2 minutos desde ahora).")
    if d > ahora + MAX_ANTICIPACION:
        raise FechaInvalida("No se puede programar con más de un año de anticipación.")
    return d


def en_control(campana_id: str, cliente_id: str, pct: int) -> bool:
    """¿Este cliente cae en el grupo de control? Determinista: mismo resultado cada vez que se calcula."""
    if pct <= 0:
        return False
    h = hashlib.sha256(f"{campana_id}:{cliente_id}".encode()).hexdigest()
    return int(h[:8], 16) % 100 < pct


def avisos_horario(d: datetime, canales: list[str]) -> list[str]:
    """Advertencias (no bloqueantes) sobre el horario elegido."""
    out: list[str] = []
    if "sms" in canales:
        ini, fin = _VENTANA_FIN_SEMANA if d.weekday() >= 5 else _VENTANA_SEMANA
        if not (ini <= d.hour < fin):
            out.append(f"El SMS comercial solo debe enviarse entre {ini}:00 y {fin}:00 ese día (CRC 5111/2017; "
                       "los festivos cuentan como fin de semana). Verifique el horario.")
    if d.hour < 6 or d.hour >= 22:
        out.append("Es una hora poco habitual para que el cliente lea el mensaje: considere una franja de día.")
    return out
