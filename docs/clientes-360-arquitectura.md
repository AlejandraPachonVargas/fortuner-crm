# Clientes 360°: dónde vive cada dato y cómo se protege la base

> Documento para el equipo de Mercaldas y para los creadores de la base de datos.
> Explica, sin tecnicismos innecesarios, qué hace el CRM con ADVANTAGE, dónde quedan las tablas nuevas y por qué.
> Detalle técnico del análisis: [`analisis-db-clientes.md`](analisis-db-clientes.md).

---

## 1. La idea en una frase

**El CRM trabaja directamente sobre la base de clientes del ERP (`POSCLI`), pero guarda todo lo nuevo (mascotas, clubes, vehículos, notas, auditoría) en una base aparte que es solo suya.** Así el ERP no cambia de estructura y el CRM puede crecer sin pedirle permiso a nadie.

---

## 2. Las tres "bodegas" de datos

```
┌──────────────────────────────────────┐   ┌────────────────────────────────────┐   ┌──────────────────────────────┐
│  1. ERP  ·  diccionario PUBLIDATA    │   │  2. CRM  ·  diccionario propio     │   │  3. GANAPTOS (catálogos)     │
│  D:\ADD_FORTUNER\PUBLIDATA.add       │   │  D:\ADD_FORTUNER\CRM\              │   │  D:\TEM_GANAPTOS\            │
│                                      │   │        CRM_FORTUNER.add            │   │  (tablas libres)             │
│  POSCLI  ← el CRM LEE y EDITA        │   │                                    │   │                              │
│            registros (nunca columnas)│   │  CRM_CLIENTE_EXT                   │   │  CIUDAD   DPTOS              │
│  FADITE  ← ventas: solo LEE          │   │  CRM_MASCOTA                       │   │  GANBARRIO                   │
│  TIDBODE ← sedes:  solo LEE          │   │  CRM_VEHICULO                      │   │  GANMASCOTA                  │
│                                      │   │  CRM_AFILIACION                    │   │  GANPROFE                    │
│  (no se agrega NINGUNA tabla aquí)   │   │  CRM_AFILIACION_CLIENTE            │   │  GANAUTOS                    │
│                                      │   │  CRM_NOTA                          │   │                              │
│                                      │   │  CRM_AUDITORIA                     │   │  ← el CRM solo LEE           │
│                                      │   │  CRM_DUPLICADO_DESCARTE            │   │    (nunca escribe)           │
│                                      │   │  CRM_ESQUEMA                       │   │                              │
└──────────────────┬───────────────────┘   └─────────────────┬──────────────────┘   └──────────────────────────────┘
                   │      unidas por la TARJETA (CODCLI)     │
                   └────────────── y el DOCUMENTO (CEDCLI) ──┘
```

### ¿Por qué las tablas nuevas NO van dentro de PUBLIDATA?

| Opción | Problema |
|---|---|
| Meter las tablas `CRM_*` en `PUBLIDATA.add` | Es modificar el diccionario del ERP, justo lo que se acordó no hacer. Además, una actualización del proveedor (como el `Actu_diccionario.sql` que hay en la carpeta) podría reescribir el diccionario y **borrar las tablas del CRM sin aviso**. |
| **Diccionario propio del CRM** ✅ | El ERP queda intacto. Si algún día se quiere quitar el CRM, se borra su carpeta y el ERP ni se entera. Los permisos y la contraseña son aparte. |

Se puso en la **subcarpeta `CRM` de la carpeta del ERP** para que los respaldos que ya hace la empresa de esa carpeta incluyan también el CRM.

### ¿Y por qué las tablas de GANAPTOS tampoco se meten en un diccionario?

Son **tablas libres** que usa la aplicación de Gana Mercaldas. Si se agregan a un diccionario, Advantage las "amarra" a ese diccionario y **la aplicación de Gana Mercaldas dejaría de poder abrirlas**. Por eso el CRM las abre tal como están, en solo lectura.

---

## 3. Qué hace cada tabla nueva

| Tabla | Para qué sirve | Ejemplo |
|---|---|---|
| `CRM_CLIENTE_EXT` | Lo que el ERP no tiene sobre el cliente: estado en el CRM (activo, inactivo o anonimizado), fusión, etiquetas, observaciones y **cuándo y cómo autorizó** el tratamiento de datos (evidencia de la Ley 1581). | «Inactivo: se mudó de ciudad» |
| `CRM_MASCOTA` | **Varias mascotas por cliente**, con nombre, raza, sexo y fecha de nacimiento. El tipo usa el código de `GANMASCOTA`. | Toby (perro) y Misha (gato) |
| `CRM_VEHICULO` | Varios vehículos por cliente, con marca, línea, placa y año. El tipo se refleja con el código de `GANAUTOS`. | Moto Yamaha ABC12D |
| `CRM_AFILIACION` | **Todos los clubes**: los 5 históricos del POS y los que se creen. | Club del Vino, Club Repostería |
| `CRM_AFILIACION_CLIENTE` | **Qué cliente está en qué club**, con fecha de ingreso, vencimiento y carné. Un cliente puede estar en varios. | Ana: Club Salud + Club Mascotas |
| `CRM_NOTA` | Notas y tareas de mercadeo. | «Llamar para ofrecer el Club del Vino» |
| `CRM_AUDITORIA` | **Cada cambio queda escrito**: quién, cuándo, qué tabla, qué campo, valor anterior y nuevo. | Celular: 8879020 → 3101234567 |
| `CRM_DUPLICADO_DESCARTE` | Parejas marcadas como «no son duplicados», para no volver a sugerirlas. | |
| `CRM_ESQUEMA` | Versión instalada y fecha de la migración inicial. | |

