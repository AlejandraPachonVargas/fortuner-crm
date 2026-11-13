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


clientes = typer.Typer(help="Clientes 360°: diccionario propio del CRM (tablas CRM_*) y catálogos de GANAPTOS")
app.add_typer(clientes, name="clientes")


@clientes.command("instalar")
def clientes_instalar(migrar: bool = typer.Option(True, help="Sembrar clubes, mascotas y vehículos desde POSCLI (una sola vez)")) -> None:
    """Crea (si faltan) el diccionario del CRM, sus tablas e índices, y hace la migración inicial desde POSCLI.
    Idempotente: se puede ejecutar varias veces. No modifica PUBLIDATA ni la estructura de ninguna tabla del ERP."""
    _log()
    import json

    from .modules.clientes import esquema

    typer.echo(json.dumps(esquema.instalar(get_settings(), migrar=migrar), ensure_ascii=False, indent=2, default=str))


@clientes.command("estado")
def clientes_estado() -> None:
    """Muestra si el diccionario del CRM existe, sus tablas y cuántos registros tiene cada una."""
    _log()
    import json

    from .modules.clientes import esquema

    typer.echo(json.dumps(esquema.estado(get_settings()), ensure_ascii=False, indent=2, default=str))


@clientes.command("verificar")
def clientes_verificar(escritura: bool = typer.Option(False, help="Además crea, edita y elimina un cliente de prueba en POSCLI (requiere CRM_CLIENTES_ESCRITURA=true)")) -> None:
    """Revisión de salud en este servidor: ERP, versión de Advantage, catálogos, diccionario del CRM, ventas e índice."""
    logging.basicConfig(level="WARNING")
    from .modules.clientes import verificacion

    inf = verificacion.verificar(escritura=escritura, s=get_settings())
    typer.echo(verificacion.imprimir(inf))
    raise typer.Exit(1 if inf.fallas else 0)


@app.command("servir")
def servir(reload: bool = False) -> None:
    """Levanta la API (y la SPA si frontend/dist existe)."""
    import uvicorn

    s = get_settings()
    uvicorn.run("crm.api:app", host=s.host, port=s.port, reload=reload, log_level=s.log_level.lower())
