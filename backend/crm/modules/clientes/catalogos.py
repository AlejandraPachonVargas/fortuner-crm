"""Catálogos de GANAPTOS (tablas libres, solo lectura) listos para los menús del CRM.

* ``CIUDAD`` (DPTO, CODIGO DANE, NOMBRE) y ``DPTOS``. En la copia, ``DPTOS`` solo trae Caldas y Risaralda aunque
  ``CIUDAD`` tiene municipios de otros departamentos: el nombre que falta se completa con la división política
  del DANE (marcado ``origen='DANE'``) para que ningún municipio quede huérfano en pantalla.
* ``GANBARRIO`` (CIUDAD, CODIGO, NOMBRE, TIPO). ``POSCLI.CODBARRIO`` mide 3 caracteres: un barrio con código más
  largo se muestra pero no se puede asignar (no cabe en el ERP).
* ``GANMASCOTA``, ``GANPROFE``, ``GANAUTOS``: códigos que ya usa ``POSCLI``.
"""

from __future__ import annotations

import logging
import re
import threading
import time

from . import conexion
from .mapeo import txt

log = logging.getLogger("crm.clientes.catalogos")

DANE_DEPARTAMENTOS = {
    "05": "Antioquia", "08": "Atlántico", "11": "Bogotá D.C.", "13": "Bolívar", "15": "Boyacá", "17": "Caldas",
    "18": "Caquetá", "19": "Cauca", "20": "Cesar", "23": "Córdoba", "25": "Cundinamarca", "27": "Chocó", "41": "Huila",
    "44": "La Guajira", "47": "Magdalena", "50": "Meta", "52": "Nariño", "54": "Norte de Santander", "63": "Quindío",
    "66": "Risaralda", "68": "Santander", "70": "Sucre", "73": "Tolima", "76": "Valle del Cauca", "81": "Arauca",
    "85": "Casanare", "86": "Putumayo", "88": "San Andrés", "91": "Amazonas", "94": "Guainía", "95": "Guaviare",
    "97": "Vaupés", "99": "Vichada",
}

# Tipos de vehículo del CRM → código de GANAUTOS que se refleja en POSCLI.CODVEHI (prioridad: carro > moto > bici).
VEHICULO_A_GANAUTOS = {"Automóvil": "VP", "Camioneta": "VP", "Moto": "MO", "Bicicleta": "BI", "Otro": "VP"}
PRIORIDAD_GANAUTOS = ("VP", "MO", "BI")


def _bonito(s: str) -> str:
    """'PERRO XXXXX' → 'Perro'; 'VEHICULO PARTICULAR' → 'Vehiculo particular'."""
    s = re.sub(r"(\s+X{2,})+$", "", (s or "").strip())
    return s[:1].upper() + s[1:].lower() if s.isupper() else s


class Catalogos:
    def __init__(self, datos: dict):
        self.datos = datos
        self._ciudad = {c["id"]: c for c in datos["ciudades"]}
        self._barrio = {(b["ciudad"], b["id"]): b for b in datos["barrios"]}
        self._prof = {p["id"]: p for p in datos["profesiones"]}
        self._masc = {m["id"]: m for m in datos["tiposMascota"]}

    # interfaz que usa mapeo.columnas_para
    def dpto_de_ciudad(self, ciudad: str) -> str | None:
        c = self._ciudad.get(ciudad)
        return c["dpto"] if c else None

    def ciudad(self, codigo: str) -> dict | None:
        return self._ciudad.get(codigo)

    def barrio(self, ciudad: str, codigo: str) -> dict | None:
        b = self._barrio.get((ciudad, codigo))
        return b if b and b["asignable"] else None

    def profesion(self, codigo: str) -> dict | None:
        return self._prof.get(codigo)

    def mascota(self, codigo: str) -> dict | None:
        return self._masc.get(codigo)

    def nombre_ciudad(self, codigo: str) -> str:
        c = self._ciudad.get(codigo)
        return c["nombre"] if c else ""

    def nombre_barrio(self, ciudad: str, codigo: str) -> str:
        b = self._barrio.get((ciudad, codigo))
        return b["nombre"] if b else ""


