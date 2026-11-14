# Guía de rediseño visual para los módulos operativos de Fortuner

> Documento para copiar en la raíz de cada proyecto (Cartera, Contabilidad,
> Inventarios, Pedidos, Sugeridos, etc.) y usarlo como instrucción de trabajo,
> por una persona o por un agente de IA.
>
> Referencia de origen: proyecto **FORTUNER27**, commit `4dcee7c`
> ("Aplica la nueva identidad visual de Fortuner al ingreso y al catálogo").
> Última actualización: 2026-11-12 (revisión 2: navegación solo horizontal).

> **Diseño aprobado: catálogo versión 2 (combinación 3).** Toda la navegación
> va en la **cabecera superior**, con una barra horizontal de opciones y menús
> desplegables. **No se usa barra lateral** en ningún módulo. La versión 1, con
> menú lateral y botón "Contraer", fue descartada. Si el módulo ya tiene una
> barra lateral, se debe convertir siguiendo la sección 7.4.

## 1. Objetivo y alcance

Dejar la interfaz de cada módulo coherente con el nuevo catálogo de FORTUNER27:
mismo logotipo, paleta, tipografía, cabecera, componentes y tono visual, de
modo que el usuario sienta que pasa de una pantalla a otra dentro de **un solo
sistema**.

**Es únicamente un cambio visual.** No se debe modificar:

- rutas, endpoints, contratos de API, nombres de campos ni consultas;
- autenticación, manejo de sesión ni el canje del código `fortuner_code`;
- reglas de negocio, validaciones, cálculos, permisos ni orden de los datos;
- puertos, variables de entorno, scripts de arranque ni `Config/modules.json`;
- textos funcionales de columnas, etiquetas de datos o mensajes del servidor.

Si un cambio visual exige tocar cualquiera de esos puntos, **detenerse y
consultar** antes de continuar.

## 2. Qué se toma de FORTUNER27

El proyecto de referencia está como carpeta hermana: `..\Fortuner27`. Archivos
a consultar (solo lectura, no se modifican desde el módulo):

| Para qué | Archivo |
|---|---|
| Cabecera, menú, tarjetas, accesos rápidos | `Fortuner27/Frontend/src/App.tsx` |
| Ingreso (si el módulo tiene pantalla propia) | `Fortuner27/Frontend/src/AuthGate.tsx` |
| Paleta y fuente | `Fortuner27/Frontend/src/index.css` |
| Logos e isotipo | `Fortuner27/Frontend/public/fortuner-*.png` |
| Maquetas aprobadas (referencia visual) | `Fortuner27/Maquetas/` |

## 3. Recursos de marca

Copiar a la carpeta de archivos estáticos del módulo (`public/`, `static/` o
equivalente):

| Archivo | Uso |
|---|---|
| `fortuner-logo-oscuro.png` | Logo blanco con color, **sobre fondos azul oscuro** (cabecera). Ya viene recortado al borde, sin márgenes. |
| `fortuner-logo-claro.png` | Logo a color **sobre fondos claros** (pie, impresos, pantallas de carga). |
| `fortuner-isotipo.png` | La "F" sola: favicon, marca de agua, indicadores de carga. |

Reglas de uso del logotipo:

- No deformar, recolorear ni añadir sombras al logotipo.
- En la cabecera compacta usar ancho de **170 px** en celular y **220 px** en
  escritorio; en cabeceras amplias, hasta 560 px.
- Cambiar el favicon del módulo por `fortuner-isotipo.png`.
- Reemplazar cualquier logo anterior (DSI, "Fortuner 25", etc.) por estos.

## 4. Paleta cromática

Tomada de `Logotipo/formato editable/paleta cromática`.

**Fondos y estructura**

| Nombre | Hex | Uso |
|---|---|---|
| Azul oscuro 1 | `#003760` | Cabecera, textos destacados de marca |
| Azul oscuro 2 | `#002D49` | Texto principal, fin del degradado |
| Gris claro 1 | `#DFE2E5` | Bordes de campos, separadores marcados |
| Gris claro 2 | `#F7F7F7` | Fondo de página, fondo de campos |

**Colores del logotipo (acentos)**

