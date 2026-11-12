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
9. [Módulo Campañas: las 5 pantallas](#9-módulo-campañas-las-5-pantallas)
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
| Medición de resultados / modelo supervisado | ⏳ Pendiente | Requiere difusión real para tener respuestas |
| Clientes 360°, automatizaciones | ⏳ Pendiente | Aparecen en el menú como «Próximamente» |

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
│   │   ├── cli.py               comandos: probar-ads, etl, modelo, servir
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
│   └── tests/
├── frontend/                    React + Vite + Tailwind (mismos tokens visuales que dashboards)
│   └── src/pages/campanas/      Historial · Wizard · PasoProductos · PasoMensaje · PasoSegmentacion · ResumenCampana · Detalle
├── scripts/                     instalar · cargar-datos · iniciar · instalar-servicio (PowerShell)
├── .env.example                 plantilla de configuración (el .env real NO se versiona)
└── data/                        (ignorado por git) staging, warehouse, crm.sqlite, logs
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
| 10 | **Curva de concentración (Pareto) y corte recomendado** | Muestra cuánto potencial se captura con cada % de la audiencia (potencial relativo ∝ puntaje³, porque la respuesta se concentra en los mejores) → se recorta donde el costo marginal deja de valer la pena. El corte recomendado es el punto que captura el 80 % |

**Puntaje de propensión (0–100)** = `afinidad·w₁ + momento·w₂ + valor·w₃ + recencia·w₄ + estacionalidad·w₅ + descuento·w₆`, con pesos según el **objetivo**:

| Objetivo | Afinidad | Momento | Valor | Recencia | Estac. | Descuento |
|---|---|---|---|---|---|---|
| Equilibrado | .40 | .20 | .15 | .15 | .10 | — |
| Rotar inventario | .30 | .15 | .05 | .15 | .10 | .25 |
| Clientes de alto valor | .35 | .15 | .30 | .10 | .10 | — |
| Reactivar dormidos | .30 | .40 | .15 | .05 | .10 | — |

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
cd backend ; ..\.venv\Scripts\python -m pytest -q        # 50 pruebas
cd frontend ; npm test ; npm run build                  # 17 pruebas + tsc (tipos estrictos) + build
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
