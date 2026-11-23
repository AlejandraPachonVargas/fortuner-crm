"""Fotos de producto: solo se importan las que corresponden al catálogo, se pueden repetir y se sirven de forma segura."""

from __future__ import annotations

from PIL import Image

from crm.modules.imagenes import importador as imp

CATALOGO = [
    ("101210100100216", "7702011005397"),   # coincide por código de barras
    ("102370100100495", "033844006648"),    # el archivo trae un cero de más a la izquierda
    ("101110100119695", "7702354950040"),   # código interno corto (el archivo se llama 119695)
    ("102300100125734", "7700000000001"),   # «125734» es ambiguo: lo comparten dos productos
    ("102290100125734", "7700000000002"),
    ("101030300014867", "14867"),           # en la carpeta solo hay un archivo vacío
]


def _foto(p, color="red", tam=(1000, 1000), modo="RGB"):
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.new(modo, tam, color).save(p)


def _origen(tmp_path):
    o = tmp_path / "images_static"
    _foto(o / "products" / "7702011005397.JPEG")
    _foto(o / "products" / "0033844006648.jpeg", "blue")
    _foto(o / "products" / "119695.png", (0, 0, 0, 0), modo="RGBA")       # PNG transparente → fondo blanco
    _foto(o / "products" / "125734.jpeg")                                 # ambiguo: no se importa
    (o / "products" / "14867.jpeg").write_bytes(b"")                       # vacío
    _foto(o / "products" / "_sin_producto" / "999999999.JPEG")             # no es del catálogo
    (o / "products" / ".7702011005397.jpeg.JJC9P3").write_bytes(b"x")      # temporal de descarga
    (o / "media" / "brands").mkdir(parents=True)
    (o / "media" / "brands" / "76_1788993893135.png").write_bytes(b"")
    return o


def test_importa_solo_lo_del_catalogo(tmp_path):
    o, base = _origen(tmp_path), tmp_path / "imagenes"
    r = imp.importar(o, base, CATALOGO, hilos=2)
    assert r.productos_con_imagen == 3 and r.nuevas == 3 and r.vacios == 2 and r.sin_producto == 2
    assert r.por_metodo == {"ean": 1, "ean_sin_ceros": 1, "codigo_corto": 1}
    grande, mini = imp.carpetas(base)
    assert sorted(f.name for f in grande.glob("*.webp")) == ["101110100119695.webp", "101210100100216.webp", "102370100100495.webp"]
    with Image.open(grande / "101210100100216.webp") as im:
        assert im.format == "WEBP" and im.size == (600, 600)
    with Image.open(mini / "101210100100216.webp") as im:
        assert im.size == (160, 160)
    with Image.open(grande / "101110100119695.webp") as im:   # la transparencia queda en blanco
        assert im.convert("RGB").getpixel((5, 5)) == (255, 255, 255)
    # El origen no se toca: siguen los mismos 8 archivos.
    assert len([f for f in o.rglob("*") if f.is_file()]) == 8


def test_repetir_es_incremental_y_depura(tmp_path):
    o, base = _origen(tmp_path), tmp_path / "imagenes"
    v1 = imp.importar(o, base, CATALOGO, hilos=2)
    version = imp.leer_manifiesto(base)["version"]
    r = imp.importar(o, base, CATALOGO, hilos=2)
    assert (r.nuevas, r.actualizadas, r.sin_cambios) == (0, 0, v1.nuevas)
    assert imp.leer_manifiesto(base)["version"] == version        # sin cambios, misma versión (el navegador conserva su caché)
    # Un producto sale del catálogo → su foto se borra. Un archivo ajeno en la carpeta destino también.
    (imp.carpetas(base)[0] / "basura.jpg").write_bytes(b"x")
    r = imp.importar(o, base, [p for p in CATALOGO if p[0] != "102370100100495"], hilos=2)
    assert r.borradas == 1 and r.productos_con_imagen == 2
    assert not (imp.carpetas(base)[0] / "102370100100495.webp").exists()
    assert not (imp.carpetas(base)[1] / "102370100100495.webp").exists()
    assert not (imp.carpetas(base)[0] / "basura.jpg").exists()
    # Una carpeta nueva con pocas fotos no borra las ya importadas.
    nueva = tmp_path / "nuevas"
    _foto(nueva / "7700000000001.jpg")
    r = imp.importar(nueva, base, CATALOGO, hilos=2)
    assert r.nuevas == 1 and r.productos_con_imagen == 3


def test_archivo_danado_se_descarta(tmp_path):
    o = tmp_path / "o"
    o.mkdir()
    (o / "7702011005397.jpeg").write_bytes(b"no soy una imagen")
    r = imp.importar(o, tmp_path / "imagenes", CATALOGO, hilos=1)
    assert r.productos_con_imagen == 0 and len(r.descartadas) == 1