| Nombre | Hex | Uso |
|---|---|---|
| Azul claro 1 | `#0F70FC` | **Acción principal**, enlaces, foco |
| Azul claro 2 | `#33B1FF` | Acento secundario, degradados |
| Verde menta | `#21CC93` | Éxito, "activo", acento de marca |
| Verde esmeralda | `#1FCEC4` | Acento secundario, degradados |

**Complementarios (no son de la paleta de marca, definidos para la interfaz)**

| Uso | Hex |
|---|---|
| Texto secundario | `#5B6B7A` |
| Texto tenue / iconos | `#8A97A3` |
| Borde suave de tarjetas | `#E6E9EC` |
| Error: fondo / borde / texto | `#FDECEC` / `#F5C2C2` / `#B42318` |
| Advertencia (estrellas, avisos) | `#F5B301` |
| Éxito sobre fondo claro (texto) | `#13A374` |
| Violeta, solo para el área Analítica | `#5B5FF7` |

**Color de acento por área** (el mismo del catálogo). Úsese solo para detalles
pequeños que identifiquen al módulo (la etiqueta de la cabecera, su icono),
**no** para los botones principales, que son siempre `#0F70FC`:

| Área | Color | Módulos típicos |
|---|---|---|
| Financiera | `#0F70FC` | Cartera, Contabilidad, Bancos, Presupuesto |
| Comercial | `#21CC93` | Pedidos, Facturación, CRM, POS |
| Logística | `#1FCEC4` | Inventarios, Sugeridos, Compras |
| Administrativa | `#33B1FF` | Nómina, Activos fijos |
| Analítica | `#5B5FF7` | Analítica BI |

## 5. Tipografía

**Poppins** (400, 500, 600, 700) para toda la interfaz. Cargarla en el CSS
global; `Inter` y la fuente del sistema quedan como respaldo.

```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

body { font-family: 'Poppins', 'Inter', system-ui, sans-serif; }
```

Escala sugerida: título de pantalla 24 px / 600; título de sección 15–16 px /
600; texto de tabla y formulario 13–14 px; etiquetas pequeñas 11–12 px.
Para cifras monetarias o códigos se puede conservar la fuente monoespaciada que
ya use el módulo.

## 6. Variables de diseño

Definirlas una sola vez y usarlas en todo el módulo, en lugar de colores
escritos a mano.

**CSS (cualquier proyecto):**

```css
:root {
  --fx-navy: #003760;
  --fx-navy-deep: #002D49;
  --fx-gray: #DFE2E5;
  --fx-bg: #F7F7F7;
  --fx-mint: #21CC93;
  --fx-emerald: #1FCEC4;
  --fx-blue: #0F70FC;
  --fx-sky: #33B1FF;
  --fx-text: #002D49;
  --fx-text-soft: #5B6B7A;
  --fx-text-faint: #8A97A3;
  --fx-border: #E6E9EC;
  --fx-error-bg: #FDECEC;
  --fx-error-border: #F5C2C2;
  --fx-error: #B42318;
}
```

**Tailwind v4** (en `index.css`, dentro de `@theme`):

```css
@theme {
  --color-fortuner-navy: #003760;
  --color-fortuner-navy-deep: #002D49;
  --color-fortuner-gray: #DFE2E5;
  --color-fortuner-bg: #F7F7F7;
  --color-fortuner-mint: #21CC93;
  --color-fortuner-emerald: #1FCEC4;
  --color-fortuner-blue: #0F70FC;
  --color-fortuner-sky: #33B1FF;
  --font-sans: 'Poppins', 'Inter', system-ui, sans-serif;
}
```

Fondo de la cabecera (idéntico al catálogo):

```css
background:
  radial-gradient(700px 320px at 100% 0%, rgba(31,206,196,.22), transparent 70%),
  radial-gradient(600px 300px at 0% 100%, rgba(15,112,252,.3), transparent 70%),
  linear-gradient(120deg, #003760, #002D49);
```

Medidas generales: radio de tarjetas 18–20 px; radio de campos y botones
12 px; radio de chips 999 px; borde 1 px `#E6E9EC`; sombra de elevación
`0 20px 36px -22px rgba(0,45,73,.5)`; el contenido va centrado con ancho
máximo cercano a 1320 px y márgenes de 16 px en celular y 32 px en escritorio.

## 7. Estructura de pantalla

### 7.1 Cabecera compacta (obligatoria en todas las pantallas)

