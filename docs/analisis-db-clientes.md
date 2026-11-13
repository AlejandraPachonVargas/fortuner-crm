# Análisis de la base ADVANTAGE para Clientes 360°

> Copia de prueba en `D:\ADD_FORTUNER` (diccionario `PUBLIDATA.add`, Advantage 10, tablas ADT/ADI).
> Análisis hecho el 2026-11-13, **solo lectura**: conexión ODBC `readonly`, `LockMode=COMPATIBLE`,
> sin una sola escritura. Las cifras son de esta copia; en producción se vuelven a medir antes de conectar.

> **Actualización 2026-11-13 (tarde):**
> - Los catálogos `GANMASCOTA`, `GANPROFE`, `GANAUTOS`, `GANBARRIO`, `CIUDAD` y `DPTOS` llegaron en `D:\TEM_GANAPTOS` (tablas libres) y ya están conectados.
> - Las tablas nuevas se crearon con nombres legibles (`CRM_MASCOTA`, `CRM_AFILIACION`…) en un diccionario propio del CRM, no en `PUBLIDATA`.
> - El cruce de ventas por tarjeta (sección 6) ya está corregido en el modelo.
> - Las sedes de las ventas salen de `TIDBODE` (`81` = Parque Caldas, `83` = La Rochela).
>
> Cómo quedó todo, explicado para la empresa: [`clientes-360-arquitectura.md`](clientes-360-arquitectura.md).

---

## 1. Resumen ejecutivo

| # | Hallazgo | Impacto |
|---|---|---|
| 1 | La empresa es **Comercializadora Mercaldas** (NIT 810000520, Manizales). El maestro de clientes es `POSCLI`, con **146.371 registros y 89 columnas**. Es el maestro del programa de fidelización *Gana Mercaldas* (tarjetas y puntos). | `POSCLI` es la tabla que el CRM lee y edita. |
| 2 | ~~**No existen** en esta copia~~ (ya llegaron, ver actualización) las tablas `GANMASCOTA`, `GANPROFE`, `GANAUTOS`, `CIUDAD`, `DPTOS` ni `GANBARRIO`: no aparecen ni en el diccionario ni en el disco. `POSCLI` sí guarda sus **códigos** (`CODMASCO`, `CODPROFE`, `CODVEHI`, `CODBARRIO`, `CIUDAD`). | Hay que pedir esas tablas a los creadores. Mientras tanto, los catálogos se pueden reconstruir desde los propios datos (sección 5). |
| 3 | **El diccionario no tiene integridad referencial, triggers, vistas ni procedimientos.** Toda la integridad la mantiene la aplicación POS. | El CRM debe aplicar sus propias reglas antes de escribir. La base no lo va a frenar. |
| 4 | **Las ventas guardan al cliente con dos llaves distintas.** `FADITE.IFCLIENTE` trae a veces la **cédula** (`CEDCLI`) y a veces el **número de tarjeta** (`CODCLI`). En 2026: 2,41 M facturas por cédula y **1,58 M por tarjeta (≈ $53.552 M)**. 22.868 clientes compran con ambas. | El modelo actual de Campañas solo une por cédula y **pierde ~23 % de las ventas con cliente**. Hay que corregirlo (sección 6). |
| 5 | `POSCLI` está **congelada en 2025-04-29**: ahí terminan la última alta, la última modificación y la última acumulación de puntos. Las ventas llegan hasta 2026-10-31. Hay **15.666 llaves de cliente en ventas de 2026 que no existen en `POSCLI`** (≈ 219 mil facturas). | O la copia de `POSCLI` es vieja, o desde abril de 2025 los clientes se registran en otro lado (¿las tablas `GAN*`?). **Pregunta crítica para los creadores.** |
| 6 | El archivo `Actu_diccionario.sql` que está en la carpeta **borra todas las columnas de `POSCLI`** y de otras tablas (`ALTER TABLE … DROP COLUMN`). | **No se debe ejecutar nunca.** Tampoco el CRM. |
| 7 | `PUBLIDATA.add` fue modificado hoy (2026-11-13 14:45) y la tabla `TIDGON` da error 7074: el ID guardado en el diccionario no coincide con el de la tabla. | Confirmar quién tocó el diccionario. Trabajar sobre una copia limpia. |
| 8 | Calidad: 35 % de los clientes tiene un celular móvil válido, 69 % un correo válido y 47 % autorizó el tratamiento de datos (Ley 1581). Solo **21.128 clientes (14 %) son contactables legalmente por celular**. | Hay mucho espacio para la cola de «Calidad de datos» que ya existe en la UI. |