---

## 4. Qué se puede editar en `POSCLI` (y qué no)

| Se edita desde el CRM | **Nunca** se toca |
|---|---|
| Nombres y apellidos (y `NOMCLI` se recalcula solo) | `CODCLI` (tarjeta) y `CEDCLI` (documento): son las llaves de las ventas |
| Tipo de documento, género, nacimiento, profesión, empresa, estado civil, hijos | Puntos, saldos y fechas de Gana Mercaldas |
| Celular, teléfono, correo | `CLAWEB` / `CLACH` (claves web): ni siquiera se leen |
| Ciudad, barrio y dirección (siempre con códigos de los catálogos) | Bloqueos, empleado, sucursal de alta |
| Autorización de datos y de cada canal (SMS, correo, WhatsApp) | La **estructura** de cualquier tabla |
| Banderas de mascota, vehículo y clubes (las sincroniza el CRM) | |

Cada columna se valida con su **longitud real** del ERP: un correo de más de 50 caracteres se rechaza, en lugar de cortarse en silencio.

---

## 5. Cómo se protege cada cambio

Cuando alguien guarda un cambio en la ficha de un cliente:

1. **Se relee la fila del ERP en ese instante** y se compara con lo que la persona tenía en pantalla. Si la caja (o alguien más) cambió al cliente mientras tanto, **el CRM no pisa nada**: avisa y pide recargar.
2. **Se anota la intención en la auditoría** antes de tocar el ERP (estado *pendiente*).
3. **Se actualiza exactamente una fila**, identificada por su posición física (`ROWID`) **y** su tarjeta. Si el resultado no es exactamente una fila, se deshace todo.
4. La auditoría pasa a *aplicado* (o *fallido* con el motivo). **No existe un cambio sin rastro.**

### Reglas de integridad que el CRM no deja romper

| Situación | Qué hace el CRM |
|---|---|
| Borrar a un cliente que tiene compras, puntos o campañas | **No lo permite.** Ofrece *desactivar* (reversible) o *anonimizar*. |
| Borrar físicamente | Solo clientes **creados por error desde el CRM** y sin ningún movimiento. |
| Anonimizar (Ley 1581) | Borra nombre, contacto, dirección, nacimiento y autorizaciones en el ERP, y las mascotas, vehículos, clubes y notas del CRM. **Conserva documento, tarjeta y ventas**: la contabilidad y la facturación electrónica no se rompen. |
| Fusionar duplicados | La ficha que se retira queda **inactiva** con la referencia de la fusión, y sus relaciones pasan a la que permanece. **Las facturas no se mueven en el ERP**: la ficha que permanece suma las compras de ambas. |
| Crear un cliente | Se verifica en el ERP que no exista el documento ni la tarjeta. La tarjeta se genera con la regla del POS: `2` + documento a 12 dígitos. |
| Afiliar a un club histórico | También se marca la bandera de `POSCLI` (`CLUBVINO`…) porque **la caja la usa para dar el descuento**. |
| Mascota o vehículo | La primera mascota y el vehículo principal se reflejan en `POSCLI` para que la caja los siga viendo como hoy. |
| Registros genéricos del POS (CONSUMIDOR FINAL, 2222222222) | Se muestran, pero no se editan, no reciben ventas ni entran en campañas. |
| Tarjetas repetidas en el ERP (20 tarjetas, 73 filas) | Se muestran en solo lectura hasta que se corrijan en el POS. |
| Cliente inactivo o anonimizado | **Campañas nunca lo incluye.** |

---

## 6. Permisos

| Quién | Qué puede hacer |
|---|---|
| Clave de uso (`CRM_API_KEY`) → **Mercadeo** | Consultar, crear y editar clientes, mascotas, vehículos, clubes, notas y etiquetas. Desactivar uno a uno. |
| Clave de administración (`CRM_ADMIN_KEY`) → **Administrador** | Además: anonimizar, eliminar, fusionar, importar, desactivar en lote y borrar clubes. |
| Interruptor `CRM_CLIENTES_ESCRITURA=false` | **Todo queda en solo lectura**, sin importar la clave. Es el freno de mano. |

Cada persona escribe su nombre en «Firmar cambios como», y ese nombre queda en la auditoría.

---

## 7. De dónde sale lo que se ve en pantalla

