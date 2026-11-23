# Manual de uso · Configuración

**FORTUNER CRM — Comercializadora Mercaldas**
Versión 2 · noviembre de 2026 · Para incorporar más adelante al Manual de Usuario.

---

## 1. ¿Para qué sirve Configuración?

Configuración reúne todo lo que personaliza el CRM para cada empresa. Tiene siete pestañas:

| Pestaña | Qué se configura | Sección |
|---|---|---|
| **Canales** | WhatsApp, correo y SMS: proveedor, credenciales y costo por mensaje | §5 a §7 |
| **Empresa** | Nombre, logo, color, datos de contacto, tienda en línea y redes sociales | §8 |
| **Legal y RNE** | Política de datos, pie del correo, cancelación de suscripción y Registro de Números Excluidos | §9 |
| **Reglas de campañas** | Valores por defecto: días sin contactar, grupo de control, vigencia máxima, comprador habitual, descuento sugerido | §10 |
| **Presupuesto** | Topes mensuales por canal y alertas | §11 |
| **Carga del ERP** | Carga automática diaria de los datos del ERP | §12 |
| **Fotos de productos** | Revisar, verificar, subir o quitar la foto de cada producto | §13 |

La pestaña **Canales** conecta los **canales de difusión** del CRM:

| Canal | Para qué se usa | Qué se necesita |
|---|---|---|
| **WhatsApp** | Campañas y automatizaciones por WhatsApp | Una cuenta de **WhatsApp Business Platform** (API de Meta) con una plantilla de marketing aprobada |
| **Correo electrónico** | Campañas y automatizaciones por correo | Una cuenta de **Gmail / Google Workspace** u otro proveedor de correo con acceso **SMTP** |
| **Mensaje de texto (SMS)** | Campañas y automatizaciones por SMS | Una cuenta con un **proveedor de SMS** (Twilio, Infobip, LabsMobile u otro con API) |

**Regla principal:** un canal solo se puede usar cuando está **completo y activo**. Mientras le falte un dato
obligatorio, o mientras esté desactivado, aparece **opaco** (gris) en el paso *Mensaje* de las campañas y en las
ediciones de las automatizaciones, y no se puede elegir. Si una campaña ya tenía elegido un canal que después quedó sin
configurar, el CRM lo avisa y **no deja publicarla** por ese canal.

> **Modo desarrollo (temporal):** en *Canales* hay un botón **Activar / Apagar modo desarrollo**. Encendido, los canales
> sin configurar o desactivados se pueden usar igual (para probar campañas mientras los envíos son simulados) y arriba se
> ve el aviso «Modo desarrollo». Los topes de presupuesto y el RNE siguen rigiendo. Apagado, rige la regla normal.
> Debe apagarse antes de conectar los canales reales; desaparecerá cuando el CRM salga a producción.

> **Estado actual del CRM:** el envío de mensajes todavía es **simulado**. Configuración ya guarda y valida todo lo que
> exigirá el envío real, y «Probar conexión» verifica las credenciales con cada proveedor, pero ningún cliente recibe
> mensajes hasta que se active la difusión real.

---

## 2. Quién puede usarla

- **Ver** la configuración: cualquier persona que entre al CRM con la clave de acceso. Ve el estado de cada canal y los
  datos generales, **nunca** los tokens ni las contraseñas.
- **Cambiar, probar y traer plantillas**: solo quien entra con la **clave de administración**. Con la clave normal la
  pantalla aparece en *modo consulta* (con un aviso azul) y los campos no se pueden editar.

Para entrar con la clave de administración: cierre la pestaña del CRM (la clave se olvida al cerrarla), vuelva a
abrirlo y escriba la clave de administración.

---

## 3. Cómo llegar

Menú superior **Más › Configuración**, pestaña **Canales**.

La pestaña Canales tiene:

1. **Tres tarjetas arriba** (WhatsApp, Correo, SMS). Cada una muestra el proveedor elegido y el estado del canal. Haga
   clic en una tarjeta para editar ese canal.
