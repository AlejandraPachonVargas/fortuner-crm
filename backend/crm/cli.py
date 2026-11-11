"""Línea de comandos: ``crm probar-ads``, ``crm etl``, ``crm modelo``, ``crm servir``."""

from __future__ import annotations

import logging

import typer

from .config import get_settings

app = typer.Typer(help="FORTUNER CRM", no_args_is_help=True)


def _log() -> None:
    logging.basicConfig(level=get_settings().log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@app.command("probar-ads")
def probar_ads() -> None:
    """Prueba la conexión (solo lectura) con ADVANTAGE / Publidata."""
    _log()
    from .etl.ads import probar_conexion

    typer.echo(probar_conexion(get_settings()))


@app.command("etl")
def etl(full: bool = typer.Option(False, help="Carga completa (histórico)"),
        meses: int = typer.Option(0, help="Meses de historia (0 = CRM_ETL_MESES)")) -> None:
    """Extrae del ERP y reconstruye el modelo analítico."""
    _log()
    from .etl import pipeline

    typer.echo(pipeline.ejecutar(full=full, meses=meses or None))


@app.command("modelo")
def modelo() -> None:
    """Reconstruye solo el modelo analítico desde el staging ya extraído (sin tocar el ERP)."""
    _log()
    from .etl import pipeline

    typer.echo(str(pipeline.construir_warehouse(get_settings())))


@app.command("servir")
def servir(reload: bool = False) -> None:
    """Levanta la API (y la SPA si frontend/dist existe)."""
    import uvicorn

    s = get_settings()
    uvicorn.run("crm.api:app", host=s.host, port=s.port, reload=reload, log_level=s.log_level.lower())