---

## 2. Inventario: qué hay en la base

114 tablas en el diccionario (55 GB). Por dominio, solo las que importan al CRM:

| Dominio | Tabla | Filas | Uso en el CRM |
|---|---|---:|---|
| **Clientes** | `POSCLI` | 146.371 | **Maestro de clientes y fidelización.** Lectura y escritura controlada. |
| | `FADCLI` | 122.190 | Clientes de facturación y crédito (FE). El 74 % existe en `POSCLI`. Solo lectura: sirve para enriquecer. |
| | `CONTERCE` | 765.759 | Terceros contables. No se usa. |
| **Ventas** | `FADITE` | 24,1 M | Líneas de venta POS: producto, cliente, valor. **Fuente del historial de compras.** |
| | `FADDIA` | 4,3 M | Encabezado de factura: totales, puntos, domicilio, email FE. |
| | `FAPAGO` | 7,2 M | Medios de pago por factura. |
| | `DOMITE` / `DOMDIA` | 240 K / 52 K | Domicilios. |
| **Productos** | `TIDSAL`, `TIDTAB`, `TIDTPRO`, `TIDMARCAS` | — | Ya los usa Campañas. |
| **Tiendas** | `TIDSUCUR` | 151 | Sucursales (`SUCUR2` = tienda física de 2 dígitos). |
| **Promociones** | `POSDCTOS`, `POSDCTO2`, `POSDCTO3`, `POSACTI` | 5.566 / 4.664 / 4 / 8 | Descuentos y cupones. Varios dependen de banderas del cliente (`ACLI`, `CLIVINO`). |
| **Configuración** | `VISION` | 1 | Datos de la empresa (`CTCLUBES` = clubes activos). |
| **Auditoría ERP** | `VISAUDI` | 7.385 | Log del ERP: usuario, módulo, motivo. |
| **Usuarios ERP** | `VISUSU`, `POSPOPER` | 30 / 21 | Contienen claves. **El CRM no las lee ni las expone.** |

Ojo: `POSDANE` **no** son códigos DANE, contiene productos. Y la ciudad DANE se guarda en `POSCLI.CIUDAD`.

---

## 3. `POSCLI` columna por columna

Tipos ADS: `C` = carácter de longitud fija, `L` = lógico, `D` = double, `I` = entero.
**Las fechas son números `AAAAMMDD`**, no tipo fecha.

### 3.1 Identidad (llaves: solo lectura)

| Columna | Tipo | Lleno | Qué es | Decisión |
|---|---|---:|---|---|
| `CODCLI` | C13 | 100 % | **Número de tarjeta *Gana Mercaldas*.** Desde 2024 se genera como `'2' + cédula con ceros a la izquierda hasta 12 dígitos` (99,8 % de las altas de 2025). Antes era una secuencia `2000…` y los `3…` son reposiciones. | **Llave de la fila.** Nunca se edita. |
| `CEDCLI` | C10 | 100 % | Documento del cliente. 48 valores repetidos; 30 filas vacías comparten la misma tarjeta. | **Identidad de la persona.** Nunca se edita. |
| `TIPODOC` | C2 | 20 % | Código DIAN: `13` cédula, `22` cédula de extranjería. | Editable; vacío se asume `13`. |
| `TIPCLI` | C15 | 31 % | Texto heredado: «Cedula» / «Nit». | Solo lectura. Se reemplaza por `TIPODOC`. |

Índices: `POSCLI` (`CODCLI`), `POSCLI2` (`CEDCLI`), `POSCLI19` (`TELCELU`) y otros 18. **Ninguno es único**: la base acepta duplicados, así que el CRM debe verificarlos antes de crear un cliente.

### 3.2 Datos personales (editables desde el CRM)

