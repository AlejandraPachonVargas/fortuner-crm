"""Archivos públicos de la empresa: el logo (WebP, conserva la transparencia) y la Política de Tratamiento de Datos (PDF).

Se validan y, en el caso del logo, se vuelven a dibujar (nunca se guarda el archivo tal cual). Se sirven en
``/media/empresa/logo.webp`` y ``/media/legal/politica.pdf`` sin clave: aparecen en los correos y en la página de baja.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

from PIL import Image, ImageOps

MAX_LOGO = 3 * 1024 * 1024
MAX_PDF = 10 * 1024 * 1024


class ArchivoInvalido(ValueError):
    pass


def ruta_logo(data_dir: Path) -> Path:
    return data_dir / "imagenes" / "empresa" / "logo.webp"


def ruta_politica(data_dir: Path) -> Path:
    return data_dir / "legal" / "politica.pdf"


def _atomico(destino: Path, escribir) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    escribir(tmp)
    os.replace(tmp, destino)


def guardar_logo(datos: bytes, data_dir: Path) -> dict:
    if not datos or len(datos) > MAX_LOGO:
        raise ArchivoInvalido("El logo debe pesar menos de 3 MB.")
    try:
        with Image.open(io.BytesIO(datos)) as im:
            if im.format not in ("PNG", "JPEG", "WEBP"):
                raise ArchivoInvalido("Formato no admitido: use PNG (ideal, con fondo transparente), JPG o WebP.")
            if im.width * im.height > 25_000_000:
                raise ArchivoInvalido("La imagen es demasiado grande.")
            im.load()
            im = ImageOps.exif_transpose(im).convert("RGBA")
    except ArchivoInvalido:
        raise
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as e:
        raise ArchivoInvalido("El archivo no es una imagen válida.") from e
    im.thumbnail((600, 300), Image.Resampling.LANCZOS)
    _atomico(ruta_logo(data_dir), lambda p: im.save(p, "WEBP", quality=90, method=4))
    return {"ancho": im.width, "alto": im.height}


def guardar_politica(datos: bytes, data_dir: Path) -> dict:
    if not datos or len(datos) > MAX_PDF:
        raise ArchivoInvalido("El PDF debe pesar menos de 10 MB.")
    if not datos.startswith(b"%PDF-"):
        raise ArchivoInvalido("El archivo no es un PDF.")
    _atomico(ruta_politica(data_dir), lambda p: p.write_bytes(datos))
    return {"bytes": len(datos)}
