"""Pruebas de Clientes 360° que no necesitan Advantage: mapeo POSCLI ↔ ficha, validaciones y migración."""

from datetime import date

import pytest

from crm.modules.clientes import mapeo
from crm.modules.clientes.esquema import tipos_mascota_de, vehiculos_de
from crm.modules.clientes.mapeo import DatoInvalido, columnas_para


class Cat:
    """Catálogo mínimo con la forma del de GANAPTOS."""

    def dpto_de_ciudad(self, c):
        return {"17001": "17", "66001": "66"}.get(c)

    def ciudad(self, c):
        return {"17001": {"id": "17001", "nombre": "Manizales"}, "66001": {"id": "66001", "nombre": "Pereira"}}.get(c)

    def barrio(self, ciudad, codigo):
        return {("17001", "185"): {"id": "185", "nombre": "Palermo"}}.get((ciudad, codigo))

    def profesion(self, c):
        return {"015": {"id": "015", "nombre": "Docente"}}.get(c)


ACTUAL = {"NOMBRE": "MARIA", "NOMBRE2": "LUCIA", "APELLIDO": "RUEDA", "APELLIDO2": "VALDES", "CIUDAD": "17001", "CODBARRIO": "185"}


# ------------------------------------------------------------------------------------------ lectura
def test_nacimiento_en_los_dos_formatos_del_erp():
    assert mapeo.nacimiento_de(19890114.0, 1989) == ("1989-01-14", "01-14")
    assert mapeo.nacimiento_de(1231, 1975) == ("1975-12-31", "12-31")      # MMDD + año en ANON
    assert mapeo.nacimiento_de(101, 0) == (None, "01-01")                  # solo cumpleaños
    assert mapeo.nacimiento_de(0, 0) == (None, None)
    assert mapeo.nacimiento_de(1992109, 1992) == (None, None)               # basura del ERP


def test_ficha_desde_erp_lee_llaves_consentimiento_y_clubes():
    f = mapeo.ficha_desde_erp({"CODCLI": "2001053796908", "CEDCLI": "1053796908", "NOMBRE": "jose", "APELLIDO": "SERNA",
                               "TIPODOC": "22", "INFOLEY": True, "INFOWAS": False, "CLUBVINO": True, "SEXO": "I", "FECHAN": 19890114})
    assert f["tarjeta"] == "2001053796908" and f["documento"] == "1053796908"
    assert f["tipoDoc"] == "CE" and f["nombres"] == "JOSE" and f["sexo"] == "N"
    assert f["consentimiento"] == "si" and f["autorizaWhatsapp"] is False and f["autorizaSms"] is None
    assert f["clubesErp"]["CLUBVINO"] is True and f["clubesErp"]["CLUBSALUD"] is False


def test_registro_viejo_con_nombre_solo_en_nomcli():
    f = mapeo.ficha_desde_erp({"CODCLI": "1", "CEDCLI": "2", "NOMCLI": "PEREZ JUAN"})
    assert f["nombres"] == "PEREZ JUAN" and f["apellidos"] == ""


# ------------------------------------------------------------------------------------------ escritura
def test_nombres_en_mayusculas_y_nomcli_recalculado_con_las_partes_que_no_cambian():
    cols = columnas_para({"nombre2": "Eugenia"}, ACTUAL, Cat())
    assert cols == {"NOMBRE2": "EUGENIA", "NOMCLI": "MARIA EUGENIA RUEDA VALDES"}


def test_nomcli_se_corta_a_40_caracteres_sin_perder_las_partes():
    cols = columnas_para({"nombre1": "MARIA DEL SOCORRO", "apellido1": "ARISTIZABAL DE LOS RIOS"}, ACTUAL, Cat())
    assert len(cols["NOMCLI"]) == 40 and cols["APELLIDO"] == "ARISTIZABAL DE LOS RIOS"


def test_las_llaves_nunca_se_pueden_escribir():
    for campo in ("documento", "tarjeta", "id", "CODCLI", "CEDCLI", "puntos"):
        with pytest.raises(DatoInvalido):
            columnas_para({campo: "123"}, ACTUAL, Cat())
    assert not (mapeo.COLUMNAS_EDITABLES & mapeo.LLAVES)
    assert "CLAWEB" not in mapeo.COLUMNAS_LECTURA and "CLAWEB" not in mapeo.COLUMNAS_EDITABLES


def test_celular_y_correo():
    assert columnas_para({"celular": "+57 310 123 4567"}, ACTUAL, Cat()) == {"TELCELU": "3101234567"}
    assert columnas_para({"email": " Ana@Correo.COM "}, ACTUAL, Cat()) == {"EMAIL": "ana@correo.com"}
    with pytest.raises(DatoInvalido):
        columnas_para({"celular": "8879020"}, ACTUAL, Cat())
    with pytest.raises(DatoInvalido):
        columnas_para({"email": "a@b"}, ACTUAL, Cat())
    with pytest.raises(DatoInvalido, match="máximo 50"):
        columnas_para({"email": "x" * 45 + "@correo.com"}, ACTUAL, Cat())