| Campo en la UI | Columna(s) | Estado actual | Regla de escritura |
|---|---|---|---|
| Nombres y apellidos | `NOMBRE`, `NOMBRE2`, `APELLIDO`, `APELLIDO2` (C50) | 98 % separado | Editables. |
| Nombre completo | `NOMCLI` (C40) | 99 % | **Se recalcula** al editar las 4 partes. 3.289 nombres pasan de 40 caracteres: se trunca en `NOMCLI` sin perder las partes. Lo usa el índice `POSCLI1`. |
| Celular | `TELCELU` (C12) + `OPERCEL` | 35 % móvil válido | Se guardan 10 dígitos, sin +57. Hay 14.410 móviles «escondidos» en `TELCLI1` que se pueden proponer como corrección. |
| Teléfono fijo | `TELCLI1`, `TELCLI2` (C10) | — | `TELCLI1` es el índice histórico del POS: no se vacía. |
| Correo | `EMAIL` (C50) + `MEMAIL` (L) | 69 % válido | 1.572 genéricos (`facturaelectronicapos@…`) y 6.626 inválidos. `MEMAIL` = tiene correo. |
| Nacimiento | `FECHAN` (D) + `ANON` (D) | 44 % completa, 48 % solo mes y día | **Dos formatos conviven:** `AAAAMMDD` o `MMDD` con el año en `ANON`. El CRM lee ambos y escribe `AAAAMMDD` y además `ANON`. |
| Género | `SEXO` (C1) | 94 % | `F`, `M`, `I`. |
| Estado civil, hijos, cónyuge | `ECIVIL`, `HIJOS`, `CONYUGE` | 38 % / 24 % / 18 % | Editables, opcionales. |
| Dirección | `DIRCLI1` (C60) | 47 % | `DIRCLI2` **no** es dirección: guarda tarjetas antiguas. No se toca. |
| Barrio | `CODBARRIO` (C3) + `BARRIO1` (texto) | 35 % código, 73 % texto | Se escriben el código y el nombre del catálogo. Hay 357 códigos en uso. |
| Ciudad | `CIUDAD` (C5, DANE) + `CIUCLI` (texto) | 99,6 % | `17001` es Manizales (98,5 %). Se escriben ambos. |
| Profesión | `CODPROFE` (C3) + `PROFESION1` | 28 % / 52 % | Catálogo de unos 20 códigos (`001`–`019`, `999` = Otra). `PROFESION` (texto libre viejo) es solo lectura. |
| Empresa | `EMPRESA` (C30) | 43 % | Editable. `EMPRESAC` tiene basura (`15:52:2203/11/15`): no se usa. |

### 3.3 Consentimiento (Ley 1581): editable con registro obligatorio

| Columna | Lleno = sí | Significado |
|---|---:|---|
| `INFOLEY` | 68.920 | Autoriza el tratamiento de datos. |
| `INFOTEX` | 26.652 | Acepta SMS. |
| `INFOELEC` | 25.993 | Acepta correo. |
| `INFOWAS` | 22.246 | Acepta WhatsApp. |

`POSCLI` no guarda **cuándo ni por qué medio** se dio el consentimiento: eso va en una tabla nueva (sección 7). Contactables reales: SMS 5.396, WhatsApp 4.769, correo 23.970 (autorizan **y** tienen un dato válido).

### 3.4 Clubes: hoy son banderas sueltas

| Columna | Miembros | Club |
|---|---:|---|
| `CLUBVINO` | 18.703 | Club del Vino |
| `CLUBAMAC` | 20.412 | Adulto mayor (por confirmar) |
| `CLUBPARRI` | 19.859 | Parrilla |
| `CLUBSALUD` | 19.988 | Salud |
| `CLUBMASCO` | 13.189 | Mascotas |

**Alerta de integridad:** las promociones de `POSDCTOS` tienen las banderas `CLIVINO` y `ACLI` (99 promociones las usan). El POS aplica esos descuentos leyendo la bandera del cliente. Por eso, cuando el CRM afilie a alguien al Club del Vino en la tabla nueva, **también debe poner `CLUBVINO = .T.` en `POSCLI`**. Si no, el cliente no recibe el descuento en caja.

### 3.5 Mascotas y vehículos: hoy cabe uno solo