2. **Proveedor**: con qué empresa se conecta el canal, y el interruptor **Canal activo**.
3. **Datos de conexión**: los campos que pide ese proveedor. Los obligatorios tienen un asterisco rojo (*). Debajo de
   cada campo hay una ayuda que explica qué es y dónde se consigue.
4. **Panel derecho**: el estado del canal, la lista de lo que falta, quién hizo la última modificación y el resultado
   de la última prueba, con los botones **Guardar cambios** y **Probar conexión**.

### Estados de un canal

| Estado | Significa | ¿Se puede usar? |
|---|---|---|
| 🟢 **Listo para usar** | Todos los datos obligatorios están y el canal está activo | Sí |
| 🟡 **Incompleto** | Se eligió el proveedor pero falta algún dato obligatorio (el panel derecho dice cuál) | No |
| ⚪ **Desactivado** | Está completo pero se apagó el interruptor «Canal activo» | No |
| *(en la campaña)* «Tope mensual de presupuesto alcanzado» | El canal está listo, pero se llegó al tope del mes (§11) | No, hasta el mes siguiente |
| *(en la campaña)* «La lista del RNE está desactualizada» | El RNE está activo y la lista cargada es más vieja de lo permitido (§9.3) | No, hasta cargar una lista nueva |
| ⚪ **Sin configurar** | Nunca se ha configurado | No |
| 🔴 **Credenciales ilegibles** | Las claves guardadas no se pueden leer porque cambió o se perdió la clave de cifrado (ver §14) | No: vuelva a escribirlas |

---

## 4. Cómo se manejan las claves (tokens y contraseñas)

- Los campos de clave (token, contraseña, API key) **se guardan cifrados** en el servidor y **nunca se vuelven a
  mostrar**, ni siquiera al administrador. Después de guardar, el campo dice *«Guardado (…WXYZ)»*, con los últimos 4
  caracteres, para que sepa cuál quedó.
- **Para conservar** una clave ya guardada, deje el campo vacío y guarde: no se pierde.
- **Para cambiarla**, escriba la nueva y guarde.
- **Para borrarla**, use el botón **Borrar** junto al campo y luego **Guardar cambios**. El canal quedará *Incompleto*.
- El ícono del ojo 👁 solo muestra lo que usted está escribiendo en ese momento.
- **Si cambia de proveedor** (por ejemplo, de Twilio a LabsMobile), las claves del proveedor anterior se descartan al
  guardar.
- Cada cambio queda en la **bitácora de auditoría**: quién lo hizo, cuándo y qué campos cambiaron. Nunca se registran
  los valores.

---

## 5. WhatsApp (API de Meta)

### 5.1 Lo que debe existir antes (lo hace el administrador de la cuenta de Meta)

1. Una cuenta de empresa en **Meta Business** (business.facebook.com) verificada.
2. Una **aplicación** en developers.facebook.com con el producto **WhatsApp** agregado.
3. Un **número de teléfono** registrado en WhatsApp Business Platform. Debe ser un número que **no** esté usando la app
   normal de WhatsApp ni WhatsApp Business del celular.
4. Un **usuario del sistema** (Configuración del negocio › Usuarios › Usuarios del sistema) con acceso a la aplicación
   y a la cuenta de WhatsApp, y un **token permanente** generado para ese usuario con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.
   *No use el token temporal de la pantalla de pruebas: vence en 24 horas.*
5. Al menos una **plantilla de mensaje** de categoría **Marketing**, **aprobada** por Meta (Administrador de WhatsApp ›
   Plantillas de mensajes).

> Los nombres de los menús de Meta cambian con frecuencia; si no encuentra una opción, búsquela por su nombre en inglés
> (*System users*, *Phone number ID*, *WhatsApp Business Account ID*, *Message templates*).

### 5.2 Campos