Es la misma que usan las pantallas internas de FORTUNER27. Va arriba, a todo
el ancho, con el fondo degradado de la sección 6. Tiene **dos filas** y es el
**único lugar** donde están el logo y la navegación:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [LOGO] | Nombre del módulo  (contexto)  (contexto)    🔔 ?  [Usuario ⎋]    │  ← fila 1
├────────────────────────────────────────────────────────────────────────────┤
│ Inicio  Grupo A ▾  Grupo B ▾  Opción directa  …                  Más ▾     │  ← fila 2
└────────────────────────────────────────────────────────────────────────────┘
│                                                                            │
│                 Contenido de la pantalla, a todo el ancho                  │
```

**Fila 1: identidad y contexto**

- **Logo** `fortuner-logo-oscuro.png`, 170 px (celular) / 220 px (escritorio).
  El logo va aquí, nunca en un panel lateral.
- Separador vertical fino (`white/15`) y el **nombre del módulo** en 18 px / 600.
- **Chips de contexto:** sucursal, compañía, periodo o lo que el módulo ya
  muestre. Fondo `white/8`, borde `white/12`, radio 999 px, texto 12,5 px; el
  principal lleva un punto verde menta con halo. Si un chip ya tiene una acción
  (por ejemplo "Cambiar compañía"), la conserva. En celular se reducen al punto
  o al código.
- **Buscador del módulo**, solo si ya existe: campo translúcido (`white/10`) que
  al enfocarse pasa a fondo blanco.
- **Acciones:** notificaciones, ayuda, asistente u otras, **solo si el módulo ya
  las tiene**. Botones de 40 px, icono `white/75`, hover `white/10`.
- **Usuario:** avatar con las iniciales (degradado verde menta → azul
  `#0F70FC`), nombre y rol/código. Conserva el comportamiento actual de cerrar
  sesión o salir.
- Isotipo como marca de agua (opacidad 8 %, ancho 180 px) en la esquina
  derecha, recortado por la cabecera.

**Fila 2: navegación del módulo** (detalle en la sección 7.2).

Los datos de usuario, sucursal o compañía salen de lo que el módulo **ya
obtiene hoy** de su sesión; no crear llamadas nuevas.

### 7.2 Navegación del módulo: siempre horizontal

**No se permite barra lateral** (`<aside>` fija a la izquierda, menú
"hamburguesa" que abre un panel lateral ni botón "Contraer"). Toda la
navegación va en la fila 2 de la cabecera.

Aspecto común de la barra:

- Opciones en 13,5 px con icono de 17 px; inactivas en `white/70`, hover
  `white/5`.
- **Opción activa:** texto blanco y semibold, icono verde menta y línea
  inferior de 3 px con degradado `#21CC93 → #33B1FF`.
- Un **grupo** está activo cuando la pantalla actual pertenece a él: se marca
  igual que una opción activa.
- **Inicio** (el tablero o la pantalla principal del módulo) va primero.
- Separador superior de la fila: `border-t white/10`.

Elegir el patrón según el número de opciones del módulo:

| Caso | Patrón |
|---|---|
| **Hasta 8 opciones, sin grupos** | Todas como pestañas directas. |
| **Más de 8 opciones, sin grupos** | Las más usadas como pestañas directas y el resto en un desplegable **"Más"** a la derecha. |
| **Opciones organizadas en grupos** (por ejemplo, Contabilidad: Movimientos, Consultas, Informes, Medios magnéticos, Configuración, Administración) | Cada grupo es una pestaña con flecha ▾ que abre su **menú desplegable**. Las opciones sueltas (Reprocesos, Cierres, Consolidación…) van como pestañas directas. Si aun así no caben, los grupos menos usados pasan a **"Más"**. |

**Menú desplegable de grupo:**

```
 Movimientos ▾  Consultas ▾  Informes ▾ …
 ┌──────────────────────────────────────────────────────────────┐
 │ CONSULTAS                                                    │
 │  Documentos              Anual por cuenta     Saldos cta/ccto│
 │  Movimiento mensual      Anual por tercero    Documento esp. │
 │  Saldos anuales          Anual por centro     Comparativos   │
 └──────────────────────────────────────────────────────────────┘
```

- Panel blanco, radio 14 px, borde `#E6E9EC`, sombra
  `0 20px 40px -16px rgba(0,45,73,.45)`, separado 6 px de la barra y por
  encima del contenido (`z-index` alto).