def test_api_sirve_fotos(tmp_path, monkeypatch):
    from test_seguridad import _cliente
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="clave-de-prueba-123")
    try:
        imp.importar(_origen(tmp_path), tmp_path / "imagenes", CATALOGO, hilos=2)
        assert c.get("/api/productos/imagenes").status_code == 401
        d = c.get("/api/productos/imagenes", headers={"X-API-Key": "clave-de-prueba-123"}).json()
        assert d["ids"] == ["101110100119695", "101210100100216", "102370100100495"] and d["version"] > 0
        r = c.get(f"/media/productos/101210100100216.webp?v={d['version']}")     # pública: un <img> no manda la clave
        assert r.status_code == 200 and r.headers["content-type"] == "image/webp" and "immutable" in r.headers["cache-control"]
        assert r.headers["x-content-type-options"] == "nosniff"
        assert c.get("/media/productos/101210100100216.webp?t=mini").status_code == 200
        assert c.get("/media/productos/101030300014867.webp").status_code == 404           # sin foto
        for malo in ("..%2F..%2F.env", "..%5Ccrm.sqlite.webp", "abc.webp", "101210100100216.png", "101210100100216.webp?t=otro"):
            assert c.get(f"/media/productos/{malo}").status_code in (404, 422), malo
    finally:
        from crm import config
        config.get_settings.cache_clear()


# ------------------------------------------------------------------------------------------ banners de campaña
def _png(tam=(2400, 1200), color=(200, 30, 30, 255)) -> bytes:
    import io
    b = io.BytesIO()
    Image.new("RGBA", tam, color).save(b, "PNG")
    return b.getvalue()


def test_banner_se_reescribe_como_webp_y_se_achica(tmp_path):
    from crm.modules.imagenes import banners as ban
    r = ban.guardar(_png(), tmp_path)
    assert (r["ancho"], r["alto"]) == (1200, 600) and len(r["id"]) == 32
    with Image.open(ban.ruta(tmp_path, r["id"])) as im:
        assert im.format == "WEBP" and im.mode == "RGB"
    for malo in (b"", b"<script>alert(1)</script>", b"GIF89a" + b"0" * 50):
        try:
            ban.guardar(malo, tmp_path)
            raise AssertionError("debió rechazarse")
        except ban.BannerInvalido:
            pass
    assert ban.ruta(tmp_path, "../../.env") is None and ban.ruta(tmp_path, "0" * 32) is None


def test_banner_sin_uso_se_borra_despues_de_un_dia(tmp_path):
    import time as _t
    from crm.modules.imagenes import banners as ban
    usado, suelto, nuevo = (ban.guardar(_png((100, 50)), tmp_path)["id"] for _ in range(3))
    ahora = _t.time() + ban.GRACIA_SEG + 10
    import os
    os.utime(ban.ruta(tmp_path, nuevo), (ahora - 60, ahora - 60))        # subido hace un minuto
    assert ban.depurar(tmp_path, {usado}, ahora=ahora) == 1
    assert ban.ruta(tmp_path, usado) and ban.ruta(tmp_path, nuevo) and ban.ruta(tmp_path, suelto) is None
    assert ban.usados_en(['{"banner": {"id": "%s"}}' % usado, "{}", "no es json"]) == {usado}


def test_api_banner(tmp_path, monkeypatch):
    from test_seguridad import _cliente
    c = _cliente(monkeypatch, tmp_path, CRM_API_KEY="clave-de-prueba-123")
    h = {"X-API-Key": "clave-de-prueba-123"}
    try:
        assert c.post("/api/campanas/banners", content=_png(), headers={"Content-Type": "image/png"}).status_code == 401
        assert c.post("/api/campanas/banners", content=b"x", headers={**h, "Content-Type": "text/html"}).status_code == 415
        assert c.post("/api/campanas/banners", content=b"x" * 10, headers={**h, "Content-Type": "image/png"}).status_code == 422
        r = c.post("/api/campanas/banners", content=_png(), headers={**h, "Content-Type": "image/png"})
        assert r.status_code == 201
        b = r.json()
        img = c.get(f"/media/banners/{b['id']}.webp")
        assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
        assert c.get("/media/banners/..%2Fcrm.sqlite").status_code == 404
        # La campaña guarda solo {id, ancho, alto, nombre} del banner; un id inventado se rechaza.
        msj = {"banner": {**b, "bytes": 1, "url": "http://malo"}, "fotos_ocultas": ["123", "<x>"]}
        cid = c.post("/api/campanas", json={"nombre": "Con banner", "mensaje": msj}, headers=h).json()["id"]
        m = c.get(f"/api/campanas/{cid}", headers=h).json()["mensaje"]
        assert m["banner"] == {"id": b["id"], "ancho": 1200, "alto": 600} and m["fotos_ocultas"] == ["123"]
        assert c.post("/api/campanas", json={"nombre": "x", "mensaje": {"banner": {"id": "../.env"}}}, headers=h).status_code == 422
    finally:
        from crm import config
        config.get_settings.cache_clear()