| Campo | Obligatorio | Dónde se consigue |
|---|---|---|
| **Token de acceso permanente** | Sí | El token del usuario del sistema (paso 4). Se guarda cifrado. |
| **Identificador del número de teléfono** | Sí | developers.facebook.com › su app › WhatsApp › Configuración de la API: *Phone number ID* (solo dígitos; **no** es el número de celular). |
| **Identificador de la cuenta de WhatsApp Business** | Sí | En la misma pantalla: *WhatsApp Business Account ID* (solo dígitos). |
| **Versión de la API Graph** | Sí | Formato `vNN.N` (por defecto `v23.0`). Use la versión vigente que indique Meta en su panel. |
| **Plantilla de marketing para campañas** | Sí | El nombre exacto de la plantilla aprobada, en minúsculas y con guiones bajos (p. ej. `promo_general`). |
| **Idioma de la plantilla** | Sí | El código de idioma con el que se aprobó: `es`, `es_MX`, `es_ES`… |
| **Encabezado de la plantilla** | Sí | Debe coincidir con la plantilla: *Sin encabezado*, *Imagen* (se envía el banner de la campaña o la foto del producto) o *Texto*. |
| **Variables del cuerpo de la plantilla** | Sí | Qué va en cada `{{1}}`, `{{2}}`… del cuerpo (ver §5.3). |
| **Clave secreta de la aplicación (App Secret)** | No | developers.facebook.com › su app › Configuración › Básica. Se usará para recibir avisos de entrega y respuestas. |
| **Token de verificación del webhook** | No | Una palabra secreta que usted inventa y escribe igual en el panel de Meta al configurar el webhook. |
| **Costo por mensaje (COP)** | Sí | Lo que cobra Meta por conversación de marketing en Colombia. Se usa para estimar costos. |

### 5.3 Plantilla y variables

**Por qué hace falta una plantilla.** Meta no permite que una empresa le escriba primero a un cliente con texto libre.
El primer mensaje (y cualquier mensaje después de 24 horas sin respuesta del cliente) debe usar una **plantilla
aprobada**. La plantilla tiene un texto fijo con huecos `{{1}}`, `{{2}}`… que el CRM llena para cada cliente.

**Ejemplo de plantilla** (se crea y se aprueba en Meta):

> Encabezado: *Imagen*
> Cuerpo: `Hola {{1}} 👋 {{2}}`
> Pie: `Mercaldas`

En Configuración se indicaría: *Encabezado* = Imagen, *Variables* = `{{1}}` → **Nombre del cliente**,
`{{2}}` → **Texto de la campaña**.

Opciones para cada variable:

| Opción | Qué pone el CRM |
|---|---|
| Nombre del cliente | El nombre del cliente |
| Texto de la campaña | El texto escrito en el paso *Mensaje* para WhatsApp |
| Vigencia de la oferta | p. ej. «del 22 al 24 de noviembre» |
| Oferta (Automatizaciones) | La oferta de la edición (p. ej. «10 % de descuento en tu compra») |
| Nombre de la tienda | El nombre del remitente |

Las variables deben ir **en el mismo orden y en la misma cantidad** que en la plantilla aprobada; si no, Meta rechaza el
mensaje.

**Traer las plantillas desde Meta (recomendado).** Con el token, el identificador de la cuenta y la versión ya
**guardados**, pulse **Traer de Meta** en el recuadro *Plantillas aprobadas en Meta*. Aparece la lista con el estado
(Aprobada, Pendiente, Rechazada), la categoría, el encabezado y cuántas variables tiene cada una. Con **Usar para
campañas**, el CRM llena el nombre, el idioma, el encabezado y la cantidad de variables. Revise que cada variable tenga
la opción correcta y pulse **Guardar cambios**.

### 5.4 Probar

**Probar conexión** consulta el número en Meta con el token y muestra el número, el nombre verificado y la calificación
de calidad. **No envía ningún mensaje.**

---

## 6. Correo electrónico

### 6.1 Proveedores

- **Gmail o Google Workspace.** El servidor (`smtp.gmail.com`), el puerto (587) y la seguridad (STARTTLS) ya vienen
  fijos.
- **Otro proveedor SMTP** (Outlook / Microsoft 365, SendGrid, Amazon SES, Brevo, el hosting de la empresa…). El servidor,
  el puerto y la seguridad los entrega el proveedor.

> **Recomendación:** Gmail sirve para empezar y para volúmenes pequeños: permite unos **500 correos al día** con una
> cuenta personal o **2.000** con Google Workspace, y no está pensado para correo masivo. Para campañas a miles de
> clientes conviene un proveedor de correo masivo (SendGrid, Amazon SES, Brevo…).