| Columna | Datos |
|---|---|
| `MASCOTA` (L), `CODMASCO` (C2), `TMASCOTA` (texto libre), `NOMMASCO` (C50) | 17.710 tienen mascota. `TMASCOTA` es texto libre muy sucio (PERRO, PERRITA, FRESH PODLE…). `CODMASCO` `01` mezcla «SIN MASCOTA» con perros: el código no es confiable. |
| `TCARRO` (L), `CODVEHI` (C2), `TVEHI`, `TICARRO` | Códigos: `XX` no posee, `VP` particular, `MO` moto, `VM` vehículo y moto, `BI` bicicleta, `PE` patineta. |

Esto justifica la tabla nueva de mascotas (varias por cliente). `POSCLI` queda con un **resumen**: bandera, código y nombre de la mascota principal, para que el POS siga viendo lo mismo.

### 3.6 Fidelización y operación: solo lectura, el CRM no las toca

`PUNTOS`, `ULTPTOS` (última acumulación), `ULTCANT`, `ULTDESC`, `VLRTOTAL`, `VENCEFCH`, `PTOSABAJA`, `PTOSRBAJA`, `PTOSPBAJA`, `FECHABAJA`, `CONSUMO` → los maneja *Gana Mercaldas*.
`MEMPLE` (empleado, 1.276), `BLOQUE` / `BLOMOVI` (bloqueos), `SUCURSAL` (tienda de alta), `FECHAI` (fecha de alta), `FECHAMOD` (última modificación), `ORIGENW` / `NEWWEB` / `WEBFECHA` / `ACTUFAPP` (registro y actualización web o app).
`CLAWEB` (PIN web, lo tiene el 99,8 %) y `CLACH` son **secretos: nunca se leen ni se muestran.**
`OBSER1` / `OBSER2`: notas libres. Hay 19 marcadas como «FALLECIDO».

### 3.7 Columnas muertas (vacías o constantes)

`CLACLI`, `ZONACLI`, `PORCCLI`, `MARCA`, `ACTICLI`, `CUPO`, `NITEMPRE`, `CLIVINO`, `VENCEPTS`, `DCTOCUMPLE`, `DCTOVALOR`, `DCTOFACTU`, `REPE`, `TELEFC`. **No hay columna de estado activo/inactivo con datos**: la baja del CRM va en la tabla nueva.

---

## 4. Relaciones reales: dónde aparece el cliente

```
                 ┌──────────── POSCLI ─────────────┐
                 │ CODCLI (tarjeta)  CEDCLI (doc)  │
                 └───────┬───────────────┬─────────┘
          IFCLIENTE = CODCLI ó CEDCLI    │ CCODIGO = CEDCLI
                 ┌───────▼───────┐   ┌───▼────┐
                 │ FADITE (líneas)│   │ FADCLI │ (clientes FE / crédito)
                 └───────┬───────┘   └────────┘
          IFSUCUR+IFFACT │
                 ┌───────▼───────┐    ┌────────┐
                 │ FADDIA (fact.) │───►│ FAPAGO │ (medios de pago)
                 └───────────────┘    └────────┘
 POSCLI.CLUBVINO / ACLI ──► POSDCTOS / POSDCTO2 (descuentos por club)
 POSCLI.SUCURSAL ─────────► TIDSUCUR.SUCUR2 (tienda)
 POSCLI.CIUDAD ───────────► DANE (catálogo CIUDAD/DPTOS, no está en la copia)
 POSCLI.COD* ─────────────► GANMASCOTA / GANPROFE / GANAUTOS / GANBARRIO (no están en la copia)
```

Ninguna de estas relaciones está declarada en el diccionario: todas son implícitas.

**Consecuencia para la integridad:**
- `CODCLI` y `CEDCLI` **no se editan jamás**: romperían el vínculo con 24 M de líneas de venta.
- **No se borra físicamente** a un cliente con ventas. La UI ya lo bloquea; desde ahora, «tiene ventas» se calcula buscando ambas llaves en `FADITE`.
- **Fusionar duplicados no reasigna ventas en el ERP.** El CRM marca cuál registro es el principal y guarda la equivalencia en su tabla. Las compras se suman al consultar, sin tocar `FADITE`.

---

## 5. Catálogos: qué hay y cómo los resolvemos