- Título del grupo arriba en 11 px / 600, mayúsculas, color `#8A97A3`.
- Opciones en 13,5 px, texto `#002D49`, hover `#F7F7F7`, alto mínimo de 36 px.
  La opción de la pantalla actual va en `#0F70FC` y semibold.
- **Hasta 8 opciones:** una sola columna de 240 px.
- **De 9 a 16 opciones:** dos columnas. **Más de 16:** tres columnas (ancho
  máximo 760 px). El orden es por columnas, respetando el orden actual.
- **Subgrupos** (por ejemplo "3. Asignación de cuentas"): se muestran como un
  subtítulo dentro del panel, con sus opciones debajo y sangría de 12 px. No se
  anidan menús que se abren hacia el lado.
- Comportamiento: solo un desplegable abierto a la vez; se cierra al elegir una
  opción, al hacer clic fuera o con Escape. Marcado: `aria-haspopup="menu"`,
  `aria-expanded`, `role="menu"` y `role="menuitem"`. Se abre con clic, no con
  hover.

**En celular (menos de 768 px):**

- La fila 2 se desliza horizontalmente; "Más" queda fijo a la derecha.
- El desplegable se abre como **panel a todo el ancho** bajo la cabecera
  (márgenes de 12 px, alto máximo del 70 % de la pantalla con desplazamiento
  interno), en una sola columna.

### 7.3 Área de contenido

- Fondo de página `#F7F7F7` (las pantallas con tablas densas pueden usar
  `#F3F7FA` como hasta ahora).
- Título de la pantalla a la izquierda y las acciones principales a la derecha.
- Espaciado entre bloques de 24–32 px.
- Pie opcional: "Fortuner 27.0 · Software Empresarial · © 2026 DSI S.A.",
  11,5 px, color `#8A97A3`, separado por una línea `#E6E9EC`.
- El contenido ocupa **todo el ancho** bajo la cabecera; no queda ningún margen
  izquierdo reservado para un menú.
- La cabecera queda fija arriba y solo el contenido se desplaza.

### 7.4 Convertir una barra lateral existente

Aplica a los módulos que ya tienen menú lateral, incluido uno que se haya
rediseñado con la versión anterior de esta guía (por ejemplo, Contabilidad con
`components/Shell.tsx`). Es un cambio **solo de presentación** del componente
de diseño base:

1. **Conservar los datos de navegación.** La lista de grupos y opciones (por
   ejemplo `NAV_GROUPS`), sus identificadores, etiquetas, orden y la función que
   cambia de pantalla (`onNavigate`) **no cambian**. Solo cambia cómo se
   dibujan.
2. **Eliminar el panel lateral:** el `<aside>`, el estado de contraer
   (`collapsed`), el botón "Contraer", el panel deslizable para celular
   (`mobileOpen`), el botón de menú (hamburguesa) y el fondo oscuro que lo
   acompaña.