### 6.2 Gmail: la contraseña de aplicación

Gmail **no acepta la contraseña normal** de la cuenta. Hay que crear una **contraseña de aplicación**:

1. Entre a myaccount.google.com con la cuenta que enviará los correos.
2. **Seguridad › Verificación en dos pasos**: actívela si no lo está. Es obligatoria.
3. **Seguridad › Contraseñas de aplicaciones** (o busque «contraseñas de aplicaciones»): cree una llamada «FORTUNER CRM».
4. Google muestra una clave de **16 letras**. Cópiela en el campo **Contraseña de aplicación** del CRM y guarde.
   Google no la vuelve a mostrar.

En Google Workspace, el administrador de la organización debe permitir las contraseñas de aplicación.

### 6.3 Campos

| Campo | Obligatorio | Nota |
|---|---|---|
| Servidor SMTP / Puerto / Seguridad | Sí | Fijos en Gmail. En otro proveedor: los que él indique. El CRM **nunca** envía sin cifrado. |
| Usuario (cuenta de Gmail o usuario SMTP) | Sí | |
| Contraseña (de aplicación o SMTP) | Sí | Se guarda cifrada. |
| Correo del remitente | Sí | La dirección desde la que salen los correos. En Gmail, normalmente la misma cuenta. |
| Nombre del remitente | Sí | Lo que el cliente ve en la bandeja, p. ej. «Mercaldas». |
| Responder a | No | A dónde llegan las respuestas de los clientes. |
| Máximo de correos por día | Sí | El límite del proveedor (Gmail: 500 o 2.000). |
| Costo por mensaje (COP) | Sí | Para estimar costos (Gmail: 0). |

### 6.4 Probar

**Probar conexión** abre la conexión cifrada con el servidor e **inicia sesión**. No envía ningún correo. Si dice que el
usuario o la contraseña no son válidos, revise que sea una **contraseña de aplicación**.

---

## 7. Mensaje de texto (SMS)

### 7.1 Proveedores

| Proveedor | Datos que pide | Qué hace «Probar conexión» |
|---|---|---|
| **Twilio** | Account SID (empieza por `AC`), Auth Token, número remitente o *Messaging Service SID* | Consulta la cuenta |
| **Infobip** | URL base de la API (personal de la cuenta, `https://…api.infobip.com`), API key, remitente (opcional) | Consulta el saldo |
| **LabsMobile** | Usuario (correo de la cuenta), token de API, remitente (opcional) | Consulta los créditos |
| **Otro proveedor (API HTTP)** | URL de envío (https), nombre y valor del encabezado de autenticación, cuerpo JSON con `{numero}` y `{mensaje}` | Comprueba que la dirección responda. Este tipo de proveedor no permite validar la clave sin enviar un SMS: confírmela con el proveedor. |

Campos comunes:

- **Indicativo del país** (por defecto 57, Colombia): se antepone a los celulares de 10 dígitos.
- **Costo por mensaje (COP)**.

### 7.2 Proveedor HTTP genérico (Hablame, Aldeamo, Masivapp…)

Use esta opción cuando el proveedor no esté en la lista. Pídale al proveedor su documentación de API y llene:

- **URL de envío**: la dirección https a la que se envía cada SMS.
- **Nombre del encabezado de autenticación**: p. ej. `Authorization`, `X-Api-Key`, `account`.
- **Valor del encabezado**: la clave o token (p. ej. `Bearer abc123…`). Se guarda cifrado.
- **Cuerpo de la petición (JSON)**: la forma en que el proveedor espera los datos. Escriba `{numero}` donde va el
  celular y `{mensaje}` donde va el texto. Ejemplo:

  ```json
  {"numero": "{numero}", "sms": "{mensaje}"}
  ```

  El CRM verifica que sea un JSON válido y que tenga `{numero}` y `{mensaje}`.

---

## 8. Empresa

Pestaña **Empresa**. Aquí se personaliza el CRM para cada empresa que lo use: todo lo que el cliente ve en WhatsApp, en
el correo y en la página de baja sale de esta pantalla.