def test_nacimiento_se_escribe_como_aaaammdd_y_anio():
    assert columnas_para({"nacimiento": "1985-03-12"}, ACTUAL, Cat(), hoy=date(2026, 11, 13)) == {"FECHAN": 19850312, "ANON": 1985}
    with pytest.raises(DatoInvalido):
        columnas_para({"nacimiento": "2030-01-01"}, ACTUAL, Cat(), hoy=date(2026, 11, 13))


def test_ubicacion_solo_con_codigos_del_catalogo_y_el_barrio_sigue_a_la_ciudad():
    assert columnas_para({"barrioId": "185"}, ACTUAL, Cat()) == {"CODBARRIO": "185", "BARRIO1": "Palermo"}
    with pytest.raises(DatoInvalido):
        columnas_para({"barrioId": "999"}, ACTUAL, Cat())
    cols = columnas_para({"ciudadId": "66001"}, ACTUAL, Cat())   # al cambiar de ciudad el barrio viejo se limpia
    assert cols == {"CIUDAD": "66001", "CIUCLI": "Pereira", "CODBARRIO": "", "BARRIO1": ""}
    with pytest.raises(DatoInvalido):
        columnas_para({"ciudadId": "99999"}, ACTUAL, Cat())


def test_profesion_del_catalogo_ganprofe():
    assert columnas_para({"profesionId": "015"}, ACTUAL, Cat()) == {"CODPROFE": "015", "PROFESION1": "Docente"}
    with pytest.raises(DatoInvalido):
        columnas_para({"profesionId": "777"}, ACTUAL, Cat())


def test_quien_no_autoriza_datos_tampoco_autoriza_canales():
    cols = columnas_para({"consentimiento": "no", "autorizaWhatsapp": True}, ACTUAL, Cat())
    assert cols == {"INFOLEY": False, "INFOTEX": False, "INFOELEC": False, "INFOWAS": False, "BLOQUE": False}
    assert columnas_para({"consentimiento": "sin_registro"}, ACTUAL, Cat()) == {"INFOLEY": None}


def test_todo_lo_que_se_escribe_esta_en_la_lista_blanca():
    cambios = {"tipoDoc": "CC", "nombre1": "Ana", "nombre2": "", "apellido1": "Gomez", "apellido2": "", "sexo": "F",
               "nacimiento": "1990-01-01", "profesionId": "015", "empresa": "Mercaldas", "estadoCivil": "Casado(a)", "hijos": 2,
               "celular": "3101234567", "telefono": "8879020", "email": "a@b.co", "ciudadId": "17001", "barrioId": "185",
               "direccion": "Cra 23 # 45-12", "consentimiento": "si", "autorizaSms": True, "autorizaEmail": False,
               "autorizaWhatsapp": None}
    cols = columnas_para(cambios, ACTUAL, Cat())
    assert set(cols) <= mapeo.COLUMNAS_EDITABLES
    for col, largo in mapeo.LONGITUD.items():
        if isinstance(cols.get(col), str):
            assert len(cols[col]) <= largo, col


def test_anonimizar_conserva_llaves():
    cols = mapeo.columnas_anonimizar()
    assert not (set(cols) & mapeo.LLAVES) and set(cols) <= mapeo.COLUMNAS_EDITABLES
    assert cols["NOMCLI"] == "CLIENTE ANONIMIZADO" and cols["INFOLEY"] is False


def test_codigo_de_tarjeta_regla_del_pos():
    assert mapeo.codigo_tarjeta("1053796908") == "2001053796908"
    assert mapeo.codigo_tarjeta("24309819") == "2000024309819"
    with pytest.raises(DatoInvalido):
        mapeo.codigo_tarjeta("12345678901")    # CEDCLI es C10


def test_version_detecta_cambios():
    a = mapeo.version({"EMAIL": "a@b.co", "TELCELU": "3101234567"})
    assert a == mapeo.version({"TELCELU": "3101234567", "EMAIL": "a@b.co"})
    assert a != mapeo.version({"EMAIL": "a@b.co", "TELCELU": "3101234568"})


# ------------------------------------------------------------------------------------------ migración
def test_tipos_de_mascota_desde_texto_libre():
    assert tipos_mascota_de("01", "SIN MASCOTA", True) == []
    assert tipos_mascota_de("", "PERRITA PINCHER", None) == ["02"]
    assert tipos_mascota_de("", "PERRO Y GATO", None) == ["02", "03"]
    assert tipos_mascota_de("03", "", True) == ["03"]
    assert tipos_mascota_de("10", "", True) == ["99"]           # código huérfano → Otro
    assert tipos_mascota_de("", "BRUNO", True) == ["99"]
    assert tipos_mascota_de("", "", None) == []


def test_vehiculos_desde_poscli():
    assert vehiculos_de("VM", "", None) == [("Automóvil", "VP"), ("Moto", "MO")]
    assert vehiculos_de("XX", "Carro", True) == []
    assert vehiculos_de("", "Moto", None) == [("Moto", "MO")]
    assert vehiculos_de("", "", True) == [("Automóvil", "VP")]
