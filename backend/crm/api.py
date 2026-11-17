"""Aplicación FastAPI: API del CRM + (en producción) la SPA compilada, todo en un solo proceso."""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai.llm import LLMClient, LLMError, cerrar_http
from .config import ROOT_DIR, get_settings
from .etl import pipeline
from .modules.analitica.router import router as analitica_router
from .modules.campanas.router import router as campanas_router
from .modules.clientes.router import router as clientes_router
from .security import SECURITY_HEADERS, require_admin, require_api_key, verificar_configuracion
from .store import get_store
from .warehouse import WarehouseNoDisponible, get_warehouse

log = logging.getLogger("crm.api")
DIST = ROOT_DIR / "frontend" / "dist"


def _depurar_vencidas(store) -> bool:
    """Depura los destinatarios de las campañas programadas vencidas. False = no se pudo verificar (no ejecutar)."""
    vencidas = store.vencidas()
    if not vencidas:
        return True
    from .modules.campanas.router import depurar_programada
    from .modules.clientes.consultas import restricciones_contacto
    try:
        r = restricciones_contacto()
    except Exception as e:
        log.warning("Campañas programadas en espera: no se pudo verificar el consentimiento contra el ERP (%s)", e)
        return False
    for c in vencidas:
        filas = store.destinatarios(c["id"])
        nuevas, quitados = depurar_programada(c, filas, r)
        if quitados:
            store.depurar_destinatarios(c["id"], nuevas, quitados, "planificador")
            log.info("Campaña %s: %s destinatario(s) retirados antes de ejecutar", c["id"], quitados)
    return True


async def _planificador(store) -> None:
    """Cada 30 s publica las campañas programadas cuya hora llegó. Al arrancar también publica las que vencieron mientras
    el servidor estaba apagado. Nunca debe morir por un error puntual."""
    while True:
        try:
            # Antes de ejecutar, cada destinatario se vuelve a verificar contra el ERP. Si no se puede verificar (lista de
            # clientes sin cargar), la campaña ESPERA al siguiente ciclo: nunca se ejecuta sin esa verificación.
            if not await asyncio.to_thread(_depurar_vencidas, store):
                await asyncio.sleep(30)
                continue
            for cid in store.ejecutar_programadas():
                log.info("Campaña programada publicada (simulado): %s", cid)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Falló el planificador de campañas")
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    verificar_configuracion(s)
    store = get_store(s)  # crea (y migra) la base de campañas
    planificador = asyncio.create_task(_planificador(store))
    if s.ads_data_directory and s.ads_crm_directory:
        from .modules.clientes.indice import get_indice
        get_indice().recargar_en_segundo_plano()  # ~15 s: la lista de clientes queda lista sin bloquear el arranque
    yield
    planificador.cancel()
    await cerrar_http()
    get_warehouse().cerrar()


_s = get_settings()
app = FastAPI(
    title=_s.app_name, version="0.1.0", lifespan=lifespan,
    docs_url=None if _s.is_production else "/api/docs", redoc_url=None,
    openapi_url=None if _s.is_production else "/api/openapi.json",
)

if _s.cors_list:
    app.add_middleware(CORSMiddleware, allow_origins=_s.cors_list, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Content-Type", "X-API-Key", "Authorization", "X-CRM-Usuario"])
elif not _s.is_production:
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
                       allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Content-Type", "X-API-Key", "Authorization", "X-CRM-Usuario"])


@app.middleware("http")
async def cabeceras(request: Request, call_next):
    resp = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        if k == "Content-Security-Policy" and request.url.path.startswith("/api/docs"):
            continue  # Swagger (solo en desarrollo) carga recursos externos
        resp.headers.setdefault(k, v)
    return resp


@app.exception_handler(WarehouseNoDisponible)
async def _wh_error(_: Request, e: WarehouseNoDisponible):
    return JSONResponse({"detail": str(e), "codigo": "sin_datos"}, status_code=503)


@app.exception_handler(LLMError)
async def _llm_error(_: Request, e: LLMError):
    return JSONResponse({"detail": e.publico, "codigo": "ia"}, status_code=502)


@app.exception_handler(Exception)
async def _error(_: Request, e: Exception):
    log.exception("Error no controlado")
    return JSONResponse({"detail": "Error interno del servidor."}, status_code=500)


@app.get("/api/salud")
async def salud():
    return {"ok": True}


@app.get("/api/sistema/estado", dependencies=[Depends(require_api_key)])
async def estado():
    s = get_settings()
    wh = get_warehouse()
    info: dict = {"datos": wh.disponible(), "ia": LLMClient().enabled, "zona": f"{s.ciudad}, {s.departamento}",
                  "modo": s.environment, "etl": pipeline.estado()}
    if info["datos"]:
        m = wh.query("SELECT construido, hoy, fecha_min, fecha_max FROM meta")[0]
        info["warehouse"] = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in m.items()}
        info["warehouse"]["clientes"] = wh.scalar("SELECT COUNT(*) FROM cliente")
        info["warehouse"]["clientes_con_compras"] = wh.scalar("SELECT COUNT(*) FROM cli_perfil")
        info["warehouse"]["productos"] = wh.scalar("SELECT COUNT(*) FROM producto WHERE activo")
        info["warehouse"]["lineas_venta"] = wh.scalar("SELECT COUNT(*) FROM venta")
    return info


@app.post("/api/sistema/etl", dependencies=[Depends(require_admin)], status_code=202)
async def lanzar_etl(full: bool = False):
    """Lanza la carga desde el ERP en segundo plano (una a la vez)."""
    if pipeline.estado()["corriendo"]:
        raise HTTPException(409, "Ya hay una carga de datos en curso.")

    def _run() -> None:
        try:
            pipeline.ejecutar(full=full)
        except Exception:  # el detalle ya quedó en el log y en el estado
            pass

    threading.Thread(target=_run, name="etl", daemon=True).start()
    return {"iniciada": True}


app.include_router(campanas_router, dependencies=[Depends(require_api_key)])
app.include_router(clientes_router, dependencies=[Depends(require_api_key)])
app.include_router(analitica_router, dependencies=[Depends(require_api_key)])


# --------------------------------------------------------------------------------- SPA (producción)
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{ruta:path}", include_in_schema=False)
    async def spa(ruta: str):
        if ruta.startswith("api/"):
            raise HTTPException(404, "No encontrado.")
        archivo = (DIST / ruta).resolve()
        if ruta and archivo.is_file() and DIST.resolve() in archivo.parents:
            return FileResponse(archivo)
        return FileResponse(DIST / "index.html")