| Campo | Para qué sirve |
|---|---|
| **Nombre comercial** (obligatorio) | Remitente en WhatsApp y correo, encabezado del correo, página de baja y textos que redacta la IA |
| Razón social, NIT | Pie legal del correo |
| **Dirección física**, ciudad, teléfono | Pie del correo. Los correos comerciales deben indicar una dirección física del remitente. |
| Correo de contacto | Contacto de la empresa |
| **Enlace de la tienda en línea** y **texto del botón** | El botón del correo («Visítanos en la tienda») lleva a este enlace (debe empezar por `https://`) |
| Instagram, Facebook, TikTok, WhatsApp de atención | Se muestran en el pie del correo |
| **Color de la marca** | Encabezado del correo, botón y página de baja |

**Logo:** botón **Cargar logo** (PNG con fondo transparente, ideal; también JPG o WebP; hasta 3 MB). El CRM lo
redimensiona y lo publica en `/media/empresa/logo.webp`. Sin logo se usa la inicial del nombre. El recuadro
**«Así se ve en el correo»** muestra el resultado al instante.

Pulse **Guardar** después de cambiar los campos. La vista previa de las campañas (paso *Mensaje*) usa estos datos.

---

## 9. Legal y RNE

### 9.1 Política de Tratamiento de Datos

- Si la política está publicada en la web de la empresa, escriba el enlace (`https://…`).
- Si no, use **Cargar PDF** y el CRM la publica en `/media/legal/politica.pdf`.

El pie de cada correo y la página de baja enlazan a la política (si hay enlace web, se usa el enlace).

### 9.2 Pie legal del correo y cancelación de suscripción

- **Pie legal del correo:** el texto al final de cada correo. `{empresa}` se reemplaza por el nombre comercial.
  Trae un texto por defecto que menciona la autorización de datos (Ley 1581 de 2012).
- **Cancelar suscripción:** cada correo lleva un enlace personal de baja. El enlace no muestra la cédula: va cifrado.
  Al abrirlo, el cliente ve una página con el logo y el nombre de la empresa y confirma con un botón. Desde ese momento:
  - deja de recibir ese canal en el CRM (campañas y automatizaciones), aunque el ERP no se haya actualizado;
  - si la escritura en el ERP está habilitada (`CRM_CLIENTES_ESCRITURA=true`), también queda marcado en POSCLI
    (el canal pasa a «No autoriza»).
- **Dirección pública del CRM:** para que el enlace funcione fuera de la oficina, el CRM debe poder abrirse desde
  internet con una dirección `https` (p. ej. `https://crm.miempresa.com`). Escriba esa dirección aquí. La publicación
  del CRM en internet la hace el área de sistemas.
- El recuadro **Cancelaciones de suscripción** muestra cuántas hay por canal y las últimas (con la cédula oculta) y si
  ya quedaron en el ERP.

### 9.3 Registro de Números Excluidos (RNE)

**Qué es.** El RNE es la lista de la CRC donde las personas registran que no quieren recibir publicidad. La Ley 2300
de 2023 obliga a toda empresa a consultarlo **antes de cada envío**. Cubre SMS, mensajes por aplicaciones (WhatsApp),
correo y llamadas, y la persona elige qué canales excluye. La CRC actualiza la lista **a diario**.

**Cómo se obtiene la lista.** La CRC no ofrece una conexión automática. La empresa debe:

1. Inscribirse como empresa en **www.tramitescrcom.gov.co** › «Registro de Empresa» (no tiene costo).
2. Entrar con su usuario y consultar o descargar el listado del RNE.
3. En el CRM, **Legal y RNE › Cargar lista del RNE (CSV o TXT)**. El CRM toma todos los celulares, teléfonos fijos y
   correos del archivo, sin importar las columnas. La lista nueva **reemplaza** la anterior.

**Campos:**

| Campo | Qué hace |
|---|---|
| **Aplicar el RNE** | Encendido: quien está en la lista no recibe mensajes por los canales elegidos |
| **Canales a los que se aplica** | WhatsApp, SMS y/o correo (por defecto los tres) |
| **Antigüedad máxima de la lista** (días, por defecto 7) | Si la lista cargada es más vieja, o no se ha cargado, **esos canales quedan bloqueados** en campañas y automatizaciones hasta actualizarla (falla cerrada) |
| **No aplicar a quien autorizó expresamente** | La CRC indica que la empresa autorizada expresamente sí puede contactar. Actívelo solo con el visto bueno de su asesor jurídico. |