def cargar() -> dict:
    with conexion.catalogos() as con:
        ciu = conexion.filas(con, "SELECT DPTO, CODIGO, NOMBRE FROM CIUDAD")
        dep = conexion.filas(con, "SELECT CODIGO, NOMBRE FROM DPTOS")
        bar = conexion.filas(con, "SELECT CIUDAD, CODIGO, NOMBRE, TIPO FROM GANBARRIO")
        mas = conexion.filas(con, "SELECT CODIGO, NOMBRE FROM GANMASCOTA")
        pro = conexion.filas(con, "SELECT PCODIGO, PNOMBRE FROM GANPROFE")
        aut = conexion.filas(con, "SELECT CODIGO, NOMBRE FROM GANAUTOS")
    t = txt

    ciudades = sorted(({"id": t(c["CODIGO"]), "nombre": _bonito(t(c["NOMBRE"])), "dpto": t(c["DPTO"]) or t(c["CODIGO"])[:2]}
                       for c in ciu if t(c["CODIGO"])), key=lambda c: (c["dpto"], c["nombre"]))
    deptos = {t(d["CODIGO"]): {"id": t(d["CODIGO"]), "nombre": _bonito(t(d["NOMBRE"])), "origen": "DPTOS"} for d in dep if t(d["CODIGO"])}
    for c in ciudades:
        if c["dpto"] not in deptos:
            deptos[c["dpto"]] = {"id": c["dpto"], "nombre": DANE_DEPARTAMENTOS.get(c["dpto"], f"Departamento {c['dpto']}"), "origen": "DANE"}
    barrios = sorted(({"id": t(b["CODIGO"]), "ciudad": t(b["CIUDAD"]), "nombre": _bonito(t(b["NOMBRE"])), "tipo": t(b["TIPO"]),
                       "asignable": len(t(b["CODIGO"])) <= 3} for b in bar if t(b["CODIGO"])), key=lambda b: (b["ciudad"], b["nombre"]))
    return {
        "departamentos": sorted(deptos.values(), key=lambda d: d["nombre"]),
        "ciudades": ciudades,
        "barrios": barrios,
        "tiposMascota": [{"id": t(m["CODIGO"]), "nombre": _bonito(t(m["NOMBRE"]))} for m in sorted(mas, key=lambda m: t(m["CODIGO"]))],
        "profesiones": sorted(({"id": t(p["PCODIGO"]), "nombre": t(p["PNOMBRE"])} for p in pro if t(p["PCODIGO"])),
                              key=lambda p: (p["id"] == "999", p["nombre"])),
        "vehiculos": [{"id": t(a["CODIGO"]), "nombre": _bonito(t(a["NOMBRE"]))} for a in aut if t(a["CODIGO"])],
        "tiposVehiculo": list(VEHICULO_A_GANAUTOS),
        "estadosCiviles": ["Soltero(a)", "Casado(a)", "Union Libre", "Separado(a)", "Viudo(a)"],
        "tiposDoc": [{"id": "CC", "nombre": "Cédula de ciudadanía"}, {"id": "CE", "nombre": "Cédula de extranjería"},
                     {"id": "NIT", "nombre": "NIT"}, {"id": "TI", "nombre": "Tarjeta de identidad"},
                     {"id": "PAS", "nombre": "Pasaporte"}, {"id": "RC", "nombre": "Registro civil"}],
    }


_cache: tuple[float, Catalogos] | None = None
_lock = threading.Lock()


def get_catalogos(max_edad: float = 600) -> Catalogos:
    global _cache
    with _lock:
        if _cache is None or time.monotonic() - _cache[0] > max_edad:
            try:
                _cache = (time.monotonic(), Catalogos(cargar()))
            except Exception:
                if _cache is None:
                    raise
                log.exception("No se pudieron recargar los catálogos; se usa la copia anterior")
        return _cache[1]
