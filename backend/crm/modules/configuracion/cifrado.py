"""Cifrado de las credenciales de los canales (tokens, contraseñas, API keys) antes de guardarlas en crm.sqlite.

Clave (Fernet = AES-128-CBC + HMAC-SHA256):
1. ``CRM_CIFRADO_CLAVE`` en .env, si existe (recomendado en el servidor: así la base sola no basta para leerlas);
2. si no, ``data/clave_cifrado.key``, que se crea sola la primera vez. Hay que respaldarla junto con crm.sqlite: sin ella
   las credenciales guardadas no se pueden leer y habría que volver a escribirlas en Configuración.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger("crm.configuracion")
_lock = threading.Lock()
_cache: dict[str, Fernet] = {}


class SecretosIlegibles(RuntimeError):
    """Las credenciales guardadas no se pueden descifrar (cambió o se perdió la clave de cifrado)."""


def _clave(data_dir: Path) -> bytes:
    env = os.environ.get("CRM_CIFRADO_CLAVE", "").strip()
    if not env:
        from ...config import get_settings
        env = (get_settings().cifrado_clave or "").strip()   # .env (pydantic no lo pasa a os.environ)
    if env:
        return env.encode()
    archivo = data_dir / "clave_cifrado.key"
    with _lock:
        if not archivo.exists():
            archivo.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(archivo, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(Fernet.generate_key())
            log.warning("Se creó %s para cifrar las credenciales de los canales: respáldelo junto con crm.sqlite.", archivo)
        return archivo.read_bytes().strip()


def _fernet(data_dir: Path) -> Fernet:
    k = _clave(data_dir)
    f = _cache.get(k.decode(errors="ignore"))
    if f is None:
        try:
            f = Fernet(k)
        except ValueError as e:
            raise SecretosIlegibles("CRM_CIFRADO_CLAVE no es una clave válida (debe ser una clave Fernet de 44 caracteres).") from e
        _cache[k.decode(errors="ignore")] = f
    return f


def cifrar(datos: dict, data_dir: Path) -> str:
    return _fernet(data_dir).encrypt(json.dumps(datos, ensure_ascii=False).encode()).decode() if datos else ""


def descifrar(token: str | None, data_dir: Path) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet(data_dir).decrypt(token.encode()))
    except (InvalidToken, ValueError) as e:
        raise SecretosIlegibles("Las credenciales guardadas no se pueden leer: cambió o se perdió la clave de cifrado. "
                                "Vuelva a escribirlas en Configuración.") from e