El recuadro muestra el estado (desactivado, aplicándose o vencido), la fecha de la lista y cuántos teléfonos y correos
tiene. Con **Consultar** se verifica si un celular o correo está en la lista.

---

## 10. Reglas de campañas

Valores por defecto que antes estaban fijos en el CRM:

| Regla | Por defecto | Dónde se usa |
|---|---|---|
| No contactar a quien recibió otra campaña en los últimos (días) | 15 | Estrategias listas y campañas nuevas (paso Audiencia › Reglas de contacto). 0 = no excluir. |
| Grupo de control por defecto (%) | 0 | Al publicar (se puede cambiar en cada campaña; máximo 20 %) |
| Vigencia máxima de una oferta (días) | 90 | Al publicar: no deja una vigencia mayor |
| Comprador habitual: mínimo de compras / en los últimos (días) | 3 / 180 | Estrategia «Atraer nuevos compradores» y segmentador «Clientes que ya compran estos productos» |
| Descuento sugerido: % del margen que se puede ceder / tope | 60 % / 30 % | Pestaña «Por inventario y rotación» y su «¿Cómo se calculó?» |

Cada campaña puede seguir ajustando estos valores; aquí se define con qué arrancan.

---

## 11. Presupuesto

- **Tope mensual por canal** (COP; 0 = sin tope) y **avisar al llegar al (%)** (por defecto 80 %).
- **Gasto del mes** = campañas publicadas o programadas para este mes + envíos de las automatizaciones, al costo por
  mensaje de cada canal (pestaña Canales). Se ve con barras por canal.
- **Alertas:**
  - al pasar el porcentaje de alerta, la barra se pone amarilla y aparece un aviso **«Presupuesto …»** arriba, junto a
    la fecha de las ventas (un clic lleva a esta pestaña);
  - al llegar al tope, el canal queda **bloqueado hasta el mes siguiente** (opaco en las campañas, con el motivo) y las
    automatizaciones dejan de enviar por él;
  - **una campaña que haría pasar el tope no se puede publicar**: el CRM dice cuánto cuesta y cuánto queda.

---

## 12. Carga del ERP

- **Cargar los datos del ERP todos los días** y la **hora** (por defecto 03:00, de madrugada).
- El CRM debe estar **encendido** a esa hora. Si estaba apagado, la carga se hace al encenderlo, siempre que no hayan
  pasado más de 4 horas desde la hora elegida. Corre una sola vez al día.
- El recuadro **Estado de la carga** muestra si hay una carga en curso, la última carga automática y si fue correcta.
- **Cargar ahora** lanza una carga en el momento (clave de administración).
- Si el servidor no tiene configurada la conexión al ERP (`ADS_DATA_DIRECTORY` en el `.env`), la pantalla lo avisa y no
  carga.

---

## 13. Fotos de productos

Para que los dueños del CRM revisen, producto por producto, que cada foto corresponda al producto.

- **Buscar** por nombre, código de barras o código del ERP.
- **Vistas:**
  - **Se venden y no tienen foto** (los más vendidos primero): para completar las que faltan.
  - **Con foto sin verificar**: las importadas de la carpeta de fotos, para revisarlas.
  - **Verificadas** y **Todos los productos**.
- Cada tarjeta muestra la foto, el nombre, el código de barras, el código del ERP, el grupo, el precio y las ventas de
  90 días, y de dónde salió la foto (importada, con el nombre del archivo, o subida por quién).
- **Botones** (clave de administración):
  - **Es correcta**: queda **Verificada**, con quién y cuándo.
  - **Subir foto / Cambiar**: JPG, PNG o WebP hasta 8 MB. El CRM la convierte al formato liviano y la publica al
    instante en las campañas. Una foto subida a mano queda verificada por quien la subió y **la importación masiva
    nunca la reemplaza**.
  - **Quitar**: el producto queda sin foto.