3. **Mover el bloque de marca** del panel a la fila 1 de la cabecera: logo,
   separador y nombre del módulo. El subtítulo (por ejemplo "Contabilidad
   General") puede ir como `title` o desaparecer si repite el nombre.
4. **Mover el contexto** que mostraba el panel (compañía, NIT, sucursal) a los
   chips de la fila 1, conservando sus acciones.
5. **Dibujar la fila 2** con el patrón de la sección 7.2: "Inicio" primero,
   cada grupo como pestaña con desplegable y las opciones sueltas como pestañas
   directas.
6. **Reemplazar el estado de grupos expandidos** del panel por el estado del
   desplegable abierto (uno a la vez). La función que decide si un grupo está
   activo se reutiliza para subrayar su pestaña.
7. **Reubicar elementos de la cabecera anterior** (buscador, periodo,
   notificaciones, asistente, usuario) en la fila 1, sin cambiar su
   comportamiento.
8. **Quitar** del contenedor raíz el diseño de dos columnas (`flex` con el
   panel a la izquierda); el diseño queda en una columna: cabecera arriba y
   contenido debajo.
9. Verificar que **cada opción del menú anterior** siga siendo alcanzable y lleve
   a la misma pantalla (sección 12).

Equivalencias con la barra lateral:

| Barra lateral (versión 1, descartada) | Cabecera (versión 2, aprobada) |
|---|---|
| Logo y nombre arriba del panel | Fila 1, a la izquierda |
| Compañía / sucursal en el panel | Chip de contexto en la fila 1 |
| Grupo que se expande hacia abajo | Pestaña con desplegable ▾ |
| Subgrupo anidado | Subtítulo dentro del desplegable |
| Opción activa con barra vertical | Pestaña activa con línea inferior |
| Botón "Contraer" | Se elimina |
| Menú deslizable en celular | Barra deslizable + panel a todo el ancho |

## 8. Componentes

Aplicar el aspecto de la tabla a los componentes que el módulo ya tenga.

| Componente | Especificación |
|---|---|
| **Botón principal** | Degradado `#0F70FC → #2B8BFF`, texto blanco 15 px / 600, radio 12 px, sombra `0 10px 24px -10px rgba(15,112,252,.7)`. Hover: `brightness(1.05)`. Presionado: baja 1 px. Foco: aro `#21CC93` al 35 %. Deshabilitado: opacidad 50 %, sin sombra. |
| **Botón secundario** | Fondo blanco, borde `#DFE2E5`, texto `#002D49`; hover con fondo `#F7F7F7`. |
| **Botón destructivo** | Texto y borde `#B42318`, fondo `#FDECEC` al pasar el cursor. |
| **Campo de texto / lista** | Fondo `#F7F7F7`, borde 1,5 px `#DFE2E5`, radio 12 px, padding 12–13 px; icono interior a la izquierda en `#8A97A3`. Foco: borde `#0F70FC`, fondo blanco y aro `rgba(15,112,252,.12)` de 4 px; el icono pasa a azul. |
| **Etiqueta de campo** | 13 px / 600, color `#002D49`, 8 px sobre el campo. |
| **Tarjeta** | Fondo blanco, borde 1 px `#E6E9EC`, radio 18–20 px. Si es clicable: sube 3 px al pasar el cursor, borde con el color de acento al 45 % y sombra de elevación. |
| **Tabla** | Cabecera con fondo `#F7F7F7`, texto 11,5 px / 600 en mayúsculas `#5B6B7A`; filas con separador `#E6E9EC`; hover de fila `#F7F7F7`; cifras alineadas a la derecha. Sin bordes verticales. |
| **Insignia de estado** | Pastilla de 11 px / 600. Activo/OK: fondo `rgba(33,204,147,.12)`, texto `#0F7A58`, punto verde menta. Pendiente/neutro: fondo `#F7F7F7`, borde `#E6E9EC`, texto `#8A97A3`. Error: fondo `#FDECEC`, texto `#B42318`. |
| **Alerta de error** | Fondo `#FDECEC`, borde `#F5C2C2`, texto `#B42318`, radio 12 px, icono de círculo con exclamación; `role="alert"`. |
| **Alerta informativa** | Fondo `rgba(15,112,252,.08)`, borde `rgba(15,112,252,.25)`, texto `#002D49`. |
| **Modal / panel de detalle** | Ventana o panel que se superpone al contenido para ver o editar un registro (no es navegación). Fondo blanco, radio 20 px, sombra amplia; fondo atenuado `rgba(0,45,73,.45)`. Encabezado con título 18 px / 600 y botón de cierre discreto. |
| **Pestañas internas de contenido** | Contenedor blanco con borde `#E6E9EC` y radio 12 px; la pestaña activa con fondo `#003760` y texto blanco. |
| **Indicador de carga** | Icono giratorio en `#0F70FC`; en cargas de pantalla completa, el isotipo con animación de pulso. |
| **Estado vacío** | Borde punteado `#DFE2E5`, texto `#8A97A3` centrado, radio 16 px. |

### Gráficos

Usar esta secuencia de colores, en este orden: `#0F70FC`, `#21CC93`,
`#1FCEC4`, `#33B1FF`, `#5B5FF7`. Para comparar dos series (año actual contra
año anterior): actual en `#0F70FC` con línea continua y anterior en `#33B1FF`
con línea punteada. Cuadrícula en `#E6E9EC`, ejes en `#8A97A3` a 11 px.
Evitar el rojo y el verde como únicas señales; acompañar con texto o iconos.

## 9. Pantalla de ingreso (solo si el módulo tiene una propia)

Si el módulo ya redirige al ingreso de Fortuner o recibe `fortuner_code`, **no
se rediseña nada** porque no hay pantalla propia. Si tiene login manual,
replicar `AuthGate.tsx` de FORTUNER27:

- escritorio: pantalla dividida; panel izquierdo azul con el logo grande
  (unos 540 px) y el mensaje de marca; formulario a la derecha en una tarjeta
  blanca de 420 px;
- celular: franja azul superior con el logo y la tarjeta debajo;
- conservar **exactamente** los campos, límites, validaciones, orden de
  tabulación y mensajes del login actual del módulo.

## 10. Accesibilidad y responsive

- Contraste mínimo 4,5:1 en texto. El texto sobre `#003760` es blanco; sobre
  fondos claros usar `#002D49` o `#5B6B7A`.
- Mantener o agregar `aria-label` en botones que solo tengan icono.
- Foco visible en todos los elementos interactivos.
- Probar a **1440 px** y a **375 px** de ancho. Sin desplazamiento horizontal de
  la página (solo en tablas anchas, dentro de su contenedor).
- No usar `hover` como única forma de mostrar una acción; en celular debe verse
  siempre.

## 11. Procedimiento paso a paso

1. **Preparación.** Ejecutar `git status`; si hay cambios ajenos, no
   mezclarlos. Crear una rama, por ejemplo `rediseno-visual`.
2. **Línea base.** Capturar pantallas de todas las vistas actuales del módulo
   (escritorio y celular) para comparar al final.
3. **Recursos.** Copiar los tres logos (sección 3) y cambiar el favicon.
4. **Fuente y variables.** Agregar Poppins y las variables de la sección 6 en
   el CSS global.
5. **Cabecera.** Construir la cabecera compacta (sección 7.1) como un único
   componente reutilizable y colocarlo en el diseño base, de modo que aparezca
   en todas las pantallas.
6. **Navegación.** Llevar toda la navegación a la fila 2 de la cabecera
   (sección 7.2). Si el módulo tiene barra lateral, convertirla con la sección
   7.4 antes de seguir.
7. **Componentes.** Recorrer pantalla por pantalla aplicando la sección 8,
   empezando por botones y campos (efecto más visible), luego tarjetas, tablas,
   insignias, alertas y modales.
8. **Gráficos.** Cambiar la paleta (sección 8, "Gráficos").
9. **Barrido de colores.** Buscar en el proyecto los colores y logos
   anteriores y reemplazarlos por las variables. Por ejemplo, con
   `grep -rniE "#0073C0|#001F4C|#004183|#00B0F2|dsi-logo|fortuner-erp-logo"`
   sobre la carpeta de código. No debe quedar ninguno. Buscar también restos de
   la barra lateral con `grep -rnE "<aside|Contraer|collapsed|mobileOpen"`; si
   aparecen en el diseño base, la conversión de la sección 7.4 no está
   completa.
10. **Verificación** (sección 12).
11. **Confirmación.** Un commit descriptivo, con solo los archivos del
    rediseño; no incluir `.env`, `modules.json`, logs ni `node_modules`.

## 12. Lista de verificación

Antes de dar el trabajo por terminado:

- [ ] El módulo compila sin errores nuevos (`npm run build` o el equivalente).
- [ ] Las pruebas existentes del proyecto siguen pasando.
- [ ] `git diff --check` no reporta problemas.
- [ ] Se abre desde el catálogo de FORTUNER27 e identifica al usuario y la
      sucursal igual que antes.
- [ ] Todas las pantallas se ven bien a 1440 px y a 375 px.
- [ ] **No hay barra lateral:** el logo y toda la navegación están en la
      cabecera superior, como en el catálogo de FORTUNER27.
- [ ] Cada opción del menú anterior sigue disponible (directa, en un
      desplegable o en "Más") y lleva a la misma pantalla.
- [ ] Los desplegables se abren con clic, se cierran con Escape o clic afuera y
      funcionan en celular como panel a todo el ancho.
- [ ] Los datos, totales, filtros, exportaciones y acciones dan **el mismo
      resultado** que antes del cambio (probar al menos un flujo completo).
- [ ] Ningún texto de datos o de mensajes del servidor cambió.
- [ ] No quedan logos ni colores anteriores (paso 9 de la sección 11).
- [ ] No se modificaron puertos, rutas de API, variables de entorno ni la
      configuración de arranque.
- [ ] El favicon y el título de la pestaña son los de Fortuner.

## 13. Qué no hacer

- No usar barra lateral ni conservar la que exista; es el diseño de la versión
  1, que fue descartado.
- No inventar funciones nuevas (buscadores, favoritos, notificaciones) que el
  módulo no tenga.
- No cambiar la estructura de datos, nombres de columnas ni el orden de la
  información.
- No copiar código de FORTUNER27 que dependa de su API (`/api/modules`,
  `/api/access/...`); solo se toma el aspecto.
- No usar la paleta del archivo `Ejemplo_iconos.jpeg` (es otra propuesta de
  DSI, no de Fortuner).
- No modificar el proyecto FORTUNER27 desde el trabajo de un módulo.
- No dejar de lado los estados de carga, vacío y error: también deben quedar
  con el nuevo aspecto.

## 14. Instrucción lista para pegar a un agente de IA

Copiar este texto en una conversación abierta en la carpeta del módulo:

**Módulo sin rediseñar:**

```text
Lee GUIA_REDISENO_MODULOS.md completa y aplica el rediseño visual a este
proyecto siguiendo el procedimiento de la sección 11.

Reglas estrictas:
- El diseño aprobado es el del catálogo versión 2: logo y navegación en la
  cabecera superior, sin barra lateral. Sigue las secciones 7.1 y 7.2.
- Es solo un cambio visual. No modifiques rutas, endpoints, autenticación,
  reglas de negocio, puertos ni variables de entorno.
- Toma como referencia visual el proyecto hermano ..\Fortuner27 (App.tsx,
  AuthGate.tsx, index.css y public/fortuner-*.png) y la carpeta
  ..\Fortuner27\Maquetas. No los modifiques.
- Trabaja en una rama nueva. Antes de empezar ejecuta git status y respeta
  cualquier cambio ajeno.
- Empieza por listar las pantallas y componentes del módulo y propón el orden
  de trabajo; luego avanza por partes pequeñas.
- Al terminar ejecuta la lista de verificación de la sección 12 y reporta qué
  verificaste y qué no pudiste verificar. No hagas commit hasta que te lo pida.
```

**Módulo ya rediseñado con barra lateral** (por ejemplo, Contabilidad):

```text
Lee GUIA_REDISENO_MODULOS.md completa, en especial las secciones 7.1, 7.2 y
7.4. Este módulo se rediseñó con una versión anterior de la guía y quedó con
barra lateral, que ya no está aprobada.

Convierte la navegación a la cabecera superior siguiendo la sección 7.4:
- Conserva exactamente la lista de opciones, sus identificadores, el orden y
  la función de navegación; solo cambia cómo se dibujan.
- Elimina el panel lateral, el botón "Contraer" y el menú deslizable de celular.
- Lleva el logo, el nombre del módulo y los datos de contexto a la fila 1, y
  los grupos a la fila 2 con menús desplegables.
- No toques el contenido de las pantallas ni la lógica.
- Trabaja en una rama nueva y respeta los cambios ajenos (git status).
- Al terminar, comprueba que cada opción del menú anterior lleve a la misma
  pantalla, ejecuta la sección 12 y reporta qué verificaste y qué no. No hagas
  commit hasta que te lo pida.
```

## 15. Registro de módulos rediseñados

Actualizar esta tabla en cada proyecto al terminar (y en FORTUNER27 para llevar
el control general):

| Módulo | Rama / commit | Fecha | Responsable | Observaciones |
|---|---|---|---|---|
| Fortuner27 (catálogo e ingreso) | `4dcee7c` | 2026-11-12 | | Referencia |
| CRM (Campañas y Clientes 360°) | rama `rediseno-visual` | 2026-11-13 | | Barra lateral convertida a cabecera de dos filas (grupos Campañas y Clientes 360° con desplegable; «Más» con las opciones próximas). Pantalla de clave de acceso con el diseño de ingreso. Poppins empaquetada localmente por la política de seguridad del servidor. Se conservó el tema oscuro existente. |
| Cartera | | | | |
| Contabilidad | | 2026-11-12 | | Rediseñado con barra lateral (versión anterior de la guía). Pendiente: convertir la navegación a la cabecera (sección 7.4). |
| Inventarios | | | | |
| Pedidos | | | | |
| Sugeridos | | | | |
| Analítica BI | | | | |