| Catálogo pedido | ¿Existe? | Plan |
|---|---|---|
| `GANMASCOTA` | No | Pedirlo. Mientras tanto: catálogo `CRM_TIPO_MASCOTA` con valores normalizados desde `TMASCOTA`: perro, gato, ave, pez, conejo, roedor, otro. |
| `GANPROFE` | No | Reconstruido desde `CODPROFE` ↔ `PROFESION1`: `001` Abogado, `002` Administrador, `003` Agrónomo, `004` Arquitecto, `005` Ama de casa, `006` Analista, `007` Antropólogo, `008` Asesor, `009` Auxiliar, `010` Bacteriólogo, `011` Comerciante, `012` Contador, `013` Comunicador, `014` Diseñador, `015` Docente, `016` Enfermero, `017` Ingeniero, `018` Médico, `019` Odontólogo, `999` Otra. Hay que validar con el catálogo real. |
| `GANAUTOS` | No | Reconstruido: `XX`, `VP`, `MO`, `VM`, `BI`, `PE` (sección 3.5). |
| `GANBARRIO` | No | 357 códigos en uso con su nombre más frecuente (`185` Palermo, `137` La Enea, `152` La Sultana…). Se necesita el real para los barrios sin uso. |
| `CIUDAD` / `DPTOS` | No | `POSCLI.CIUDAD` ya es DANE (46 municipios en uso). Se puede cargar el DIVIPOLA oficial del DANE como tabla nueva. |

Cuando lleguen las tablas reales, el CRM las lee tal cual y los catálogos reconstruidos se retiran.

---

## 6. Corrección en Campañas (HECHA el 2026-11-13)

`backend/crm/etl/sql/model.sql` une `FADITE.IFCLIENTE = POSCLI.CEDCLI`. Con esto:
- se pierden **1,58 M facturas** cuyo cliente vino por tarjeta;
- el valor, la frecuencia y la recencia de 26.590 clientes quedan subestimados, y quien compra solo con tarjeta parece «inactivo».

Corrección: resolver `IFCLIENTE` contra **ambas** llaves y llevar todo a una sola identidad:

```sql
cliente_id = COALESCE(cli_por_cedula.ced, cli_por_tarjeta.ced)
```

Es un cambio pequeño y aislado. Conviene hacerlo antes de conectar Clientes 360° para que las compras que muestra la ficha cuadren.

---

## 7. Tablas nuevas (sin alterar ninguna existente) — propuesta inicial; ver los nombres finales `CRM_*` en clientes-360-arquitectura.md

Todas en el mismo diccionario `PUBLIDATA`, con prefijo **`CRM`** para que nadie las confunda con las del ERP. Formato ADT, `ID AutoInc` como llave e índices por cliente. Se vinculan a `POSCLI` por **`CODCLI` (la fila) y `CEDCLI` (la persona)**, guardando las dos.

| Tabla | Para qué | Columnas principales |
|---|---|---|
| `CRMMASCO` | Varias mascotas por cliente | `ID`, `CODCLI`, `CEDCLI`, `TIPO`, `NOMBRE`, `RAZA`, `SEXO`, `FECHANAC`, `TAMANO`, `ACTIVA`, `CREADO`, `CREADOPOR` |
| `CRMAFILI` | Catálogo de clubes y afiliaciones | `ID`, `CODIGO`, `NOMBRE`, `DESCRIP`, `COLUMNAPOS` (ej. `CLUBVINO`, para sincronizar la bandera), `ACTIVO`, `CUPO` |
| `CRMAFICL` | Cliente × club, de muchos a muchos | `ID`, `IDAFILI`, `CODCLI`, `CEDCLI`, `FECHAING`, `FECHARET`, `ESTADO`, `ORIGEN` |
| `CRMCLIEX` | Extensión 1:1 de `POSCLI` para lo que no cabe en ella | `CODCLI`, `CEDCLI`, `ESTADO` (activo/inactivo/anonimizado), `MOTIVO`, `PRINCIPAL` (fusión), `ETIQUETAS`, `CONSENT_FECHA`, `CONSENT_MEDIO`, `CONSENT_VERSION` |
| `CRMVEHI` | Varios vehículos (opcional) | `ID`, `CODCLI`, `TIPO`, `MARCA`, `MODELO` |
| `CRMAUDIT` | Bitácora de cada cambio | `ID`, `FECHA`, `USUARIO`, `TABLA`, `CODCLI`, `CAMPO`, `ANTES`, `DESPUES`, `MOTIVO` |
| `CRMNOTA` | Notas sobre el cliente | `ID`, `CODCLI`, `FECHA`, `USUARIO`, `TEXTO` |

