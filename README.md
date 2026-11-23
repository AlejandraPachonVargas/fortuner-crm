# FORTUNER CRM

CRM comercial para el ERP **FORTUNER** (base de datos Advantage / diccionario *Publidata*), construido por **DSI S.A.**
Este documento es la **bitácora técnica viva** del producto: qué existe, cómo funciona, por qué se eligió cada tecnología,
qué se auditó y qué falta. Se actualiza con cada desarrollo.

> **Estado actual — Victoria temprana #1: módulo «Campañas»** (productos → mensaje con IA → segmentación → revisión/publicación simulada).
> Todo se desarrolla y prueba en un PC local, pero **está pensado desde el primer día para desplegarse en un servidor Windows**
> (sin Docker, sin Linux, sin servicios externos obligatorios).

---

## Índice

1. [Avance por módulo](#1-avance-por-módulo)
2. [Arquitectura](#2-arquitectura)
3. [Stack tecnológico y por qué](#3-stack-tecnológico-y-por-qué)
4. [Estructura del repositorio](#4-estructura-del-repositorio)
5. [Puesta en marcha](#5-puesta-en-marcha)
6. [Despliegue en el servidor Windows](#6-despliegue-en-el-servidor-windows)
7. [Conexión con ADVANTAGE / Publidata](#7-conexión-con-advantage--publidata)
8. [Modelo de datos analítico](#8-modelo-de-datos-analítico)
9. [Módulo Campañas: las 5 pantallas](#9-módulo-campañas-las-5-pantallas) · [9.1 Clientes 360°](#91-clientes-360-gestor-de-clientes) · [9.2 Analítica](#92-analítica-tableros-de-clientes-y-de-campañas) · [9.3 Automatizaciones](#93-automatizaciones) · [9.4 Fotos de producto](#94-fotos-de-producto) · [9.5 Configuración](#95-configuración-canales-de-difusión)
10. [Cómo se usa la IA (DeepSeek)](#10-cómo-se-usa-la-ia-deepseek)
11. [Segmentación de clientes](#11-segmentación-de-clientes)
12. [Auditoría: seguridad y efectividad](#12-auditoría-seguridad-y-efectividad)
13. [Difusión real (siguiente fase): recomendaciones](#13-difusión-real-siguiente-fase-recomendaciones)
14. [Pruebas](#14-pruebas)
15. [Hallazgos, supuestos y decisiones pendientes](#15-hallazgos-supuestos-y-decisiones-pendientes)
16. [Roadmap](#16-roadmap)
17. [Bitácora de cambios](#17-bitácora-de-cambios)

---

## 1. Avance por módulo

| Módulo | Estado | Notas |
|---|---|---|
| Conexión a ADVANTAGE (solo lectura) | ✅ Listo | Mismo driver/cadena que `fortuner-dashboards`; extracción a Parquet + modelo DuckDB |
| Campañas · 1 Historial (ver / editar / eliminar / duplicar, borradores) | ✅ Listo | Borrado lógico + bitácora |
| Campañas · 2 Productos (IA por temporada, inventario/rotación, filtros manuales) | ✅ Listo | Filtros familia › departamento › grupo › sección, tipo, marca, id/nombre |
| Campañas · 3 Mensaje (IA o redacción propia, 3 canales) | ✅ Listo | Modo manual **no consume tokens** |
| Campañas · 4 Audiencia (segmentación + IA + presupuesto) | ✅ Listo | RFM, ciclo de recompra, afinidad, estacionalidad, hábitos, consentimiento |
| Campañas · 5 Revisión y publicación | ✅ Listo (**simulada**) | No envía mensajes reales; ver [§13](#13-difusión-real-siguiente-fase-recomendaciones) |
| Campañas · vista previa realista (WhatsApp, SMS, correo) | ✅ Listo | Pasos 2 y 4; ver [§9](#9-módulo-campañas-las-5-pantallas) |
| Campañas · programar publicación + grupo de control + calidad del mensaje | ✅ Listo (**simulada**) | Planificador interno cada 30 s; estado *programada* en el historial |
| Difusión real (WhatsApp / SMS / correo) | ⏳ Pendiente | Solo recomendaciones por ahora |
| Analítica · tablero de clientes y tablero de campañas | ✅ Listo | Menú «Analítica». Ver [§9.2](#92-analítica-tableros-de-clientes-y-de-campañas) |
| Medición de resultados (envío vs grupo de control) | ✅ Lista (espera difusión real) | Se calcula sola en la Analítica de campañas cuando las ventas cubren la vigencia |
| Modelo supervisado de respuesta | ⏳ Pendiente | Requiere difusión real para tener respuestas |
| Clientes 360° (gestor de clientes) | ✅ Conectado a ADVANTAGE (copia de prueba) | Lee y edita `POSCLI`; tablas propias `CRM_*` en un diccionario aparte; catálogos de GANAPTOS. Ver [§9.1](#91-clientes-360-gestor-de-clientes) y [`docs/clientes-360-arquitectura.md`](docs/clientes-360-arquitectura.md) |
| Automatizaciones (cumpleaños, bienvenida, segunda compra, reactivación) | ✅ Listo (**simulado**) | Ediciones por periodo con oferta y mensajes propios. Ver [§9.3](#93-automatizaciones) |

---

## 2. Arquitectura

```
┌──────────────────────┐   ODBC (solo lectura)   ┌──────────────────────────────────┐
│ ERP FORTUNER          │ ◄────────────────────── │  ETL  (crm etl)                  │
│ Advantage DB · PUBLIDATA │                       │  tablas → Parquet (zstd)         │
│ (POS sigue facturando)│                         │  Parquet → modelo DuckDB (SQL)   │
└──────────────────────┘                         └───────────────┬──────────────────┘
                                                                  │ archivo .duckdb versionado (CURRENT)
┌──────────────────────┐   HTTPS (API compatible OpenAI)  ┌───────▼──────────────────────────┐
│ DeepSeek (LLM)        │ ◄──────────────────────────────  │  API  FastAPI  (un solo proceso)  │
│ · temporada → productos│  solo datos de PRODUCTOS y       │  · Campañas (router)             │
│ · redacción 3 canales │  estadísticas agregadas;          │  · Seguridad (clave, tasa, CSP)  │
│ · perfil de audiencia │  nunca datos de clientes          │  · Sirve también la SPA          │
└──────────────────────┘                                   └───────┬──────────────┬───────────┘
                                                                    │              │
                                              SQLite (campañas,     │              │  /  (React compilado)
                                              destinatarios,        ▼              ▼
                                              auditoría)        data/crm.sqlite   Navegador (SPA React)
```

**Flujo de una campaña:** la persona elige productos (datos + IA) → redacta (IA o manual) → la API calcula la
audiencia en DuckDB (puntaje por cliente) → la interfaz muestra alcance, costo y composición → al publicar, el
**servidor recalcula** la audiencia (no confía en lo que mande el navegador), guarda destinatarios y marca la campaña.

**Decisión clave — dos bases de datos, cada una para lo que hace bien:**

| Dato | Motor | Por qué |
|---|---|---|
| Ventas, clientes, productos (millones de filas, solo lectura, agregaciones) | **DuckDB** (columnar) | Calcula en milisegundos lo que en una base fila-a-fila tardaría minutos; cero administración |
| Campañas, destinatarios, auditoría (pocas filas, escritura frecuente, integridad) | **SQLite** (WAL) | Transaccional, viene con Python, sin instalar servidor en Windows |

---

## 3. Stack tecnológico y por qué

| Capa | Tecnología | Para qué se usa | Por qué esta y no otra |
|---|---|---|---|
| Lenguaje backend | **Python 3.11+** (probado con 3.14) | API, ETL, analítica, IA | El mismo de `fortuner-dashboards` (el equipo ya lo opera); ecosistema de datos e IA |
| Web API | **FastAPI** + Uvicorn | Endpoints REST, validación | Validación automática con Pydantic (primera línea de seguridad), rápido, documentación OpenAPI en desarrollo |
| Validación / config | **Pydantic v2** + pydantic-settings | Esquemas de entrada y `.env` | Rechaza entradas malformadas antes de tocar la lógica; configuración 12-factor |
| Conexión ERP | **pyodbc** + driver *Advantage StreamlineSQL ODBC* | Leer Publidata | Es el driver oficial que ya usa el ERP; solo lectura, modo compartido |
| Intercambio / staging | **Apache Arrow + Parquet (zstd)** | Guardar lo extraído | Esquema fijo y tipado, ~10× más pequeño que CSV, DuckDB lo lee directo |
| Analítica | **DuckDB** | Modelo, RFM, segmentación | Motor analítico embebido: sin servidor, paraleliza en todos los núcleos, SQL estándar |
| Persistencia operativa | **SQLite** | Campañas, auditoría | Ver tabla anterior |
| IA | **DeepSeek** (API compatible OpenAI) vía **httpx** | Recomendaciones y redacción | Costo por token muy bajo; el cliente es agnóstico (cambiar a otro proveedor = 3 variables de `.env`) |
| CLI | **Typer** | `crm etl`, `crm servir`… | Comandos simples para operar en el servidor |
| Frontend | **React 19 + TypeScript** | Interfaz | Mismo stack y diseño que `fortuner-dashboards` → experiencia coherente |
| Build / estilos | **Vite** + **Tailwind CSS 4** | Compilar y estilizar | Compila a archivos estáticos que sirve el propio backend (nada que instalar en el servidor) |
| Datos en el cliente | **TanStack Query** | Caché y estados de carga/error | Evita pedir lo mismo dos veces y simplifica los estados |
| Enrutado | **React Router 7** | Pantallas y URL | Estándar |
| Iconos | **lucide-react** | Iconografía | Ya se usa en dashboards |
| Gráficas | **SVG propio** (curva Pareto, barras) | Visualizar audiencia | Evita sumar 650 kB de librería para 2 gráficas simples |
| Pruebas | **pytest**, **Vitest** | Calidad | Estándar |

> Lo que **no** se usó a propósito: Docker (el servidor es Windows), un ORM (SQL directo y parametrizado es más
> transparente para auditar), un framework de agentes de IA (el flujo es determinista; la IA solo redacta y prioriza).

---

## 4. Estructura del repositorio

```
fortuner-crm/
├── backend/
│   ├── pyproject.toml           dependencias
│   ├── crm/
│   │   ├── config.py            configuración (.env)
│   │   ├── security.py          claves, límite de tasa, cabeceras, arranque seguro
│   │   ├── api.py               aplicación FastAPI (+ sirve la SPA)
│   │   ├── cli.py               comandos: probar-ads, etl, modelo, servir, clientes, imagenes
│   │   ├── store.py             SQLite: campañas, destinatarios, auditoría
│   │   ├── warehouse.py         acceso de solo lectura a DuckDB
│   │   ├── etl/
│   │   │   ├── ads.py           extracción desde ADVANTAGE → Parquet
│   │   │   ├── pipeline.py      orquestación + publicación atómica del warehouse
│   │   │   └── sql/model.sql    modelo analítico (limpieza, RFM, afinidades)
│   │   ├── ai/llm.py            cliente LLM (reintentos, tokens)
│   │   └── modules/campanas/
│   │       ├── router.py        endpoints
│   │       ├── calendario.py    temporadas comerciales de Colombia
│   │       ├── productos.py     filtros + recomendaciones (temporada, inventario)
│   │       ├── redaccion.py     mensajes por canal + validación SMS
│   │       └── segmentos.py     segmentación y puntaje
│   │   (además modules/clientes, analitica, automatizaciones e imagenes: importador y entrega de fotos de producto)
│   └── tests/
├── frontend/                    React + Vite + Tailwind (mismos tokens visuales que dashboards)
│   └── src/pages/campanas/      Historial · Wizard · PasoProductos · PasoMensaje · PasoSegmentacion · ResumenCampana · Detalle
├── scripts/                     instalar · cargar-datos · iniciar · instalar-servicio (PowerShell)
├── .env.example                 plantilla de configuración (el .env real NO se versiona)
└── data/                        (ignorado por git) staging, warehouse, crm.sqlite, imagenes, logs
```

---

## 5. Puesta en marcha

Requisitos: Windows, **Python 3.11+**, **Node.js 20+** (solo para compilar la interfaz), driver ODBC
*Advantage StreamlineSQL* (ya instalado donde corre `fortuner-dashboards`) y acceso de red/disco al ERP.

```powershell
# 1) Instalar (venv, dependencias, compilar interfaz, crear .env con claves nuevas)
powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1

# 2) Completar .env: ADS_USER, ADS_PASSWORD, ADS_DATA_DIRECTORY, DEEPSEEK_API_KEY

# 3) Probar la conexión al ERP (solo lectura)
.\.venv\Scripts\crm.exe probar-ads

# 4) Cargar datos (la primera vez es completa; ~1 hora por los ~24 M de líneas de venta de 2026)
scripts\cargar-datos.ps1 -Completo

# 5) Iniciar
scripts\iniciar.ps1          # http://127.0.0.1:8900
```

**Desarrollo con recarga en caliente** (dos terminales): `.venv\Scripts\python -m uvicorn crm.api:app --app-dir backend --reload`
y `npm --prefix frontend run dev` (http://localhost:5174, ya apunta a la API). También hay `.claude/launch.json`.

Comandos útiles: `crm probar-ads` · `crm etl [--full] [--meses N]` · `crm modelo` (reconstruye el modelo sin tocar el ERP) · `crm servir`.

---

## 6. Despliegue en el servidor Windows

> **Guía paso a paso con comandos de Git Bash (incluye Clientes 360° y la verificación `crm clientes verificar`):
> [`docs/despliegue-servidor.md`](docs/despliegue-servidor.md).** Instalación en un comando: `bash scripts/instalar.sh`.

1. Copiar/clonar el repositorio (p. ej. `D:\fortuner-crm`) y ejecutar `scripts\instalar.ps1`.
2. En `.env`: `CRM_ENV=production` (**obliga** a definir `CRM_API_KEY` y `CRM_ADMIN_KEY`; sin ellas el servidor no arranca),
   `ADS_DATA_DIRECTORY=\\SERVIDOR_ERP:2000\C$\ADD_FORTUNER\PUBLIDATA.add` (o la ruta local), `CRM_HOST=127.0.0.1`.
3. `scripts\instalar-servicio.ps1` (como Administrador) crea dos tareas del Programador de Windows: el servidor (arranca con
   Windows y se reinicia si se cae) y la **carga nocturna** de datos (02:30).
4. **Exposición:** el CRM escucha solo en `127.0.0.1`. Para usarlo desde otros PC, poner delante **IIS (Application Request
   Routing) o Caddy/nginx para Windows con HTTPS** y reenviar a `127.0.0.1:8900`. No abrir el puerto 8900 directamente a Internet.
5. Reglas de firewall: salida HTTPS (443) hacia `api.deepseek.com`; salida al puerto 2000 del servidor ADS.
6. La cuenta con que corre el servicio (por defecto `SYSTEM`) necesita permiso de lectura al ERP y el driver ODBC instalado **a nivel de equipo** (64 bits).
7. Respaldos: copiar `data\crm.sqlite` (campañas) a diario. El warehouse y el staging se regeneran desde el ERP.

> Estos scripts fueron escritos para el servidor pero **solo se han probado localmente** hasta ahora: ejecutar la primera
> instalación en el servidor con acompañamiento y validar el reinicio automático.

---

## 7. Conexión con ADVANTAGE / Publidata

Se reutiliza **exactamente** la conexión de `fortuner-dashboards` (driver `Advantage StreamlineSQL ODBC`, `DataDirectory`
al `PUBLIDATA.add`, `ServerTypes`, `TrimTrailingSpaces`, `ShowDeleted=FALSE`, conexión `readonly`). El CRM tiene **su propio `.env`**
y **su propio extractor**, acotado a lo que alimenta el CRM (no depende del otro proyecto en ejecución).

| Tabla ERP | Qué es | Columnas que se leen (resumen) | Uso |
|---|---|---|---|
| `TIDSAL` | Maestro de productos y saldos por bodega | `INARTIC, INEAN, INNOMBRE, INMARCA, INTIPO, INSALDO00, INVRULTC, INVRVENTA1, INACTIVO, INBLOQUEO…` | Catálogo, stock, precio, costo |
| `TIDTAB` | Catálogo jerárquico (familia 3 díg. ⊃ departamento 5 ⊃ grupo 7) | `CTABCOD, CTABDES` | Nombres de familia/departamento/grupo/sección |
| `TIDTPRO` | Tipos de producto | `CODIGO, NOMBRE` | Filtro «tipo» |
| `TIDBODE` | Sucursales/bodegas | `CODIGO, NOMBRE, OCEDI` | Contexto |
| `POSCLI` | Clientes del POS | `CEDCLI, NOMCLI, EMAIL, TELCELU, SEXO, FECHAN, CIUCLI, INFOLEY, CLUB*` | Contactabilidad y demografía |
| `FADITE` | Líneas de factura | `IFFACT, IFFECHA, IFHORA, IFARTIC, IFCLIENTE, IFCANT, IFVLRNET, IFVLRDES, IFCOSTO, IFFAMILIA, IFDPTO, IFGRUPO, IFSECCION, IFNULO` | Historial de compra |

**Reglas de limpieza** (mismas que fortuner-dashboards): se excluyen líneas anuladas (`IFNULO='X'`), recibos de caja (factura con prefijo
`R`) y la tarjeta regalo (producto no venta). La cédula `222222222222` y cualquier cédula que no exista en `POSCLI` es «consumidor final»: se vende,
pero **no se puede segmentar**.

**Extracción:** por mes (una consulta corta con reintentos por cada mes), a Parquet con esquema fijo; los maestros se paginan con
`SELECT TOP n START AT m … ORDER BY clave`. La carga completa escribe en `staging.nuevo` y solo si todo salió bien reemplaza al staging vigente
(si falla, lo vigente queda intacto). Después se construye un archivo `crm_AAAAMMDD_HHMMSS.duckdb` nuevo y se publica de forma atómica (`CURRENT`);
la API sigue sirviendo la versión anterior mientras tanto.

---

## 8. Modelo de datos analítico

Construido por [`model.sql`](backend/crm/etl/sql/model.sql) en DuckDB:

| Tabla | Contenido |
|---|---|
| `venta` | Líneas depuradas (fecha, hora, producto, cliente, cantidad, neto, costo, jerarquía) |
| `producto` | Maestro + stock total + jerarquía de su última venta + `activo` |
| `producto_stats` | Rotación: última venta, unidades 30/90 d, venta 90 d, venta total |
| `agg_dia_producto` | Producto × día (acelera consultas de temporada) |
| `cliente` | Contacto validado (celular de 10 dígitos que empieza por 3, correo con formato válido), sexo, edad, clubes, **`autoriza_datos`** |
| `cli_dia`, `cli_perfil` | Visitas, ticket, intervalo entre compras, % de descuento, día/franja preferidos, compras por periodo |
| `cli_producto`, `cli_nivel`, `cli_marca` | Qué compra cada cliente (producto, familia/departamento/grupo, marca) |
| `cli_mes` | Visitas por mes calendario (estacionalidad individual) |
| `cli_rfm` | Quintiles R-F-M, **segmento RFM**, ratio y estado de **ciclo de recompra**, sensibilidad a descuento |
| `meta` | Cuándo se construyó, rango de fechas de ventas |

---

## 9. Módulo Campañas: las 5 pantallas

Ruta: `/campanas`. Estilo visual idéntico a *fortuner-dashboards* (menú azul marino, tarjetas, tipografía Inter, tema claro/oscuro).

1. **Historial** (`/campanas`): todas las campañas con estado (*Borrador paso N de 4* / ***Programada · vie 14 nov · 4:30 p. m.*** / *Publicada*), tarjeta con la próxima
   programada, filtros por estado y búsqueda, y por fila **Ver · Editar · Eliminar** (en las publicadas, *Duplicar como borrador*; en las programadas, *Cancelar programación*).
   Los borradores se guardan solos al avanzar de paso.
2. **Productos** (paso 1): tres pestañas
   - **Sugeridos por temporada (IA)**: calendario comercial (Feria de Manizales, Amor y Amistad, Halloween, Black Friday, Novenas, Navidad…) +
     inventario real → la IA elige y **explica la causa** de cada producto y propone combos.
   - **Por inventario y rotación**: sobrestock, baja rotación y productos sin ventas, con **causa, capital inmovilizado y descuento máximo referencial** (sin vender bajo costo). No usa IA.
   - **Búsqueda manual**: nombre / código de barras / ID + familia, departamento, grupo, sección, tipo y marca (encadenados por jerarquía), solo con stock, con ventas, días sin vender, orden.
3. **Mensaje** (paso 2): *Redactar con IA* (prompt + tono → 3 versiones) o *Mi redacción es la final* (**sin tokens**). Check-list de canales (WhatsApp, SMS, correo), vistas previas
   contador de caracteres y **cuántos SMS se cobrarían** (GSM-7 vs Unicode). Marcador `{nombre}` para personalizar. A la derecha, **«Así lo verá el cliente»**: un teléfono con
   **WhatsApp** (burbuja, hora, *negrita*/_cursiva_), un teléfono con la **app de mensajes (SMS)** y un **cliente de correo** (fila de la bandeja con asunto y vista previa +
   correo abierto con banner, párrafos, tarjetas de los productos con precio, botón y pie de baja). Se actualiza mientras se escribe y permite cambiar el nombre de ejemplo.
4. **Audiencia** (paso 3): recomendación de la IA + segmentadores en check-list (ver [§11](#11-segmentación-de-clientes)), presupuesto (tope de personas y costo por mensaje),
   resultado en vivo (alcance por canal, costo, curva de concentración, composición, los 25 mejores candidatos **enmascarados** con el porqué de cada uno).
   **Estrategias listas** (un clic): *Recompra a tiempo*, *Reactivar dormidos*, *Premiar a los mejores*, *Rotar inventario*, *Segunda compra*.
5. **Revisar y publicar** (paso 4): resumen de productos, vista previa realista, audiencia y costo; **calidad del mensaje** (lista de verificación con puntaje); lista de
   pendientes; **Cuándo publicar** (ahora o **programar día y hora**, con horario sugerido y grupo de control); confirmación. La publicación es **simulada**.

### API (prefijo `/api/campanas`, requiere clave)

| Método y ruta | Función |
|---|---|
| `GET /` · `POST /` · `GET/PUT/DELETE /{id}` · `POST /{id}/duplicar` | CRUD de campañas |
| `POST /{id}/publicar` | Publicación simulada **ahora o programada**. Cuerpo opcional: `{"programar_para": "2026-11-14T16:30", "control_pct": 10}`. Recalcula la audiencia en el servidor |
| `POST /{id}/cancelar-programacion` | La campaña programada vuelve a borrador (editable) y libera a sus destinatarios |
| `GET /temporadas` | Temporadas próximas (determinista) |
| `GET /productos/filtros` · `POST /productos/buscar` · `POST /productos/por-ids` | Catálogo con filtros |
| `POST /productos/recomendar-inventario` | Exceso de inventario / sin rotación |
| `POST /ia/recomendar-temporada` | Productos por temporada (IA + datos) — **usa tokens** |
| `POST /ia/redactar` · `POST /redaccion/validar` | Redacción por canal (IA) · validación sin tokens |
| `GET /segmentacion/opciones` · `POST /segmentacion/previsualizar` | Audiencia en vivo |
| `POST /ia/segmentacion/recomendar` | Perfil de comprador ideal (IA + datos) — **usa tokens** |
| `GET /api/sistema/estado` · `POST /api/sistema/etl` (admin) · `GET /api/salud` | Operación |

### Programación, grupo de control y calidad (iteración 2)

- **Estados**: `borrador → programada → publicada`. Una campaña *programada* no se edita (hay que cancelar la programación); sus destinatarios quedan **reservados**
  (cuentan para la regla «no contactar a quien recibió otra campaña en los últimos N días»), de modo que dos campañas programadas no se pisan.
- **Hora**: se interpreta en la **hora del servidor** (en el servidor Windows de Colombia = hora local), se guarda sin zona (`2026-11-14T16:30:00`); debe estar entre 2 minutos y 1 año
  en el futuro. Un **planificador** dentro de la API (`_planificador` en `api.py`) revisa cada 30 s y, al llegar la hora, publica la campaña (simulado) y deja constancia en `auditoria`.
  Al arrancar también publica las que vencieron mientras el servidor estaba apagado. *No* requiere tareas programadas adicionales de Windows; solo que el servicio esté en marcha.
- **Horario sugerido**: se calcula con el día de la semana y la franja (mañana/tarde/noche) en que más compra la audiencia elegida (`resumen.momento`) y propone enviar **poco antes**
  (8:30 / 12:30 / 16:30). En fin de semana limita la hora a las 12:00. El gráfico de barras muestra qué día compra la audiencia.
- **Aviso de horario (no bloquea)**: el **SMS comercial** debería enviarse L–V 7:00–19:00 y sáb., dom. y festivos 8:00–15:00 (Resolución CRC 5111 de 2017; **confirmar con asesor jurídico**: los festivos
  no están en el calendario del sistema). Cualquier canal avisa si se programa de madrugada/noche.
- **Grupo de control (0–20 %)**: reserva al azar una parte de la audiencia **sin enviarle nada**. La selección es determinista (`SHA-256(campaña:cliente) mod 100 < %`), independiente del puntaje,
  y queda guardada (`destinatario.grupo = 'control'`). Sirve para medir **ventas incrementales** (ver Roadmap). El costo se calcula solo sobre quienes sí reciben el mensaje, y los del control **no** cuentan
  como «contactados» para la regla anti-saturación.
- **Calidad del mensaje** (`frontend/src/lib/calidad.ts`): opción de baja, SMS en un solo mensaje, asunto ≤ 60 caracteres, texto de vista previa, asunto sin mayúsculas sostenidas, uso de `{nombre}`,
  oferta concreta y, si hay licor/tabaco, leyenda sanitaria («El exceso de alcohol es perjudicial para la salud», Ley 30 de 1986; **confirmar con asesor jurídico**). Son recomendaciones: no bloquean.
- **Migración automática**: la base SQLite existente se actualiza sola al arrancar (el `CHECK` del estado se reconstruye de forma atómica conservando todas las campañas; prueba incluida).

---

## 9.1 Clientes 360° (gestor de clientes)

Ruta: `/clientes`. **Estado: conectado a ADVANTAGE (copia de prueba `D:\ADD_FORTUNER`).** Lee y edita los 146.371 clientes de `POSCLI`, guarda
lo nuevo en tablas propias `CRM_*` (diccionario `D:\ADD_FORTUNER\CRM\CRM_FORTUNER.add`) y usa los catálogos de GANAPTOS en solo lectura.
Explicación para la empresa: [`docs/clientes-360-arquitectura.md`](docs/clientes-360-arquitectura.md) · análisis de tablas: [`docs/analisis-db-clientes.md`](docs/analisis-db-clientes.md).

**Cómo está construido**
| Pieza | Archivo | Qué hace |
|---|---|---|
| Conexiones | `backend/crm/modules/clientes/conexion.py` | ERP (`PUBLIDATA`), CRM (diccionario propio) y catálogos (tablas libres de GANAPTOS). Candado único de escritura. |
| Mapeo | `mapeo.py` | `POSCLI` ↔ ficha: lista blanca de columnas editables con su longitud real, llaves protegidas, fechas `AAAAMMDD`/`MMDD`, nombres en mayúsculas y `NOMCLI` recalculado. |
| Instalador | `esquema.py` · `crm clientes instalar` / `crm clientes estado` | Crea el diccionario del CRM **en el servidor donde corre** (versión correcta de Advantage), las 9 tablas `CRM_*` y la migración inicial desde `POSCLI` (clubes, mascotas, vehículos). Idempotente. |
| Índice | `indice.py` | Carga `POSCLI` + `CRM_*` + métricas de compra en DuckDB en memoria (~15–20 s) para buscar, filtrar y paginar 146 mil clientes en milisegundos. Se relee cada `CRM_CLIENTES_REFRESCO_MIN` y, por cliente, tras cada cambio. |
| Operaciones | `servicio.py` | Crear, editar (con versión optimista), desactivar, anonimizar, eliminar (solo sin movimiento), fusionar, mascotas, vehículos, clubes, notas, masivos e importación. Toda escritura: releer → comparar → auditar → `UPDATE … WHERE ROWID AND CODCLI` (exactamente 1 fila) → marcar auditoría. Sincroniza las banderas de `POSCLI` que usa la caja. |
| Consultas | `consultas.py` | Lista, KPI, calidad, duplicados (documento, celular, correo, nombre + nacimiento) y exclusión de inactivos en Campañas. |
| API | `router.py` · `/api/clientes/...` | Permisos del servidor: clave de uso → mercadeo; clave admin → administrador; `CRM_CLIENTES_ESCRITURA=false` → solo lectura. |
| Interfaz | `frontend/src/pages/clientes/` | Las mismas pantallas de la fase visual, ahora contra la API (`datos.ts` son hooks de TanStack Query). |

**Variables nuevas en `.env`**: `ADS_CRM_DIRECTORY`, `ADS_CRM_USER`, `ADS_CRM_PASSWORD` (10 a 20 caracteres, límite de Advantage), `ADS_CATALOGOS_DIRECTORY`,
`CRM_CLIENTES_ESCRITURA` (interruptor maestro), `CRM_CLIENTES_REFRESCO_MIN`, `CRM_CLIENTES_SUCURSAL_ALTA` (opcional).

**Reglas acordadas con los creadores de la base (se respetan desde el diseño)**
1. **Nunca se cambia la estructura** de las tablas del ERP (ni columnas ni tipos): solo se crean, leen, editan y eliminan **registros**.
2. **Integridad primero**: la llave del cliente (documento) **no se edita**; un cliente con compras **no se elimina físicamente** (se desactiva o se anonimiza); toda edición valida y queda en la auditoría.
3. Lo que el ERP no tenga (mascotas, afiliaciones, vehículos, notas…) vive en **tablas nuevas enlazadas al cliente** (`POSCLI`), sin tocar las existentes.
4. En producción las escrituras irán **directamente a la base original**; por eso esta fase se prueba con la copia y se analiza el diccionario antes de conectar.

**Pantallas**
| Pantalla | Qué hace |
|---|---|
| Lista (`/clientes`) | KPIs (activos, % que autoriza datos, % con celular/correo válido, ficha promedio), búsqueda (nombre, documento, celular, correo, mascota), **vistas rápidas** (cumpleaños de la semana, sin celular, sin consentimiento, valiosos con ficha incompleta, en riesgo, con mascotas) y **vistas guardadas propias**, filtros combinables, orden, paginación, **acciones masivas** (asignar club, etiquetar, exportar selección, desactivar), **exportar CSV** e **importar CSV** (valida primero, no pisa datos) |
| Ficha (`/clientes/:id`) | Cabecera con segmento, consentimiento y anillo de completitud. Pestañas: **Resumen** (KPIs, próxima recompra, canales autorizados), **Datos** (formulario completo con validación en vivo), **Mascotas**, **Afiliaciones**, **Vehículos**, **Compras** (solo lectura, vendrá de `FADITE`), **Actividad** (línea de tiempo con compras, campañas, cambios, notas y tareas) |
| Nuevo cliente (`/clientes/nuevo`) | Mismo formulario: identificación, contacto (celular colombiano y correo validados), ubicación en cascada departamento › ciudad › barrio, consentimiento (Ley 1581), etiquetas y observaciones |
| Baja | Tres caminos con la **regla de integridad visible**: *desactivar* (reversible), *anonimizar* (supresión; conserva llave y ventas) y *eliminar* (solo si nada lo referencia). Anonimizar/eliminar piden escribir el documento |
| Calidad de datos (`/clientes/calidad`) | Puntaje de salud de la base, 6 problemas con conteo y atajo a la lista, **cola de trabajo** con edición rápida de celular/correo en los clientes que más venden, y **posibles duplicados** (mismo celular, correo, o nombre + nacimiento) con asistente de **fusión** campo a campo |
| Afiliaciones (`/clientes/afiliaciones`) | CRUD de clubes (nombre, descripción, beneficios, vigencia, color, activo). Un club con socios no se elimina, se desactiva |
| Roles de prueba | Selector *Probar como*: **Administrador** (todo), **Mercadeo** (edita, no elimina/importa/fusiona) y **Solo lectura** (contacto enmascarado). Es una demostración: los roles reales llegarán con el login corporativo |

**Modelo (conceptual, por mapear al diccionario)**: `cliente 1—N mascota`, `cliente 1—N vehículo`, `cliente 1—N nota`, `cliente N—M afiliación` mediante `cliente_afiliación`
(ingreso, vencimiento, carné, estado) y `cambio` (auditoría campo a campo). Catálogos: departamentos, ciudades, barrios, profesiones, tipos/razas de mascota, marcas de vehículo
(equivalentes a `GANPROFE`, `GANAUTOS`, `GANMASCOTA`, `CIUDAD`, `DPTOS`, `GANBARRIO`).

**Análisis del diccionario (2026-11-13)** → [`docs/analisis-db-clientes.md`](docs/analisis-db-clientes.md): `POSCLI` columna por columna (qué se lee, qué se edita, qué nunca se toca),
relaciones implícitas con ventas (`FADITE.IFCLIENTE` trae **cédula o tarjeta**), catálogos `GAN*` ausentes en la copia, diseño de las tablas nuevas `CRM*`,
mecanismo de escritura segura y preguntas abiertas para los creadores de la base.

## 9.2 Analítica: tableros de clientes y de campañas

Menú **Analítica** (`/analitica/clientes` y `/analitica/campanas`). Mismo motor y estilo que `fortuner-dashboards`
(ECharts 6 con el tema Fortuner claro/oscuro; cada gráfica con ayuda, vista de tabla accesible y exportación CSV protegida
contra fórmulas). Solo **cifras agregadas**: nunca nombres, documentos ni datos de contacto. Los filtros quedan en la URL
(se puede compartir el enlace) y la librería de gráficas se descarga solo al abrir la Analítica.

**Tablero de clientes** (`GET /api/analitica/clientes`, filtros: club, segmento RFM, momento de compra, sexo, edad, ciudad,
consentimiento; clic en las barras de clubes, segmentos y ciudades también filtra):

| Bloque | Qué muestra | Fuente |
|---|---|---|
| Resumen | Clientes, con compras, activos a 90 días, autorizan, contactables, en clubes, ticket, venta, visitas, completitud | Índice de Clientes 360° (POSCLI + `CRM_*`, al día) |
| Actividad | Clientes por mes (nuevos vs recurrentes), fichas nuevas por mes, venta y gasto por visita mensual | Warehouse (`cli_dia`) + índice |
| Valor y fidelidad | Segmentos RFM, momento de compra, recencia, frecuencia y ticket | Índice (métricas del warehouse) |
| Clubes | Socios por club, ticket socios vs no socios, % activos y contactables por club, clientes en varios clubes, clubes que comparten socios, mascotas por tipo, vehículos | `CRM_AFILIACION_CLIENTE`, `CRM_MASCOTA`, `CRM_VEHICULO` |
| Quiénes y dónde | Pirámide edad × sexo (edad exacta), ciudades, sede de registro | Índice |
| Cómo compran | Mapa de calor día × hora, día y franja preferidos, categorías (grupo), departamentos, marcas, sedes, sensibilidad al descuento | Warehouse (`cli_dia`, `cli_perfil`, `cli_nivel`, `cli_marca`, `venta`) |
| Contactabilidad | Embudo clientes → con canal → autorizan → contactables (sin BLOQUE), consentimiento, canales autorizados, completitud | Índice |

**Tablero de campañas** (`GET /api/analitica/campanas`, filtros: periodo por fecha de lanzamiento y estado): campañas por
mes y estado, destinatarios y costo por mes, mensajes y costo por canal, objetivos, productos y categorías promocionados,
segmento y edad/sexo de quienes reciben, presión de contacto (personas × campañas), borradores por paso y la tabla de
todas las campañas con su medición.

**Efectividad (incrementalidad).** Para cada campaña lanzada se toma la ventana de su oferta (vigencia; si no tiene, 7 días
desde el lanzamiento) y se compara con las ventas del ERP: % del grupo **envío** que compró algún producto promocionado vs %
del grupo **control** (sin mensaje); venta de esos productos por persona en cada grupo; *venta incremental* =
(venta por persona envío − control) × personas del envío; *retorno* = incremental ÷ costo. Una campaña queda «sin ventas
aún» si su vigencia empieza después de la fecha de corte y «parcial» si la cubre a medias.

**Rendimiento.** Población (índice) y comportamiento (warehouse) se calculan en paralelo; la selección filtrada viaja al
warehouse como tabla Arrow (sin pasar fila a fila por Python). Cada combinación de filtros se guarda 5 minutos en caché
(clave: filtros + versión del warehouse + carga del índice + huella de campañas); con la base completa, la primera consulta
tarda ~3–4 s y las siguientes son inmediatas.

## 9.3 Automatizaciones

Menú **Automatizaciones**: campañas que se envían solas cuando un cliente cumple una condición. Los envíos hoy son
**simulados** (se calculan con los datos reales del ERP y se registran por cliente y día; no se manda ningún mensaje hasta
conectar la difusión real).

| Tipo | Se dispara | Parámetros (con límites) |
|---|---|---|
| Cumpleaños | El día del cumpleaños (fecha de nacimiento del ERP); el 29-feb se saluda el 28 en años no bisiestos | días antes (0–7) |
| Bienvenida | Cuando se crea la ficha (FECHAI) | días después (0–30) |
| Segunda compra | N días después de la primera compra, si aún no hay una segunda | días después (1–60) |
| Reactivación | Cuando lleva sin comprar más de X veces su intervalo habitual | umbral (1,2–6), mínimo de compras, máximo de días sin comprar |

Todos tienen **«no repetir a la misma persona antes de N días»** y **máximo de envíos por día** (prioriza a los de mayor
valor), además de filtros opcionales por club y segmento.

**Ediciones (personalización por periodo).** Cada automatización tiene ediciones con fechas (p. ej. «Cumpleaños 2026» del
1-ene al 31-dic: 10 % de descuento; «Cumpleaños 2027»: una torta de regalo). Cada día usa la edición que lo cubre; las
fechas de dos ediciones no se pueden cruzar, y «Para el año siguiente» copia una edición corrida un año. Una edición
define: la oferta (descuento en % o en pesos, producto, regalo u otro; el texto que reemplaza a `{oferta}`), la validez en
días desde el envío (`{vigencia}`), los canales y los mensajes (editor y vista previa de Campañas).

**Reglas que siempre se aplican** (las mismas de Campañas, contra el ERP en vivo y con falla cerrada): solo clientes activos
que autorizan sus datos y sin BLOQUE; sin menores de edad si la oferta o el mensaje mencionan licor o cigarrillo; solo por
los canales que el cliente tiene y autorizó. La pantalla **Probar** muestra, para cualquier día y edición, cuántos cumplen
la condición, cuántos lo recibirían, el costo y cuántos quedan fuera por cada motivo, sin registrar nada.

**Ejecución.** El planificador (cada 30 s) evalúa cada automatización activa una vez al día a su hora. La primera vez solo
cubre ese día (no le escribe a toda la base de golpe); si el servidor estuvo apagado recupera hasta 3 días. Repetirla el
mismo día no duplica envíos. Sin la lista de clientes del ERP, espera al siguiente ciclo. «Ejecutar hoy» (sin esperar la
hora) requiere la clave de administración. Los envíos automáticos cuentan como «contactado recientemente» para las
campañas y aparecen en la Analítica de campañas.

**Datos** (en `data/crm.sqlite`): `automatizacion`, `automatizacion_edicion`, `automatizacion_ejecucion` y
`automatizacion_envio` (un registro por cliente y día, con la vigencia de la oferta). API: `/api/automatizaciones`.

## 9.4 Fotos de producto

Las fotos se ven en Campañas (búsqueda, inventario, temporada, productos elegidos, resumen y la vista previa del correo) y
en las ofertas de Automatizaciones. Sin foto se muestra un ícono neutro.

**De dónde salen.** Se importan una vez desde la carpeta de fotos (`D:\images_static`, 21.617 archivos, 4,46 GB). El
nombre de cada archivo es el código del producto: el **código de barras** (`producto.ean`, también con ceros de más a la
izquierda) o el **código interno corto** (los últimos 6 dígitos del código del ERP, solo si es único). Análisis de la
carpeta (noviembre de 2026):

| Contenido | Archivos | ¿Se usa? |
|---|---|---|
| `products\` con producto en el catálogo | 9.033 (2,9 GB) | Sí: una por producto → 8.183 productos con foto |
| `products\` vacíos (0 bytes, descargas fallidas) | 4.125 | No. 2.088 son de productos vendidos en los últimos 90 días: hay que pedir esas fotos |
| `products\_sin_producto\` | 6.934 (1,9 GB) | No: no corresponden a ningún producto |
| `media\` (marcas, categorías, domiciliarios, *picking*…) | 1.516 | No: todos vacíos y de otra aplicación |

**Comando.** `crm imagenes importar --origen "D:/images_static"` (después de `crm modelo`): elige una foto por producto, la
valida, la convierte a WebP (600 px y miniatura de 160 px) y la guarda en `data/imagenes/productos/<producto_id>.webp`
(~200 MB; no va a git). Nunca modifica la carpeta de origen. Se puede repetir con la misma u otra carpeta: solo procesa
lo nuevo o lo que cambió, conserva lo ya importado y **borra las fotos de productos que ya no están en el catálogo**, así
que en `data/imagenes` solo quedan fotos útiles. Una vez importadas, la carpeta original se puede borrar.
`crm imagenes estado` dice cuántos productos tienen foto.

**Por qué así (y no en la base de datos ni leyendo la carpeta).** En ADVANTAGE no se puede cambiar la estructura; en
SQLite/DuckDB las fotos inflarían la base y el warehouse se reconstruye en cada carga; leer la carpeta original serviría
fotos de 300 KB (en WebP pesan ~23 KB), dependería de una ruta fija y el 58 % de su contenido no sirve.

**API.** `GET /api/productos/imagenes` (con clave) → qué productos tienen foto y la versión. `GET /media/productos/<id>.webp`
(`?t=mini` para la miniatura) es **pública a propósito**: un `<img>` no puede enviar la clave, son fotos de catálogo sin
datos personales y la difusión real necesitará enlazarlas. Solo acepta códigos numéricos dentro de `data/imagenes`; con
`?v=<versión>` el navegador la guarda en caché un año.

**Banner de la campaña (imagen del publicista).** En el paso Mensaje, «Imagen del mensaje → Cargar imagen» (JPG, PNG o
WebP hasta 8 MB; ideal horizontal 1200 × 628 px). Se ve al instante en la vista previa: en WhatsApp va arriba del texto
en lugar de la foto del producto (WhatsApp admite una sola imagen) y en el correo va debajo del encabezado. Cada imagen
de la vista previa tiene una **(x)**: quita el banner u oculta la foto (y la tarjeta) de un producto; «Mostrar de nuevo»
las recupera. Se guarda en el mensaje de la campaña (`banner` = {id, ancho, alto, nombre}; `fotos_ocultas` = códigos).
Seguridad: `POST /api/campanas/banners` (con clave) recibe la imagen, la valida con Pillow (formato, tamaño y
megapíxeles) y la **reescribe** como WebP de máximo 1200 px con un nombre aleatorio (se descartan metadatos y cualquier
contenido que no sea imagen). Se sirve en `/media/banners/<id>.webp`. El planificador borra cada hora los banners que
ninguna campaña usa y tienen más de 24 h. *Pendiente:* las ediciones de Automatizaciones aún no guardan banner.

---

## 9.5 Configuración (canales de difusión)

Menú **Más › Configuración**. Manual de uso: [`docs/MANUAL_CONFIGURACION.md`](docs/MANUAL_CONFIGURACION.md).

| Canal | Proveedores | Lo que pide (obligatorio) |
|---|---|---|
| WhatsApp | API de Meta (WhatsApp Business Platform) | token permanente, Phone number ID, WABA ID, versión Graph, plantilla de marketing aprobada (nombre, idioma, encabezado, variables `{{n}}`), costo |
| Correo | Gmail/Workspace (SMTP fijo) u otro SMTP | servidor, puerto, seguridad (STARTTLS/SSL, nunca sin cifrar), usuario, contraseña, remitente, límite diario, costo |
| SMS | Twilio, Infobip, LabsMobile o API HTTP genérica | credenciales del proveedor, remitente, indicativo, costo (genérico: URL https, encabezado de autenticación y cuerpo JSON con `{numero}` y `{mensaje}`) |

* **Un canal solo se usa si está completo y activo**: en el paso Mensaje (campañas y ediciones de automatizaciones) los
  demás se ven opacos y no se pueden elegir; publicar una campaña con un canal no disponible responde 422; una
  automatización solo envía por sus canales disponibles y, si no tiene ninguno, registra «sin canal» y no envía.
* **Secretos cifrados** (Fernet) en `crm.sqlite`; nunca vuelven a la pantalla (solo «guardado …últimos 4»). Clave:
  `CRM_CIFRADO_CLAVE` en `.env` o, si falta, `data/clave_cifrado.key` (respaldarla con la base). Sin la clave: estado
  «Credenciales ilegibles» y el canal queda no disponible (falla cerrada).
* **Permisos**: leer con la clave normal; guardar, probar y traer plantillas solo con la clave de administración.
  Cada cambio queda en `auditoria` (quién, cuándo y qué campos; nunca valores).
* **Probar conexión** valida las credenciales sin enviar mensajes (Meta: datos del número; SMTP: inicio de sesión;
  Twilio/Infobip/LabsMobile: cuenta o saldo). **Traer de Meta** lista las plantillas y llena nombre, idioma,
  encabezado y número de variables.
* El **costo por mensaje** de cada canal alimenta las estimaciones de Campañas, Automatizaciones y Analítica.
* API: `GET /api/configuracion`, `GET /api/configuracion/disponibles`, `PUT /api/configuracion/canales/{canal}`,
  `POST /api/configuracion/canales/{canal}/probar`, `POST /api/configuracion/canales/whatsapp/plantillas`.

**Pestañas de Configuración (además de Canales)** — tabla `configuracion_general` (una fila JSON por sección, con
valores por defecto si no se ha guardado nada):

| Pestaña | Qué hace | Dónde se aplica |
|---|---|---|
| Empresa | nombre, razón social, NIT, dirección, contacto, enlace y texto del botón de la tienda, redes, color; logo (`/media/empresa/logo.webp`) | vista previa de WhatsApp/SMS/correo, página de baja, IA (`redaccion.generar(empresa=…)`) |
| Legal y RNE | enlace o PDF de la política (`/media/legal/politica.pdf`), pie legal del correo, dirección pública del CRM, RNE (activo, canales, antigüedad máxima, exención de autorizados) | pie del correo; `restricciones_contacto()` suma bajas y RNE a `canales_bloqueados`; RNE vencido bloquea esos canales |
| Reglas de campañas | días sin contactar, % de control, vigencia máxima, comprador habitual, factor y tope del descuento | estrategias y campañas nuevas, `programacion.vigencia`, `segmentos.normalizar`, `productos.calculo_descuento` |
| Presupuesto | tope mensual por canal y % de alerta | `presupuesto.consumo()`; canal agotado = no disponible; publicar rechaza (422) si la campaña pasa el tope; aviso en la cabecera |
| Carga del ERP | carga diaria a una hora (por defecto 03:00) | planificador (`api.etl_programada`): una vez al día, ventana de 4 h |
| Fotos de productos | ver, verificar, subir/cambiar y quitar la foto de cada producto | manifiesto de `data/imagenes`; las subidas a mano quedan verificadas y la importación no las reemplaza |

* **Baja de suscripción:** enlace `/baja?t=<token Fernet>` (sin la cédula a la vista) → página pública con la marca →
  `baja_canal` (efecto inmediato en el CRM) y, si `CRM_CLIENTES_ESCRITURA=true`, INFOELEC/INFOTEX/INFOWAS = false en POSCLI.
* **RNE (Ley 2300 de 2023):** la CRC no tiene API pública; la empresa se inscribe en tramitescrcom.gov.co, descarga el
  listado y lo carga (CSV/TXT; se extraen celulares, fijos y correos) → `rne_registro`. Cubre SMS, apps, correo y llamadas;
  la CRC lo actualiza a diario y pide consultarlo antes de cada envío.
* `GET /api/configuracion/disponibles` devuelve además el **motivo** por el que un canal no se puede usar.

## 10. Cómo se usa la IA (DeepSeek)

Tres usos, todos con **JSON estricto**, reintentos con espera exponencial y conteo de tokens visible en pantalla:

| Uso | Entrada a la IA | Salida | Controles anti-error |
|---|---|---|---|
| Productos por temporada | Temporada (calendario) + **lista numerada** de productos reales (activos, con stock, rotando) | Selección con razón + combos | La IA solo puede elegir **números de la lista** (se valida): no puede inventar productos. Si falla, se usan reglas de datos |
| Redacción | Productos (nombre, marca, precio) + prompt del usuario + tono | Texto WhatsApp / SMS / correo | Prompt de sistema con reglas de longitud y baja; SMS largo se **reescribe** hasta caber en 1 mensaje |
| Perfil de audiencia | **Estadísticas agregadas** del comprador (porcentajes y *lift*) | Filtros recomendados + razones | Los filtros se **validan contra listas blancas**; lo desconocido se descarta |

**Privacidad:** a la IA **nunca** se envían nombres, teléfonos, correos ni cédulas de clientes; solo productos y estadísticas agregadas.
**Prompt injection:** el prompt del usuario y los nombres de producto viajan entre marcadores `<<<DATOS … DATOS>>>` y el sistema instruye ignorar órdenes ahí incluidas;
la salida se muestra como texto plano (React la escapa; no se inserta HTML).
**Costo:** una recomendación o redacción típica gasta ~1.200–2.500 tokens (centavos de dólar). El botón dice cuándo consume tokens; el modo manual no consume.

---

## 11. Segmentación de clientes

El objetivo es que cada peso de difusión llegue a quien más probablemente responda. Técnicas combinadas (todas sobre el historial real):

| # | Técnica | Qué mide / por qué sirve |
|---|---|---|
| 1 | **RFM en quintiles** → 10 segmentos (campeones, leales, potenciales, nuevos, prometedores, necesitan atención, no se pueden perder, en riesgo, hibernando, perdidos) | Valor y vigencia del cliente; cada segmento pide un mensaje distinto |
| 2 | **Ciclo de recompra personal** (`días sin comprar ÷ intervalo propio`) → compró hace poco / en ventana / atrasado / inactivo | Escribirle **cuando le toca comprar** rinde más que escribirle al azar |
| 3 | **Afinidad** con *noisy-OR*: `1 − (1−0,9·a_producto)(1−0,8·a_categoría)(1−0,5·a_marca)` | Combina «ya compró esto», «gasta en esta categoría» y «prefiere esta marca» como evidencias independientes |
| 4 | **Estacionalidad individual** (¿compra en los meses de la temporada?) | Clientes que ya reaccionan a esa fecha |
| 5 | **Sensibilidad al descuento** (terciles del % histórico) y **valor** (M) | Promociones solo a quien las aprovecha; premium a quien paga precio completo |
| 6 | **Hábitos** (día de la semana, franja horaria) | Programar el envío cuando el cliente suele comprar |
| 7 | **Demografía** (género, edad), **clubes** del POS, **ciudad** | Segmentación clásica, disponible como check-list |
| 8 | **Perfil del comprador ideal (*lookalike*)**: compara a quienes ya compran estos productos contra toda la base (*lift*) | La recomendación sale de **datos**, no de opinión; la IA la explica |
| 9 | **Reglas de contacto**: consentimiento, no saturar (excluir a quien recibió otra campaña en N días), exclusión de menores si hay licor/tabaco | Cumplimiento legal y cuidado del cliente |
| 10 | **Captación de nuevos compradores**: excluir a quienes ya compran los productos — los **habituales** (N o más facturas con alguno de ellos en los últimos D días; por defecto 3 en 180) o **todos** los que alguna vez los compraron — y puntuar a los demás por **parecido** (categoría, marca, valor), sin premiar la compra previa | Atraer clientes nuevos al producto sin gastar mensajes en quien ya lo compra de todas formas. Estrategia lista «Atraer nuevos compradores» |
| 11 | **Curva de concentración (Pareto) y corte recomendado** | Muestra cuánto potencial se captura con cada % de la audiencia (potencial relativo ∝ puntaje³, porque la respuesta se concentra en los mejores) → se recorta donde el costo marginal deja de valer la pena. El corte recomendado es el punto que captura el 80 % |

**Puntaje de propensión (0–100)** = `afinidad·w₁ + momento·w₂ + valor·w₃ + recencia·w₄ + estacionalidad·w₅ + descuento·w₆`, con pesos según el **objetivo**:

| Objetivo | Afinidad | Momento | Valor | Recencia | Estac. | Descuento |
|---|---|---|---|---|---|---|
| Equilibrado | .40 | .20 | .15 | .15 | .10 | — |
| Rotar inventario | .30 | .15 | .05 | .15 | .10 | .25 |
| Clientes de alto valor | .35 | .15 | .30 | .10 | .10 | — |
| Reactivar dormidos | .30 | .40 | .15 | .05 | .10 | — |
| Captar nuevos compradores | .45* | .10 | .20 | .15 | .10 | — |

\* En «Captar» la afinidad no cuenta «ya compró este producto» (`a_producto` pesa 0): solo el gasto en el mismo grupo o
familia y la preferencia por la marca. La marca «SIN MARCA» (20.857 de 21.613 productos) nunca cuenta como preferencia de
marca. **Cómo leer la curva en captación:** ordena a quienes no compran el producto por su parecido con quienes sí; suele
ser más plana que en una campaña de recompra (nadie tiene la evidencia fuerte de «ya lo compró»), así que el corte
recomendado deja a más personas. El bloque «Relación con estos productos» de «Quiénes son» muestra cuántos nunca lo han
comprado, lo compraron una vez o varias. Ejemplo real (Aguardiente Amarillo 750 ml, grupo Licores): 10.973 personas,
79 compradores habituales excluidos, 91 % nunca lo ha comprado.

**Limitación honesta:** es un modelo **heurístico y explicable**, no entrenado con respuestas reales (aún no existen). Mientras no se envíen campañas reales no se puede
calibrar «probabilidad de compra». El puntaje ordena bien (quién es mejor candidato que quién), pero **no** es una probabilidad. Ver [§16](#16-roadmap).

---

## 12. Auditoría: seguridad y efectividad

Revisión hecha sobre lo construido (✅ cumple · ⚠️ riesgo aceptado / pendiente).

### Seguridad

| Control | Estado | Detalle |
|---|---|---|
| Secretos fuera del repositorio | ✅ | `.env` ignorado por git; solo `.env.example`. El ERP y la API key de DeepSeek no están en el código |
| Autenticación | ✅ | Claves en `X-API-Key`/`Bearer`, comparación en tiempo constante; producción **no arranca** sin claves; clave de administración separada para la carga de datos |
| Inyección SQL | ✅ | 100 % consultas parametrizadas; los nombres de columna/orden salen de **listas blancas**; hay prueba que verifica que ningún valor del usuario entra al texto del SQL |
| Validación de entradas | ✅ | Pydantic con límites de tamaño/longitud; campos de producto con lista blanca; JSON de mensaje/segmentación acotado |
| XSS / contenido generado por IA | ✅ | React escapa todo; el texto de la IA nunca se inserta como HTML; CSP `default-src 'self'` |
| Cabeceras | ✅ | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`, CSP |
| Abuso de IA (costo) | ✅ | Límite de tasa por IP en `/ia/*` (30/min); ⚠️ detrás de un proxy todas las peticiones parecen de la misma IP: configurar el proxy para reenviar la IP real |
| Privacidad de clientes | ✅ | Muestra de audiencia **enmascarada** (`J*** P***`, `*** *** 4567`, `a***@dominio`); a la IA no viaja ningún dato personal |
| Consentimiento (Ley 1581) | ✅ / ⚠️ | Por defecto **solo** clientes con `INFOLEY = verdadero`; los que dijeron no, nunca; sin registro solo con opt-in explícito en pantalla. ⚠️ Confirmar con el área de datos que `INFOLEY` significa «autoriza tratamiento de datos» |
| Venta restringida | ✅ | Si hay licor/cerveza/vino/cigarrillos se excluyen menores y clientes sin fecha de nacimiento |
| Anti-saturación | ✅ | Los destinatarios de campañas publicadas se registran y pueden excluirse por N días |
| Auditoría de acciones | ✅ | Tabla `auditoria` (crear/editar/eliminar/publicar con IP). Borrado **lógico** |
| Acceso al ERP | ✅ | Solo lectura (`readonly`, modo compartido): no puede alterar ni bloquear el ERP |
| Errores | ✅ | Respuestas genéricas; el detalle (y el de DeepSeek) solo va al log |
| Dependencias | ⚠️ | Ejecutar `pip-audit` y `npm audit` antes de cada despliegue |
| Cifrado en tránsito | ⚠️ | Responsabilidad del proxy HTTPS del servidor (ver [§6](#6-despliegue-en-el-servidor-windows)) |
| Clave en el navegador | ⚠️ | Se guarda en `sessionStorage` (se borra al cerrar la pestaña). Mejora prevista: usuarios con rol y sesión (Active Directory / login) en lugar de una clave compartida |
| `data/crm.sqlite` guarda cédulas de destinatarios | ⚠️ | Restringir permisos NTFS de la carpeta `data\` y respaldarla cifrada |

### Efectividad

| Verificación | Resultado |
|---|---|
| Pruebas automáticas | 33 pruebas backend (calendario, SMS, filtros, SQL seguro, enmascarado, costos, CRUD, seguridad, regresión de publicación) + 7 de interfaz |
| Prueba de extremo a extremo con datos reales | ✅ Crear → elegir 26 vinos → mensaje manual → audiencia → publicar → verificar BD. **Encontró un error real** (ver abajo) |
| La IA no inventa productos | ✅ Solo acepta números del pool; verificado con el pool real |
| Cobertura de contacto | Ver [§15](#15-hallazgos-supuestos-y-decisiones-pendientes) (cifras reales de la carga) |
| Rendimiento | Previsualización de audiencia sobre toda la base: segundos (DuckDB) |

---

## 13. Difusión real (siguiente fase): recomendaciones

Hoy «Publicar» **no envía nada**. Para pasar a envío real, la propuesta (sin implementar todavía):

### Arquitectura

1. **Bandeja de salida (*outbox*)**: al publicar se generan filas `mensaje(campaña, cliente, canal, texto_personalizado, estado)`. Un **worker** (proceso aparte,
   tarea de Windows) las toma por lotes, respeta límites del proveedor, reintenta con espera y marca `enviado/entregado/leído/fallido`. Esto evita duplicados (clave de idempotencia) y permite pausar/reanudar.
2. **Webhooks** del proveedor (entregado, leído, respondió, rebotó, baja) → tabla `evento_mensaje`. Una respuesta «NO»/«STOP» o un enlace de baja crea de inmediato una **supresión** global que el segmentador siempre excluye.
3. **Grupo de control (*holdout*) del 5–10 %** que no recibe la campaña: es la única forma honesta de medir **ventas incrementales** (cruzando `FADITE` por cliente en los N días siguientes) y no confundir con quien igual iba a comprar.
4. **Franja y frecuencia**: ventana de envío por canal y tope de mensajes por cliente por semana (la analítica de hábitos ya calcula día y franja preferidos).
5. **Modo prueba (*dry-run*)** y **tope de presupuesto** por campaña; aprobación de un segundo usuario antes de enviar a más de N personas.

### Proveedores a evaluar (verificar tarifas y requisitos vigentes con cada uno)

| Canal | Opciones | Puntos críticos |
|---|---|---|
| **WhatsApp** | **WhatsApp Business Platform (Cloud API de Meta)**, directo o con un BSP (Infobip, Twilio, 360dialog, Gupshup…) | Las campañas son *plantillas de marketing* que Meta **aprueba antes**; se cobra por conversación/mensaje de categoría marketing; requiere **opt-in** del cliente; hay límites por nivel de calidad del número; el cliente puede bloquear y baja la calidad |
| **SMS** | Agregadores con cobertura Colombia (Infobip, Twilio, Labsmobile, Masiv, Hablame…) | 160 caracteres GSM-7 (70 con tildes/emojis); remitente/código corto; respetar el **Registro de Números Excluidos** de la CRC |
| **Correo** | Amazon SES, SendGrid, Brevo, Mailgun | Autenticar el dominio (**SPF, DKIM, DMARC**); cabecera `List-Unsubscribe` de un clic; tasa de quejas < 0,3 % (exigencia de Gmail/Yahoo para envíos masivos); manejar rebotes |

### Cumplimiento (Colombia) — validar con asesor jurídico

- **Ley 1581 de 2012 y decretos reglamentarios (Habeas Data)**: base de datos con autorización previa, expresa e informada; derecho a retirar la autorización. El CRM ya filtra por `INFOLEY`.
- **Ley 2300 de 2023 («Dejen de fastidiar»)**: restringe horarios y días de contacto con fines comerciales y exige respetar el canal que el consumidor elija. Parametrizar horarios de envío según la norma vigente.
- Toda pieza de SMS/WhatsApp debe traer **cómo darse de baja** (la IA ya lo incluye) y la baja debe aplicarse de inmediato en todos los canales.

---

## 14. Pruebas

```powershell
cd backend ; ..\.venv\Scripts\python -m pytest -q        # 67 pruebas
cd frontend ; npm test ; npm run build                  # 25 pruebas + tsc (tipos estrictos) + build
```

Cubren: calendario y fechas móviles, conteo de SMS (GSM-7/Unicode), normalización y saneamiento de filtros, ausencia de interpolación SQL, exclusión de menores,
enmascarado de datos, cálculo de costos sin doble cobro, tope por presupuesto, CRUD/borrado lógico/exclusión de recientes, autenticación, rol admin, cabeceras, validación de entradas y límite de tasa.
Iteración 2: validación de fechas programadas, planificador (solo publica las vencidas y es idempotente), cancelar programación, reserva de destinatarios, grupo de control determinista (≈ porcentaje pedido),
migración de una base antigua sin perder datos, momento de compra, horario de SMS y lista de calidad del mensaje.

---

## 15. Hallazgos, supuestos y decisiones pendientes

**Cifras reales de la primera carga completa (2026-11-11)** — extracción 100 % cuadrada con el ERP:

| Dato | Valor |
|---|---|
| Líneas de venta extraídas de `FADITE` | **23.937.386** (el conteo del ERP es idéntico) → 22.560.389 tras depurar anuladas/recibos/tarjeta regalo |
| Rango de ventas | 1-ene-2026 → 31-oct-2026 (el ERP está cargado hasta esa fecha; la pantalla muestra un aviso de «datos desactualizados» si pasan > 2 días) |
| Clientes registrados / con compras identificadas | 146.321 / 71.571 |
| Productos activos | 2.624 |
| Tiempos | Extracción ~34 min (solo lectura) · construcción del modelo ~1 min · previsualizar una audiencia sobre toda la base ~2,6 s · recomendación IA 5–8 s |
| Con celular válido (WhatsApp/SMS) | ~35 % de los clientes → **el alcance por WhatsApp/SMS es bastante menor que por correo** (p. ej. en una campaña de vinos: 26.870 candidatos autorizados, 3.188 con celular válido y 26.154 con correo válido) |


**Hallazgos del ERP**

- **El diccionario `PUBLIDATA.add` solo contiene el año 2026** (hoy 1-ene → 31-oct) y ~24 M de líneas de venta. Por eso:
  - «Qué se vendió en esta misma temporada el año pasado» **no se puede calcular todavía**. La pantalla lo avisa («sin ventas de esta temporada en años anteriores») y la recomendación se apoya en el calendario + rotación de 90 días.
  - **Acción sugerida:** ubicar las carpetas de años anteriores (p. ej. otros `.add` del ERP) y cargarlas; el modelo ya lo soporta (`CRM_ETL_MESES`).
- `FADITE.IFCLIENTE` coincide con `POSCLI.CEDCLI` (~70 % de las líneas traen cliente identificable; el resto es «consumidor final»).
- `POSCLI.INFOLEY`: ~69 mil verdadero, ~11 mil falso, ~67 mil vacío → con la política estricta, **casi la mitad de la base no es contactable**. Conviene campaña de captura de consentimiento en caja.
- Los productos que nunca se han vendido en 2026 no tienen jerarquía (familia/grupo) en el maestro: aparecen como «SIN FAMILIA».
- La «familia» del ERP es de un solo nivel útil (`GENERAL`); la jerarquía comercial real está en departamento › grupo › sección.

**Supuestos (por confirmar)**

1. `INFOLEY` = autoriza tratamiento de datos.
2. Costos por mensaje por defecto (WhatsApp $120, SMS $45, correo $3 COP) **son supuestos editables** en pantalla; confirmar con el proveedor elegido.
3. El descuento sugerido (margen × 60 %, tope 30 %) es **referencial**; el costo del ERP puede no incluir impuestos/fletes. Validar con Compras.
4. El stock se suma de todas las bodegas (incluye centros de distribución).
5. Las fechas de la Feria de Manizales son aproximadas (3–12 de enero); ajustar en `calendario.py`.

**Decisiones pendientes**

- ¿Usuarios con rol (vendedor / mercadeo / admin) y login corporativo en lugar de clave compartida?
- ¿Se permite contactar a clientes sin registro de consentimiento con alguna base legal distinta?
- ¿Quién aprueba el envío masivo (flujo de doble aprobación)?

---

## 16. Roadmap

1. **Cargar años anteriores del ERP** → activar estacionalidad histórica real.
2. **Difusión real** (ver §13) + registro de respuestas.
3. **Medición**: conversión por campaña, ventas incrementales con grupo de control (*el grupo de control ya se reserva al publicar; falta el tablero que lo compara*), ROI por canal.
4. **Segmentación supervisada**: con respuestas reales, reemplazar el puntaje heurístico por **regresión logística / gradient boosting** calibrado;
   modelos de **valor de vida (BG/NBD + Gamma-Gamma)**, **probabilidad de abandono** y **uplift** (a quién la campaña *cambia* la decisión, no solo quién compraría igual).
5. **Combos/canasta**: reglas de asociación (qué se compra junto) para proponer paquetes.
6. Usuarios, roles y permisos; automatizaciones (cumpleaños, reactivación, post-compra); Clientes 360°.

### Análisis de marketing y propuestas priorizadas

Visión de publicista/estratega para un retail de barrio-supermercado con ~72 mil clientes identificados. Principios: **(1)** cada mensaje debe tener una razón concreta para actuar
(producto + precio + límite en el tiempo), **(2)** el mejor mensaje es el que llega al cliente correcto en su ritmo de compra, **(3)** lo que no se mide no mejora, **(4)** el
cliente no es un recurso ilimitado: la saturación destruye la base.

**Ya incluido en la iteración 2:** estrategias listas, vista previa realista, programación con horario sugerido, grupo de control, lista de calidad/cumplimiento y duplicar campañas.

| # | Propuesta | Por qué vendería más | Esfuerzo | Depende de |
|---|---|---|---|---|
| 1 | **Tablero de resultados con ventas incrementales**: compras de los destinatarios vs. el grupo de control en los 7–14 días siguientes (ya tenemos `FADITE` por cliente) → conversión, venta incremental, ROI y costo por venta incremental | Cierra el ciclo: dice qué campañas valen la pena y cuáles regalan margen. Sin esto, todo lo demás es intuición | Medio | Grupo de control (hecho) y ETL diario |
| 2 | **Pruebas A/B**: dos versiones (asunto, gancho u oferta) a 10 % + 10 % y el ganador al resto; la IA genera las variantes | El asunto/gancho puede mover la apertura 20–40 %; aprende qué funciona con *su* público | Medio | #1 |
| 3 | **Capacidad de stock y estimador de resultado**: antes de publicar, comparar la demanda esperada (audiencia × conversión supuesta) con el inventario, y mostrar un rango conservador/esperado/optimista | Evita el peor error de una promoción: agotar el producto o dejar inventario sin mover | Bajo | Stock (ya está), tasas editables |
| 4 | **Recorridos automáticos (journeys)**: *segunda compra* (7 días tras la primera), *reactivación* (cuando se pasa su ciclo propio), *post-compra con venta cruzada* y **cumpleaños** | Es el marketing de mayor ROI en retail: ocurre en el momento justo, sin esfuerzo humano | Alto | Difusión real, #1 |
| 5 | **Captura de consentimiento y de contacto**: ~la mitad de la base no es contactable (`INFOLEY` vacío) y solo ~35 % tiene celular válido; guion en caja + enlace de doble confirmación por correo + sorteo/beneficio | Duplica el alcance sin gastar un peso en pauta; reduce el riesgo legal | Bajo | Proceso en tienda |
| 6 | **Personalización por producto favorito** (`{producto_favorito}`, `{ultima_compra}`): «Tu pechuga de siempre está a $13.900» en vez de un mensaje igual para todos | Pasa de segmentación por grupos a *una oferta por persona*; sube conversión y reduce bajas | Medio | `cli_producto` (ya está) |
| 7 | **Ofertas escalonadas por segmento**: VIP = beneficio/acceso anticipado (sin descuento), sensibles a precio = descuento, dormidos = incentivo mayor; con tope de margen | No regalar descuento a quien compraría igual (el *gasto en descuento* es el mayor costo oculto) | Medio | Margen por producto (ya está) |
| 8 | **Cascada de canales**: correo primero (barato); a quienes no lo abrieron en 24 h, WhatsApp/SMS solo si el cliente es de valor | Baja el costo por cliente alcanzado sin perder cobertura | Medio | Difusión real |
| 9 | **Calendario de campañas**: vista mensual con temporadas, campañas programadas y alerta de choques/saturación (máx. N mensajes por cliente por semana) | Planificación visual; evita que dos áreas hablen al mismo cliente el mismo día | Medio | Programación (hecha) |
| 10 | **Audiencias guardadas** («Mis audiencias») y **biblioteca de mensajes ganadores** con voz de marca para la IA | Ahorra tiempo y mantiene coherencia de marca | Bajo | — |
| 11 | **Códigos/QR canjeables en caja** por campaña (o por cliente) | Atribución exacta de ventas y sensación de exclusividad | Medio | Integración con caja |
| 12 | **Modelo supervisado y de *uplift*** (a quién la campaña *cambia* la decisión) | Concentra el presupuesto en quienes realmente responden por el mensaje | Alto | Respuestas reales (#1) |

**Orden recomendado:** 3 → 1 → 5 → 2 → 6 → 4. (3 y 5 son rápidos y de gran impacto; 1 habilita medir todo lo que sigue; 2, 6 y 4 se apoyan en esa medición.)

---

## 17. Bitácora de cambios

| Fecha | Cambio |
|---|---|
| 2026-11-11 | **Inicio del proyecto.** Conexión a ADVANTAGE/Publidata (solo lectura) validada: 146.371 clientes, 51.938 filas de saldos de producto, ~24 M de líneas de venta (2026). Extractor propio, modelo DuckDB, API FastAPI, almacén SQLite. |
| 2026-11-11 | **Auditoría de extremo a extremo.** Error encontrado y corregido: al publicar, el servidor leía mal los filtros guardados (`segmentacion.filtros`) y publicó a toda la base en vez de respetar tope de personas, objetivo y exclusión de contactados recientes. Ahora `filtros_de_campana()` reconstruye exactamente lo previsualizado (con prueba de regresión) y se verificó que dos campañas seguidas **no se solapan** (0 destinatarios repetidos). Además: CSP sin scripts en línea; productos sin precio ($0 en el ERP) se avisan y no se le dan a la IA; curva de concentración con potencial ∝ puntaje³. |
| 2026-11-11 | **Módulo Campañas (victoria temprana #1):** historial, selección de productos (IA por temporada + inventario + filtros), redacción por canal (IA o manual), segmentación multi-técnica con IA, revisión y publicación simulada. 31 pruebas automáticas. Scripts de instalación/servicio para Windows. |
| 2026-11-12 | **Iteración 2.** *Corrección:* al marcar filtros del paso Audiencia la pantalla «se salía» (el input oculto de cada casilla, `sr-only`/`position:absolute`, quedaba anclado fuera del panel con scroll y, al enfocarlo, el navegador desplazaba la página entera). Ahora cada casilla es `relative`, `html/body` usan `overflow: clip` y el panel de resultados tiene su propio scroll. *Nuevo:* vista previa realista (WhatsApp, SMS, correo); programación de publicaciones con planificador, horario sugerido y avisos de horario; grupo de control; estado *programada* en el historial (con migración automática de la base); lista de calidad/cumplimiento; estrategias de audiencia listas; análisis de marketing y propuestas (§16). También se corrigió que, tras publicar un borrador existente, aparecía «no se puede editar» en lugar de la pantalla de confirmación. |
| 2026-11-13 | **Clientes 360° (fase visual).** Gestor de clientes completo sobre datos de demostración: lista con vistas/filtros/acciones masivas/importar/exportar, ficha con 7 pestañas, formulario con validación, baja con regla de integridad (desactivar/anonimizar/eliminar), calidad de datos con cola de trabajo y fusión de duplicados, catálogo de afiliaciones y roles de prueba. 12 pruebas nuevas de validadores y reglas de integridad. Sin conexión a ADVANTAGE: pendiente del análisis del diccionario (§9.1). |
| 2026-11-13 | **Análisis del diccionario** (`docs/analisis-db-clientes.md`): 114 tablas, `POSCLI` columna por columna, relaciones implícitas, riesgos (`Actu_diccionario.sql` borra columnas de `POSCLI`; `TIDGON` desincronizada). |
| 2026-11-13 | **Clientes 360° conectado a ADVANTAGE.** Diccionario propio del CRM con 9 tablas `CRM_*` (instalador idempotente), migración inicial (92.045 afiliaciones, 38.809 mascotas, 24.998 vehículos), catálogos de GANAPTOS, índice en memoria, API `/api/clientes` con permisos y auditoría completa, interfaz conectada. *Correcciones en Campañas:* las ventas con **número de tarjeta** ahora se atribuyen al cliente (antes se perdía ~23 % de la venta con cliente); los registros genéricos del POS (CONSUMIDOR FINAL, 2222222222) y los correos genéricos de factura electrónica ya no cuentan como clientes ni como contactables; los clientes inactivos o anonimizados en el CRM no entran en campañas. Respaldo previo en `D:\RESPALDOS_CRM`. 17 pruebas nuevas de backend; prueba de punta a punta sobre la copia sin tocar clientes reales. |
| 2026-11-17 | **Auditoría fase 2.** Datos: una línea es venta si su artículo es un código de producto (se recupera la serie RO de la sucursal 83 y las series R con productos); recencia y ciclo contra la **fecha de corte** de los datos; edad exacta (años cumplidos) y fecha de nacimiento MMDD+ANON. Consentimiento: «No autoriza» marca `BLOQUE=false` en POSCLI y «Sí autoriza» lo vacía; Campañas verifica consentimiento, BLOQUE, estado, edad y canales contra el ERP en vivo al calcular, publicar y ejecutar las programadas (falla cerrada). Campañas: vigencia obligatoria con marcador `{vigencia}`, sin invitación a responder NO, el asistente ya no arrastra otra campaña. **Después de actualizar: `crm etl`.** |
| 2026-11-20 | **Productos y gráficas.** *Corrección:* la búsqueda de productos no encontraba, por ejemplo, ningún aguardiente: el modelo tomaba `INBLOQUEO = 'Z'` como bloqueo (lo tiene la mitad del catálogo, incluidos los más vendidos) y solo 2.624 de 21.613 productos quedaban activos; ahora 11.568. Además, buscar por nombre o código revisa todo el catálogo (con la etiqueta «Inactivo en el ERP» cuando aplica) y «solo activos» incluye lo vendido en 90 días. *Nuevo:* «¿Cómo se calculó?» en el descuento sugerido (margen × 60 %, tope 30 %, con precio y ganancia resultantes). Los días sin venta ya no salen negativos. Pirámides de edad: mujeres en menta y hombres en azul. **Después de actualizar: `crm modelo`.** |
| 2026-11-18 | **Automatizaciones (§9.3).** Cumpleaños, bienvenida, segunda compra y reactivación, con ediciones por periodo (oferta y mensajes distintos por año), las reglas legales de Campañas, prueba «¿a quién le tocaría?», historial de ejecuciones y planificador diario. Envíos simulados por cliente y día que cuentan como contacto reciente y se ven en la Analítica de campañas. 14 pruebas nuevas de backend. |
| 2026-11-23 | **Fotos de producto (§9.4).** Análisis de `D:\images_static` (21.617 archivos, 4,46 GB: solo 9.033 sirven; el resto son archivos vacíos, fotos sin producto y otra aplicación). Nuevo comando `crm imagenes importar` que deja solo las fotos de productos del catálogo, en WebP (8.183 productos, ~200 MB), y las muestra en Campañas y Automatizaciones. Banner del publicista en WhatsApp y correo («Cargar imagen» en el paso Mensaje) y (x) para quitar fotos de la vista previa. Segmentación: estrategia «Atraer nuevos compradores» (excluye compradores habituales o todos; objetivo «Captar»), y «SIN MARCA» deja de contar como afinidad de marca. Nueva dependencia: Pillow. **Después de actualizar: `bash scripts/instalar.sh` y `crm imagenes importar --origen "D:/images_static"`.** |
| 2026-11-23 | **Configuración (§9.5).** Canales WhatsApp (API de Meta, con plantilla y variables), correo (Gmail u otro SMTP) y SMS (Twilio, Infobip, LabsMobile o API HTTP) configurables desde la interfaz, con secretos cifrados, «Probar conexión» sin enviar mensajes y plantillas traídas de Meta. Un canal incompleto o desactivado se ve opaco y no se puede usar. Nueva dependencia: cryptography. Manual: `docs/MANUAL_CONFIGURACION.md`. **En el servidor: agregar `CRM_CIFRADO_CLAVE` al `.env` antes de configurar los canales.** |
| 2026-11-24 | **Configuración, segunda parte (§9.5).** Pestañas Empresa (marca y logo en las vistas previas y la IA), Legal y RNE (política, pie del correo, baja de suscripción con página pública y Registro de Números Excluidos importado), Reglas de campañas (antes fijas), Presupuesto (topes mensuales con alertas y bloqueo), Carga automática del ERP a una hora y Fotos de productos una a una (verificar, subir, quitar). Corrección: «SIN MARCA» ya no cuenta como afinidad de marca. Manual: `docs/MANUAL_CONFIGURACION.md` v2. |
| 2026-11-17 | **Analítica (§9.2).** Tablero de clientes (clubes, comportamiento, demografía, contactabilidad) y tablero de campañas (alcance, costo, canales, presión de contacto y efectividad envío vs control). Campo de vigencia: se pueden escribir 31 días o más (hasta 90) y botón «Hasta fin de mes». 8 pruebas nuevas de backend y 5 de frontend. |
| 2026-11-13 | **Rediseño visual Fortuner 27** (solo visual, `GUIA_REDISENO_MODULOS.md`): logo, paleta y tipografía Poppins de Fortuner; cabecera de dos filas en lugar de la barra lateral (grupos con menú desplegable, también en celular); botones, campos, tarjetas, tablas, insignias, alertas, modales y pestañas con el nuevo aspecto; pantalla de clave de acceso con el diseño de ingreso de Fortuner. Sin cambios de rutas, API, permisos ni lógica. |
