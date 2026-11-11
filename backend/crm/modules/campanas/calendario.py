"""Calendario comercial de Colombia / Eje Cafetero: temporadas y fechas especiales.

Es determinista (no depende de la IA): la IA recibe estas temporadas como contexto verificado y no tiene
que "adivinar" la fecha. Las fechas móviles (Semana Santa, Día de la Madre…) se calculan por regla.
Las fiestas locales (Feria de Manizales) son aproximadas: ajústelas en EVENTOS_LOCALES si cambian.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta


@dataclass(frozen=True)
class Temporada:
    id: str
    nombre: str
    inicio: date          # primer día del evento (o de la ventana de consumo)
    fin: date             # último día
    anticipacion: int     # días antes del inicio en que conviene empezar a comunicar
    palabras: tuple[str, ...] = field(default_factory=tuple)   # términos del catálogo asociados
    contexto: str = ""    # una línea para la IA: qué se consume y por qué
    local: bool = False

    def estado(self, hoy: date) -> str:
        if self.inicio <= hoy <= self.fin:
            return "en_curso"
        if hoy < self.inicio:
            return "proxima"
        return "pasada"

    def dias_para_inicio(self, hoy: date) -> int:
        return (self.inicio - hoy).days

    def a_dict(self, hoy: date) -> dict:
        return {"id": self.id, "nombre": self.nombre, "inicio": self.inicio.isoformat(), "fin": self.fin.isoformat(),
                "anticipacion": self.anticipacion, "estado": self.estado(hoy), "dias_para_inicio": self.dias_para_inicio(hoy),
                "contexto": self.contexto, "local": self.local, "palabras": list(self.palabras)}


def _domingo_n(anio: int, mes: int, n: int) -> date:
    d = date(anio, mes, 1)
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _dia_semana_n(anio: int, mes: int, weekday: int, n: int) -> date:
    d = date(anio, mes, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _ultimo_dia_semana(anio: int, mes: int, weekday: int) -> date:
    sig = date(anio + (mes == 12), mes % 12 + 1, 1)
    d = sig - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _pascua(anio: int) -> date:
    a, b, c = anio % 19, anio // 100, anio % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    L = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * L) // 451
    mes = (h + L - 7 * m + 114) // 31
    dia = (h + L - 7 * m + 114) % 31 + 1
    return date(anio, mes, dia)


def temporadas_del_anio(anio: int) -> list[Temporada]:
    pascua = _pascua(anio)
    jueves_accion = _dia_semana_n(anio, 11, 3, 4)          # 4.º jueves de noviembre
    return [
        Temporada("ano_nuevo", "Año Nuevo", date(anio, 1, 1), date(anio, 1, 2), 10,
                  ("licor", "aguardiente", "ron", "whisky", "vino", "champ", "uva", "snack", "gaseosa", "hielo"),
                  "Celebración y reuniones: licores, vinos, pasabocas, bebidas."),
        Temporada("feria_manizales", "Feria de Manizales", date(anio, 1, 3), date(anio, 1, 12), 12,
                  ("aguardiente", "cerveza", "ron", "licor", "agua", "gaseosa", "balsamo", "labial", "pañito", "protector",
                   "snack", "hielo", "gorra", "vaso"),
                  "Fiestas locales con corridas de toros, cabalgatas y verbenas: licores, cerveza, agua, hidratación, "
                  "protector solar, bálsamos labiales, toallitas y pasabocas.", local=True),
        Temporada("regreso_clases", "Regreso a clases", date(anio, 1, 20), date(anio, 2, 15), 10,
                  ("cuaderno", "lapiz", "colores", "loncher", "lonchera", "jugo", "galleta", "yogurt", "cereal", "papeleria"),
                  "Útiles y loncheras escolares: bebidas, galletas, lácteos y pasabocas para niños."),
        Temporada("san_valentin", "Amor y Amistad (San Valentín)", date(anio, 2, 14), date(anio, 2, 14), 10,
                  ("chocolate", "vino", "flor", "dulce", "champ", "bombon", "espumoso", "peluche", "tarjeta"),
                  "Detalles románticos: chocolates, vinos, espumosos, dulces."),
        Temporada("dia_mujer", "Día de la Mujer", date(anio, 3, 8), date(anio, 3, 8), 7,
                  ("chocolate", "vino", "cuidado", "crema", "shampoo", "dulce", "te "),
                  "Detalles y cuidado personal."),
        Temporada("semana_santa", "Semana Santa", pascua - timedelta(days=7), pascua, 12,
                  ("pescado", "atun", "sardina", "aceite", "arroz", "lenteja", "garbanzo", "bacalao", "camaron", "vino",
                   "agua", "gaseosa", "cerveza", "protector", "repelente", "mecato", "snack"),
                  "Festivo largo: viajes, paseos, comidas de vigilia (pescado, atún, granos) y bebidas."),
        Temporada("dia_nino", "Día del Niño", _ultimo_dia_semana(anio, 4, 5), _ultimo_dia_semana(anio, 4, 5), 10,
                  ("dulce", "chocolate", "galleta", "jugo", "snack", "helado", "gomita", "juguete", "mecato"),
                  "Dulces, helados, golosinas y detalles para niños."),
        Temporada("dia_madre", "Día de la Madre", _domingo_n(anio, 5, 2), _domingo_n(anio, 5, 2), 12,
                  ("vino", "chocolate", "espumoso", "cuidado", "crema", "perfume", "cafe", "te ", "galleta", "flor", "bombon"),
                  "Una de las fechas de mayor consumo en Colombia: vinos, chocolates, cuidado personal, detalles."),
        Temporada("dia_padre", "Día del Padre", _domingo_n(anio, 6, 3), _domingo_n(anio, 6, 3), 12,
                  ("whisky", "ron", "cerveza", "licor", "aguardiente", "carne", "parrilla", "carbon", "embutido", "chorizo",
                   "snack", "vino", "afeitar"),
                  "Reuniones familiares y parrilla: licores, cerveza, carnes, embutidos, carbón."),
        Temporada("mitad_ano", "Vacaciones y prima de mitad de año", date(anio, 6, 20), date(anio, 7, 15), 7,
                  ("agua", "gaseosa", "snack", "protector", "repelente", "cerveza", "helado", "mecato", "pañito", "sandwich"),
                  "Prima de servicios y vacaciones: viajes, paseos, planes en familia."),
        Temporada("amor_amistad", "Amor y Amistad", _dia_semana_n(anio, 9, 5, 3), _dia_semana_n(anio, 9, 5, 3), 12,
                  ("chocolate", "vino", "dulce", "licor", "espumoso", "bombon", "galleta", "snack", "ron", "whisky"),
                  "Intercambio de detalles entre amigos y parejas: chocolates, licores, vinos, dulces.", ),
        Temporada("halloween", "Halloween", date(anio, 10, 31), date(anio, 10, 31), 12,
                  ("dulce", "chocolate", "gomita", "paleta", "caramelo", "chicle", "galleta", "snack", "mecato", "bombon", "gelatina"),
                  "Dulces y golosinas para niños: gomitas, chocolates, caramelos, paletas."),
        Temporada("black_friday", "Black Friday", jueves_accion + timedelta(days=1), jueves_accion + timedelta(days=4), 10,
                  ("cuidado", "aseo", "detergente", "pañal", "licor", "whisky", "vino", "cafe", "aceite", "arroz"),
                  "Promociones de volumen en despensa, aseo, licores y cuidado personal."),
        Temporada("novenas", "Novenas de Aguinaldo", date(anio, 12, 16), date(anio, 12, 24), 14,
                  ("natilla", "buñuelo", "vino", "aguardiente", "ron", "whisky", "chocolate", "galleta", "dulce", "panettone",
                   "pernil", "jamon", "cerdo", "pasabocas", "gaseosa", "arequipe", "leche", "harina"),
                  "Reuniones de novena: natilla, buñuelos, licores, dulces, carnes y bebidas."),
        Temporada("navidad", "Navidad y Fin de Año", date(anio, 12, 24), date(anio, 12, 31), 20,
                  ("vino", "whisky", "ron", "aguardiente", "champ", "espumoso", "pernil", "jamon", "pavo", "cerdo", "uva",
                   "panettone", "chocolate", "galleta", "dulce", "turron", "nueces", "pasa", "hielo", "gaseosa", "licor"),
                  "La temporada de mayor venta del año: cenas, licores, vinos, carnes, dulces y detalles."),
    ]


def temporadas_relevantes(hoy: date, horizonte_dias: int = 75) -> list[Temporada]:
    """Temporadas que están en curso o empiezan dentro del horizonte (o cuya ventana de preparación ya abrió)."""
    todas = temporadas_del_anio(hoy.year) + temporadas_del_anio(hoy.year + 1)
    out = []
    for t in todas:
        if t.fin < hoy:
            continue
        if t.inicio <= hoy + timedelta(days=horizonte_dias):
            out.append(t)
    return sorted(out, key=lambda t: t.inicio)


def buscar(id_: str, hoy: date) -> Temporada | None:
    for t in temporadas_del_anio(hoy.year) + temporadas_del_anio(hoy.year + 1):
        if t.id == id_ and t.fin >= hoy:
            return t
    return None


def misma_ventana_anios_previos(t: Temporada, anios: int = 3) -> list[tuple[date, date]]:
    """La misma ventana de la temporada en años anteriores (para medir qué se vendió entonces)."""
    out = []
    for k in range(1, anios + 1):
        try:
            for x in temporadas_del_anio(t.inicio.year - k):
                if x.id == t.id:
                    out.append((x.inicio - timedelta(days=min(t.anticipacion, 7)), x.fin))
        except ValueError:
            continue
    return out