| Dato | Fuente | ¿En vivo? |
|---|---|---|
| Lista, búsqueda, filtros e indicadores | Índice en memoria con `POSCLI` + tablas `CRM_*` | Se relee del ERP cada 15 minutos, al pulsar «Releer del ERP» y, para el cliente tocado, después de cada cambio |
| Ficha al editar | `POSCLI` directo | Sí, siempre en vivo |
| Compras, segmento, ticket y frecuencia | Warehouse (copia analítica de `FADITE`) | Según la última carga (`crm etl`) |
| Catálogos | GANAPTOS | Se releen cada 10 minutos |

---

## 8. Instalación en el servidor de producción (paso a paso)

> En producción el servidor es **Advantage 10.10**. Por eso el diccionario del CRM **no se copia desde aquí**: se crea allá mismo con el instalador, y así queda en la versión correcta.
>
> Comandos exactos de Git Bash en [`despliegue-servidor.md`](despliegue-servidor.md). Para confirmar que todo quedó bien: `crm clientes verificar` (solo lectura) y, al activar la edición, `crm clientes verificar --escritura`.

1. **Respaldo.** Copiar `POSCLI.adt`, `POSCLI.adi`, `PUBLIDATA.add`, `PUBLIDATA.ai` y `PUBLIDATA.am` a una carpeta de respaldo. Verificar el checksum, como se hizo en la copia de prueba.
2. **Configurar `.env`** del servidor:
   ```
   ADS_CRM_DIRECTORY=<carpeta del ERP>\CRM\CRM_FORTUNER.add
   ADS_CRM_PASSWORD=<entre 10 y 20 caracteres, sin comillas>
   ADS_CATALOGOS_DIRECTORY=<carpeta real de GANAPTOS>
   CRM_CLIENTES_ESCRITURA=false        ← empezar en solo lectura
   ```
3. **Instalar** (crea el diccionario, las tablas y migra clubes, mascotas y vehículos una sola vez). Se puede repetir sin riesgo:
   ```
   crm clientes instalar
   crm clientes estado
   ```
4. **Cargar ventas** con el cruce por tarjeta corregido: `crm etl`.
5. **Piloto en solo lectura** con mercadeo. Revisar fichas, compras y duplicados.
6. **Activar escritura** (`CRM_CLIENTES_ESCRITURA=true`) cuando se apruebe. Reiniciar el servicio.

Si `CREATE DATABASE` no estuviera disponible en la versión 10.10, el diccionario vacío se crea con el **Advantage Data Architect 10.10** que ya está instalado (`C:\Program Files (x86)\Advantage 10.10\ARC`), en la misma ruta y con la misma contraseña. Después se ejecuta `crm clientes instalar`, que crea las tablas.

**Para deshacer todo:** apagar el CRM y borrar la carpeta `CRM`. El ERP queda exactamente como estaba, salvo los registros de `POSCLI` editados, que tienen su valor anterior en la auditoría.

---

## 9. Lo que se hizo en la copia de prueba (2026-11-13)

- Respaldo verificado en `D:\RESPALDOS_CRM\20261113-1604-antes-de-clientes360`.
- Diccionario `D:\ADD_FORTUNER\CRM\CRM_FORTUNER.add` creado con las 9 tablas.
- Migración: **92.045** afiliaciones a los 5 clubes, **38.809** mascotas, **24.998** vehículos y **19** clientes marcados inactivos por «fallecido» según la observación del ERP.
- 1.410 mascotas venían con el código `10`, que no existe en `GANMASCOTA`. Se reclasificaron como «Otro» (`99`), con registro en la auditoría.
- Prueba completa con clientes de prueba (documentos `99000001` a `99000003`): crear, editar, conflicto de versión, mascotas, vehículos, clubes, duplicado, fusión, anonimización y eliminación. Todo quedó en `aplicado`, sin fallos. Los clientes de prueba se eliminaron al final; su rastro queda en `CRM_AUDITORIA`.
- **Ningún cliente real fue modificado.**

---

## 10. Pendientes para confirmar con los creadores de la base

1. ¿Por qué `POSCLI` no tiene altas ni cambios después del **2025-04-29** si se sigue vendiendo? En 2026 hay 15.666 documentos y tarjetas en ventas que no existen en `POSCLI`.
2. ¿Qué significa **`CLUBAMAC`**? Hoy se muestra como «Club AMAC».
3. Confirmar la regla de la tarjeta nueva: `2` + documento a 12 dígitos.
4. **`GANPROFE`** tiene 16 profesiones, pero `POSCLI` usa códigos que no están (016–019, 99). Se muestran con el texto guardado.
5. **`DPTOS`** solo trae Caldas y Risaralda, aunque `CIUDAD` tiene municipios de otros departamentos. El CRM completa los nombres con la lista oficial del DANE.
6. ¿El POS bloquea el registro de `POSCLI` mientras factura? El CRM usa bloqueo de registro compatible, así que no debería interferir. Hay que confirmarlo con la caja abierta.
7. Usuario propio de Advantage para el CRM, con permiso de escritura **solo** en `POSCLI` y en el diccionario del CRM. Hoy se usa `AdsSys`.
8. `Actu_diccionario.sql` borra todas las columnas de `POSCLI`. **No se debe ejecutar.** Además, la tabla `TIDGON` está desincronizada con el diccionario.