---

## 14. Seguridad y respaldo (para el administrador del servidor)

- Las claves de los canales se cifran con una **clave de cifrado** del servidor:
  - Si en el archivo `.env` existe `CRM_CIFRADO_CLAVE`, se usa esa (**recomendado**).
  - Si no, el CRM crea sola la primera vez el archivo `data\clave_cifrado.key`.
- **Respalde la clave de cifrado** (la línea del `.env` o el archivo `clave_cifrado.key`) junto con `data\crm.sqlite`.
  Sin ella, las claves guardadas no se pueden leer: los canales aparecen como **Credenciales ilegibles** y hay que volver
  a escribir los tokens y contraseñas.
- Para generar una clave nueva para `.env`:
  ```
  .venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
  Cambiarla deja ilegibles las claves ya guardadas: hágalo antes de configurar los canales o vuelva a escribirlas.
- Ni el `.env` ni la carpeta `data` se suben a GitHub.

---

## 15. Problemas frecuentes

| Problema | Causa probable | Qué hacer |
|---|---|---|
| Los campos no se pueden editar y hay un aviso azul | Entró con la clave normal | Entre con la clave de administración |
| Un canal aparece opaco en la campaña | Está *Incompleto*, *Desactivado* o *Sin configurar* | Abra Configuración y revise «Falta:» en el panel derecho |
| «No se puede publicar: estos canales no están configurados…» | La campaña tiene elegido un canal que quedó sin configurar | Complete el canal o quítelo en el paso *Mensaje* («Quitarlos») |
| WhatsApp: «las credenciales no son válidas» | Token vencido (temporal), revocado o sin permisos | Genere un token permanente de usuario del sistema con los permisos indicados |
| WhatsApp: «no se encontró el recurso (404)» | El *Phone number ID* o la versión están mal | Copie de nuevo el identificador (no el número de celular) y revise la versión |
| WhatsApp: la plantilla no aparece en la lista | Aún no está aprobada o es de otra cuenta | Revise su estado en el Administrador de WhatsApp |
| Gmail: «rechazó el usuario o la contraseña» | Se usó la contraseña normal o no hay verificación en dos pasos | Cree una contraseña de aplicación (§6.2) |
| Correo: «no se pudo conectar» | Servidor o puerto equivocado, o el servidor del CRM no tiene salida a internet por ese puerto | Revise los datos del proveedor y el firewall |
| SMS: HTTP 401 / 403 | Clave equivocada | Copie de nuevo la clave del panel del proveedor |
| «Credenciales ilegibles» | Cambió o se perdió la clave de cifrado del servidor | Vuelva a escribir las claves del canal y guarde (§14) |
| La automatización registra «Ningún canal de esta edición está configurado» | Los canales de esa edición no están listos | Configure al menos uno de sus canales; mientras tanto no envía nada |
| «La campaña supera el tope mensual de presupuesto» | La campaña costaría más de lo que queda del tope | Reduzca la audiencia (tope de personas) o ajuste el tope en Presupuesto |
| Un canal dice «La lista del RNE está desactualizada» | El RNE está activo y la lista tiene más días de los permitidos | Descargue la lista en tramitescrcom.gov.co y cárguela en Legal y RNE |
| El enlace «Cancelar suscripción» no abre desde el celular del cliente | El CRM no está publicado en internet o falta la dirección pública | Pida a sistemas publicar el CRM con https y escriba la dirección en Legal y RNE |
| La carga automática del ERP no corrió | El CRM estaba apagado a esa hora (y más de 4 horas después) o falta la conexión al ERP | Deje el CRM encendido de noche o use «Cargar ahora» |

---

## 16. Resumen rápido

1. **Más › Configuración**, con la clave de administración.
2. Elija el canal y el proveedor.
3. Llene los campos con asterisco (*). Las claves se guardan cifradas.
4. **Guardar cambios**.
5. **Probar conexión** y verifique que el resultado sea verde.
6. Deje marcado **Canal activo**. La tarjeta debe decir 🟢 **Listo para usar**.
7. Desde ese momento el canal aparece habilitado en Campañas y Automatizaciones.
