"""``crm clientes verificar``: revisión de salud de Clientes 360° en el servidor donde se instala.

Pensado para el primer día en producción: confirma, con mensajes en español, que todo lo que se probó en la copia también
funciona en ese servidor (versión de Advantage, rutas, permisos, catálogos, diccionario del CRM, ventas).

* Sin ``--escritura``: **solo lectura**. Lo único que escribe es una fila de prueba en una tabla del CRM dentro de una
  transacción que se deshace (para confirmar que el servidor maneja transacciones y LASTAUTOINC).
* Con ``--escritura``: además crea un cliente de prueba en POSCLI (documento ``9900000077``), lo edita, le agrega una
  mascota, verifica que la caja lo vería y lo elimina. Todo queda en CRM_AUDITORIA.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date

from ...config import Settings, get_settings
from . import conexion, esquema
from .mapeo import txt

DOC_PRUEBA = "9900000077"


@dataclass
class Informe:
    filas: list[tuple[str, str, str]] = field(default_factory=list)  # (estado, prueba, detalle)

    def ok(self, prueba: str, detalle: str = "") -> None:
        self.filas.append(("OK", prueba, detalle))

    def aviso(self, prueba: str, detalle: str) -> None:
        self.filas.append(("AVISO", prueba, detalle))

    def falla(self, prueba: str, detalle: str) -> None:
        self.filas.append(("FALLA", prueba, detalle))

    @property
    def fallas(self) -> int:
        return sum(1 for f in self.filas if f[0] == "FALLA")


def _paso(inf: Informe, nombre: str, fn) -> object | None:
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 - se informa, no se interrumpe la verificación
        inf.falla(nombre, f"{type(e).__name__}: {str(e)[:300]}")
        return None


def verificar(escritura: bool = False, s: Settings | None = None) -> Informe:
    s = s or get_settings()
    inf = Informe()

    # 1) configuración
    cfg = conexion.configurado(s)
    for k, v in cfg.items():
        (inf.ok if v else inf.falla)(f"Configuración: {k}", "definido en .env" if v else "falta en .env")
    if s.is_production and not (s.api_key and s.admin_key):
        inf.falla("Configuración: claves", "CRM_ENV=production exige CRM_API_KEY y CRM_ADMIN_KEY")
    inf.ok("Interruptor de escritura", "CRM_CLIENTES_ESCRITURA=" + ("true (se puede editar)" if s.clientes_escritura else "false (solo lectura)"))

    # 2) ERP
    def erp():
        with conexion.erp(s=s) as con:
            n = int(conexion.filas(con, "SELECT COUNT(*) AS N FROM POSCLI")[0]["N"])
            ult = conexion.filas(con, "SELECT MAX(FECHAI) AS A, MAX(FECHAMOD) AS M FROM POSCLI")[0]
            r = conexion.filas(con, "SELECT TOP 1 ROWID AS R, CODCLI FROM POSCLI WHERE CODCLI <> ''")[0]
            r2 = conexion.filas(con, "SELECT CODCLI FROM POSCLI WHERE ROWID = ?", (txt(r["R"]),))
            try:
                ver = conexion.filas(con, "EXECUTE PROCEDURE sp_mgGetInstallInfo()")
                ver = txt(ver[0].get("Version") or ver[0].get("VERSION")) if ver else "?"
            except Exception:
                ver = "no disponible"
        inf.ok("ERP: lectura de POSCLI", f"{n:,} clientes".replace(",", "."))
        inf.ok("ERP: versión de Advantage", ver)
        (inf.ok if r2 and txt(r2[0]["CODCLI"]) == txt(r["CODCLI"]) else inf.falla)("ERP: ubicar una fila exacta (ROWID)", "funciona" if r2 else "no devolvió la fila")
        try:
            a, m = int(float(ult["A"] or 0)), int(float(ult["M"] or 0))
            ultima = max(a, m)
            dias = (date.today() - date(ultima // 10000, ultima // 100 % 100, ultima % 100)).days if ultima > 19000101 else None
        except (TypeError, ValueError):
            ultima, dias = 0, None
        if dias is not None and dias > 60:
            inf.aviso("ERP: actividad en POSCLI", f"la última alta o modificación es del {ultima} (hace {dias} días). ¿La caja registra clientes en otra tabla? Confirmar antes de activar la escritura.")
        else:
            inf.ok("ERP: actividad en POSCLI", f"última alta o modificación {ultima}")
    _paso(inf, "ERP: conexión", erp)

    # 3) catálogos de GANAPTOS
    def cats():
        with conexion.catalogos(s=s) as con:
            for t in ("CIUDAD", "DPTOS", "GANBARRIO", "GANMASCOTA", "GANPROFE", "GANAUTOS"):
                try:
                    n = int(conexion.filas(con, f"SELECT COUNT(*) AS N FROM {t}")[0]["N"])
                    (inf.ok if n else inf.aviso)(f"Catálogo {t}", f"{n} registros")
                except Exception as e:  # noqa: BLE001
                    inf.falla(f"Catálogo {t}", str(e)[:200])
    _paso(inf, "Catálogos: conexión", cats)

    # 4) diccionario del CRM
    def crm():
        est = esquema.estado(s)
        if not est.get("existe"):
            inf.falla("CRM: diccionario", f"no existe o no abre con la contraseña de .env: {s.ads_crm_directory}. Ejecute: crm clientes instalar")
            return
        inf.ok("CRM: diccionario", s.ads_crm_directory)
        faltan = [t for t in esquema.TABLAS if t not in est.get("tablas", {})]
        (inf.falla if faltan else inf.ok)("CRM: tablas", f"faltan {faltan}" if faltan else ", ".join(f"{t}={n}" for t, n in est["tablas"].items()))
        (inf.ok if est.get("migracion_inicial") else inf.aviso)("CRM: migración inicial desde POSCLI", "hecha" if est.get("migracion_inicial") else "pendiente: crm clientes instalar")
        with conexion.crm(transaccion=True, s=s) as con:
            cur = con.cursor()
            cur.execute("INSERT INTO CRM_DUPLICADO_DESCARTE (FIRMA, USUARIO, FECHA) VALUES ('verificacion', 'verificacion', NOW())")
            cur.execute("SELECT LASTAUTOINC(CONNECTION) FROM system.iota")
            nid = cur.fetchone()[0]
            con.rollback()
        with conexion.crm(lectura=True, s=s) as con:
            quedo = conexion.filas(con, "SELECT COUNT(*) AS N FROM CRM_DUPLICADO_DESCARTE WHERE FIRMA = 'verificacion'")[0]["N"]
        (inf.ok if nid and not quedo else inf.falla)("CRM: transacciones y autonumérico", "LASTAUTOINC y ROLLBACK funcionan" if nid and not quedo else "el rollback no deshizo la fila")
        with conexion.crm(lectura=True, s=s) as con:
            r = conexion.filas(con, "SELECT ESTADO, COUNT(*) AS N FROM CRM_AUDITORIA WHERE ESTADO <> 'aplicado' GROUP BY ESTADO")
        if r:
            inf.aviso("CRM: auditoría", "hay cambios no aplicados: " + ", ".join(f"{x['ESTADO']}={x['N']}" for x in r) + ". Revíselos en CRM_AUDITORIA.")
        else:
            inf.ok("CRM: auditoría", "sin cambios pendientes ni fallidos")
    _paso(inf, "CRM: conexión", crm)

    # 5) warehouse (ventas)
    def wh():
        from ...warehouse import WarehouseNoDisponible, get_warehouse
        try:
            w = get_warehouse()
            m = w.query("SELECT fecha_max FROM meta")[0]
            pct = w.scalar("SELECT ROUND(100.0 * SUM(venta_neta) FILTER (WHERE cliente_id IS NOT NULL) / NULLIF(SUM(venta_neta), 0), 1) FROM venta")
            inf.ok("Ventas (warehouse)", f"datos hasta {m['fecha_max']}; {pct}% de la venta con cliente identificado")
        except WarehouseNoDisponible:
            inf.aviso("Ventas (warehouse)", "aún no hay datos: ejecute  crm etl --full  (la ficha mostrará compras cuando termine)")
    _paso(inf, "Ventas", wh)

    # 6) índice de la lista
    def ix():
        from .indice import get_indice
        t = time.perf_counter()
        i = get_indice()
        i.recargar()
        if i.error:
            inf.falla("Índice de clientes", i.error)
            return
        n = i.scalar("SELECT COUNT(*) FROM cli")
        inf.ok("Índice de clientes", f"{n:,} clientes en {time.perf_counter() - t:.1f} s".replace(",", "."))
    _paso(inf, "Índice", ix)

    if escritura:
        _prueba_escritura(inf, s)
    return inf


def _prueba_escritura(inf: Informe, s: Settings) -> None:
    from . import servicio
    from .indice import get_indice

    if not s.clientes_escritura:
        inf.falla("Escritura", "CRM_CLIENTES_ESCRITURA=false: active el interruptor en .env para probar la escritura")
        return
    actor = servicio.Actor("verificacion", "admin")
    codcli = "2" + DOC_PRUEBA.zfill(12)

    def limpiar():
        r = get_indice().query("SELECT id FROM cli WHERE tarjeta = ?", [codcli])
        for x in r:
            servicio.eliminar(x["id"], actor)

    def ciclo():
        limpiar()
        c = servicio.crear({"documento": DOC_PRUEBA, "nombre1": "VERIFICACION", "apellido1": "CRM", "celular": "3000000077",
                            "consentimiento": "no"}, actor)
        inf.ok("Escritura: crear cliente en POSCLI", f"tarjeta {c['tarjeta']}")
        c = servicio.actualizar(c["id"], {"email": "verificacion@crm.local"}, c["version"], actor)
        try:
            servicio.actualizar(c["id"], {"email": "otro@crm.local"}, "version-vieja", actor)
            inf.falla("Escritura: protección de cambios ajenos", "aceptó una versión vieja")
        except servicio.Conflicto:
            inf.ok("Escritura: protección de cambios ajenos", "rechazó una versión vieja")
        servicio.guardar_mascota(c["id"], {"tipoId": "02", "nombre": "Prueba"}, actor)
        with conexion.erp(s=s) as con:
            f = conexion.filas(con, "SELECT EMAIL, MASCOTA, CODMASCO, NOMMASCO, FECHAMOD FROM POSCLI WHERE CODCLI = ?", (codcli,))[0]
        bien = txt(f["EMAIL"]) == "verificacion@crm.local" and f["MASCOTA"] is True and txt(f["CODMASCO"]) == "02"
        (inf.ok if bien else inf.falla)("Escritura: la caja ve los cambios (POSCLI)", f"EMAIL={txt(f['EMAIL'])} MASCOTA={f['MASCOTA']} CODMASCO={txt(f['CODMASCO'])} NOMMASCO={txt(f['NOMMASCO'])}")
        servicio.eliminar(c["id"], actor)
        with conexion.erp(s=s) as con:
            quedan = conexion.filas(con, "SELECT COUNT(*) AS N FROM POSCLI WHERE CODCLI = ?", (codcli,))[0]["N"]
        (inf.ok if not quedan else inf.falla)("Escritura: eliminar el cliente de prueba", "eliminado; el rastro queda en CRM_AUDITORIA" if not quedan else "no se eliminó")
    _paso(inf, "Escritura", ciclo)


def imprimir(inf: Informe) -> str:
    marca = {"OK": "[ OK  ]", "AVISO": "[AVISO]", "FALLA": "[FALLA]"}
    lineas = [f"{marca[e]} {p}: {d}" if d else f"{marca[e]} {p}" for e, p, d in inf.filas]
    n_av = sum(1 for f in inf.filas if f[0] == "AVISO")
    lineas.append("")
    lineas.append(f"Resultado: {len(inf.filas) - inf.fallas - n_av} OK · {n_av} avisos · {inf.fallas} fallas"
                  + (" - TODO LISTO" if not inf.fallas else " - corrija las fallas antes de continuar"))
    return "\n".join(lineas)