Migración inicial, de una sola vez y reversible:
1. Crear los 5 clubes en `CRMAFILI` a partir de las banderas `CLUB*`.
2. Pasar a `CRMAFICL` los ~92 mil vínculos de cliente con club.
3. Pasar a `CRMMASCO` la mascota actual: 17.710 clientes, con `TMASCOTA` normalizado.

---

## 8. Cómo va a leer y escribir el CRM

**Lectura**
- Listas, búsquedas e indicadores: desde el warehouse DuckDB, alimentado por el ETL. Se agregan todas las columnas útiles de `POSCLI`, y `FADCLI` para enriquecer. Es rápido y no carga al ERP.
- Ficha de un cliente: lectura en vivo de su fila en `POSCLI` por índice (`CODCLI`) justo antes de editar, para no pisar cambios que haya hecho el POS.

**Escritura** (`/api/clientes`), en este orden:
1. Validar en el CRM: formato, longitud de columna (C12, C50…), catálogo y duplicado por `CEDCLI` y `TELCELU`.
2. Releer la fila y comparar con la versión que vio el usuario (bloqueo optimista). Si cambió, se avisa en lugar de sobrescribir.
3. `UPDATE POSCLI SET … , FECHAMOD = AAAAMMDD WHERE CODCLI = ? AND CEDCLI = ?`, solo con las columnas de la lista blanca de la sección 3.2–3.4. Se exige que afecte **exactamente 1 fila**.
4. Escribir en `CRMAUDIT` el antes y el después.
5. Conexión aparte con un usuario ADS propio del CRM (no `AdsSys`), `LockMode=COMPATIBLE`, transacción ADS cuando hay varias tablas.

**Alta de un cliente nuevo:** `CODCLI = '2' + LPAD(cédula, 12, '0')`, la regla actual del POS. Hay que **confirmarla con los creadores**. Antes se verifica que ni el código ni la cédula existan. `FECHAI` = hoy, `SUCURSAL` = la del usuario y `ORIGENW` queda vacío (no es web).

**Nunca:** `DELETE` sobre `POSCLI` de clientes con ventas, editar llaves, tocar puntos o claves, ni cambiar estructura.

---

## 9. Preguntas para los creadores de la base

1. ¿Dónde están `GANMASCOTA`, `GANPROFE`, `GANAUTOS`, `GANBARRIO`, `CIUDAD` y `DPTOS`? ¿En otro diccionario, o en la base de *Gana Mercaldas* o de la app?
2. ¿Por qué `POSCLI` no tiene altas ni cambios después del 2025-04-29 si se sigue vendiendo? ¿Los clientes nuevos se registran en otra tabla?
3. ¿La regla para crear `CODCLI` es `'2' + cédula a 12 dígitos`? ¿Qué significan los prefijos `3…` y `91…`?
4. ¿Qué significa exactamente `CLUBAMAC`? ¿Qué otras banderas lee el POS para dar descuentos (`ACLI` en `POSDCTOS`)?
5. ¿El POS hace `FLOCK`/`RLOCK` sobre `POSCLI` al facturar? Es para confirmar que la escritura del CRM con bloqueo de registro compatible no interfiere.
6. ¿Nos pueden crear un usuario ADS para el CRM con permiso de escritura solo en `POSCLI` y en las tablas `CRM*`?
7. ¿Quién modificó `PUBLIDATA.add` hoy? ¿Para qué es `Actu_diccionario.sql`? Ese script borra columnas.

---

## 10. Próximos pasos propuestos

1. **Corregir el cruce de ventas por tarjeta** en el ETL de Campañas (sección 6).
2. Ampliar la extracción de `POSCLI` a todas las columnas útiles y agregar `FADCLI`.
3. Backend `/api/clientes` de **solo lectura** primero: lista, búsqueda y ficha con compras reales. Con eso se reemplaza `datos.ts`.
4. Crear las tablas `CRM*` en la copia de prueba y hacer la migración de clubes y mascotas.
5. Activar la escritura con lista blanca, bloqueo optimista y auditoría. Probar en la copia, con el POS de prueba abierto.
6. Con las respuestas de la sección 9: catálogos reales, regla de alta y usuario ADS. Después, despliegue.
