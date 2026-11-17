"""Consentimiento y BLOQUE: lo que el ERP dice HOY manda sobre el warehouse al armar y al ejecutar una campaña."""

from __future__ import annotations

from crm.modules.campanas import segmentos as seg
from crm.modules.campanas.router import depurar_programada
from crm.modules.clientes.consultas import RestriccionesContacto
from crm.modules.clientes.mapeo import columnas_anonimizar, columnas_para, ficha_desde_erp


class Cat:
    def dpto_de_ciudad(self, c):
        return None


def _r(**kw) -> RestriccionesContacto:
    base = dict(conocidos=frozenset({"1", "2", "3", "4", "5", "6"}), excluir=frozenset(), sin_autorizacion=frozenset(),
                menores=frozenset(), canales_bloqueados={})
    base.update({k: frozenset(v) if k != "canales_bloqueados" else v for k, v in kw.items()})
    return RestriccionesContacto(**base)


COLS = ["cliente_id", "celular", "email_valido", "puntaje"]


def _f(consentimiento="estricto", canales=("whatsapp", "sms", "email")):
    return {"consentimiento": consentimiento, "canales": list(canales), "tope_contactos": 0}


# ------------------------------------------------------------------------------------------ BLOQUE en el ERP
def test_no_autoriza_marca_bloque_para_campanas():
    cols = columnas_para({"consentimiento": "no"}, {}, Cat())
    assert cols["BLOQUE"] is False and cols["INFOLEY"] is False


def test_si_autoriza_libera_bloque():
    """Desde el CRM se edita todo: si el cliente ahora autoriza, el «false» de BLOQUE se borra en el ERP."""
    cols = columnas_para({"consentimiento": "si"}, {}, Cat())
    assert "BLOQUE" in cols and cols["BLOQUE"] is None and cols["INFOLEY"] is True


def test_sin_registro_no_toca_bloque():
    assert "BLOQUE" not in columnas_para({"consentimiento": "sin_registro"}, {}, Cat())


def test_anonimizar_bloquea_campanas():
    assert columnas_anonimizar()["BLOQUE"] is False


def test_ficha_muestra_sin_campanas_pero_sigue_visible():
    assert ficha_desde_erp({"CODCLI": "2000001", "CEDCLI": "1", "BLOQUE": False})["sinCampanas"] is True
    assert ficha_desde_erp({"CODCLI": "2000001", "CEDCLI": "1", "BLOQUE": None})["sinCampanas"] is False


# ------------------------------------------------------------------------------------------ armado de la audiencia
def test_restricciones_del_erp_sacan_a_quien_no_puede_recibir():
    rows = [("1", "3001", True, 90), ("2", "3002", True, 80), ("3", "3003", True, 70), ("9", "3009", True, 60),
            ("4", "3004", True, 50)]
    r = _r(excluir={"2"}, sin_autorizacion={"3"}, menores={"4"})
    _, out, info = seg.aplicar_restricciones(COLS, rows, _f(), r, restringido=True)
    assert [x[0] for x in out] == ["1"]                    # 2 bloqueado, 3 sin «Sí autoriza», 9 no está en el ERP, 4 menor
    assert info["excluidos_por_erp"] == 4


def test_menores_solo_salen_si_hay_licor_y_sin_registro_solo_en_estricto():
    rows = [("3", "3003", True, 70), ("4", "3004", True, 50)]
    r = _r(sin_autorizacion={"3"}, menores={"4"})
    _, out, _ = seg.aplicar_restricciones(COLS, rows, _f("incluir_sin_registro"), r, restringido=False)
    assert [x[0] for x in out] == ["3", "4"]


def test_canal_no_autorizado_se_quita_y_sin_canales_sale():
    rows = [("1", "3001", True, 90), ("2", "3002", False, 80)]
    r = _r(canales_bloqueados={"1": frozenset({"whatsapp"}), "2": frozenset({"whatsapp", "sms"})})
    cols, out, info = seg.aplicar_restricciones(COLS, rows, _f(), r, restringido=False)
    assert [x[0] for x in out] == ["1"] and info["excluidos_por_canal"] == 1
    assert seg.destinatarios(cols, out, _f()) == [("1", "sms,email")]


# ------------------------------------------------------------------------------------------ campañas programadas
def test_programada_se_depura_al_ejecutar(monkeypatch):
    from crm.modules.campanas import router

    monkeypatch.setattr(router, "_wh", lambda: (_ for _ in ()).throw(RuntimeError("sin warehouse")))
    c = {"segmentacion": {"filtros": {"consentimiento": "estricto"}}, "productos": [{"producto_id": "123"}]}
    filas = [("1", "whatsapp,sms", "envio"), ("2", "sms", "envio"), ("4", "email", "control"), ("9", "sms", "envio"),
             ("5", "whatsapp,email", "envio")]
    r = _r(excluir={"2"}, menores={"4"}, canales_bloqueados={"5": frozenset({"email"})})
    nuevas, quitados = depurar_programada(c, filas, r)
    # sin warehouse no se sabe si hay licor: se asume que sí y el menor (4) también sale
    assert nuevas == [("1", "whatsapp,sms", "envio"), ("5", "whatsapp", "envio")] and quitados == 3


# ------------------------------------------------------------------------------------------ vigencia de la oferta
def test_vigencia_incluye_el_ultimo_dia():
    from datetime import date

    from crm.modules.campanas import programacion as pg

    assert pg.vigencia(date(2026, 11, 22), 3) == (date(2026, 11, 22), date(2026, 11, 24))
    assert pg.vigencia(date(2026, 11, 22), 1) == (date(2026, 11, 22), date(2026, 11, 22))
    assert pg.texto_vigencia(date(2026, 11, 22), date(2026, 11, 24)) == "del 22 al 24 de noviembre de 2026"
    assert pg.texto_vigencia(date(2026, 11, 30), date(2026, 12, 2)) == "del 30 de noviembre al 2 de diciembre de 2026"
    assert pg.texto_vigencia(date(2026, 12, 30), date(2027, 1, 1)) == "del 30 de diciembre de 2026 al 1 de enero de 2027"
    assert pg.texto_vigencia(date(2026, 11, 22), date(2026, 11, 22)) == "solo el 22 de noviembre de 2026"


def test_vigencia_fuera_de_rango():
    from datetime import date

    import pytest

    from crm.modules.campanas import programacion as pg

    for dias in (0, pg.MAX_VIGENCIA_DIAS + 1):
        with pytest.raises(pg.FechaInvalida):
            pg.vigencia(date(2026, 11, 22), dias)


def test_store_guarda_la_vigencia(tmp_path):
    from datetime import date

    from crm.store import Store

    s = Store(tmp_path / "c.sqlite")
    c = s.crear({"nombre": "x"})
    out = s.publicar(c["id"], [("1", "sms")], vigencia=(date(2026, 11, 22), date(2026, 11, 24)))
    assert (out["vigencia_desde"], out["vigencia_hasta"]) == ("2026-11-22", "2026-11-24")
