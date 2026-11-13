# Despliegue en el servidor (Git Bash) — paso a paso

> Comandos para **Git Bash** en el servidor Windows. Cada bloque se ejecuta desde la carpeta del proyecto, salvo el primero.
> Lo que dice `<…>` se reemplaza por el valor real.

## 0. Antes de empezar (no se salta)

- [ ] **Respaldo de producción** de `POSCLI.adt`, `POSCLI.adi`, `PUBLIDATA.add`, `PUBLIDATA.ai` y `PUBLIDATA.am`.
- [ ] Python 3.11 o superior, Node.js 20 o superior, Git y el driver ODBC «Advantage StreamlineSQL ODBC» (64 bits) instalados.
- [ ] Saber tres rutas: el `PUBLIDATA.add` de producción, la carpeta donde quedará el diccionario del CRM y la carpeta real de **GANAPTOS**.
- [ ] Preguntar a los creadores de la base por qué `POSCLI` no tiene altas desde abril de 2025 (en la copia).

Respaldo desde Git Bash (cambie la ruta del ERP):
```bash
ERP="/c/ADD_FORTUNER"; DEST="/d/RESPALDOS_CRM/$(date +%Y%m%d-%H%M)-antes-de-clientes360"; mkdir -p "$DEST" && cp -p "$ERP"/POSCLI.adt "$ERP"/POSCLI.adi "$ERP"/PUBLIDATA.add "$ERP"/PUBLIDATA.ai "$ERP"/PUBLIDATA.am "$DEST"/ && sha256sum "$ERP/POSCLI.adt" "$DEST/POSCLI.adt"
```
Los dos códigos `sha256` deben ser iguales.

## 1. Descargar el proyecto
```bash
cd /d/
git clone -b clientes-360 https://github.com/AlejandraPachonVargas/fortuner-crm.git
cd fortuner-crm
```

## 2. Instalar (entorno Python, interfaz, `.env` con claves nuevas y pruebas)
```bash
bash scripts/instalar.sh
```
Debe terminar con `67 passed`.

## 3. Completar `.env`
```bash
notepad .env
```
| Variable | Valor |
|---|---|
| `CRM_ENV` | `production` |
| `ADS_DATA_DIRECTORY` | Ruta del `PUBLIDATA.add` de producción, por ejemplo `C:\ADD_FORTUNER\PUBLIDATA.add` o `\\SERVIDOR_ERP:2000\C$\ADD_FORTUNER\PUBLIDATA.add` |
| `ADS_USER` / `ADS_PASSWORD` | Usuario y clave de Advantage |
| `ADS_CRM_DIRECTORY` | Misma forma que la anterior, terminada en `\CRM\CRM_FORTUNER.add` |
| `ADS_CATALOGOS_DIRECTORY` | Carpeta real de GANAPTOS |
| `DEEPSEEK_API_KEY` | Clave de la IA |
| `CRM_CLIENTES_ESCRITURA` | **`false`** por ahora |

`CRM_API_KEY`, `CRM_ADMIN_KEY` y `ADS_CRM_PASSWORD` ya vienen generadas: **guárdelas en un lugar seguro**.

## 4. Probar la conexión, instalar Clientes 360° y cargar las ventas
```bash
export PYTHONUTF8=1
./.venv/Scripts/crm.exe probar-ads
./.venv/Scripts/crm.exe clientes instalar
./.venv/Scripts/crm.exe clientes estado
./.venv/Scripts/crm.exe etl --full
```
- `clientes instalar` crea el diccionario del CRM **en este servidor**, crea sus 9 tablas y copia una sola vez los clubes, las mascotas y los vehículos desde `POSCLI`. Tarda alrededor de 1 minuto y se puede repetir sin riesgo.
- `etl --full` carga las ventas. La primera vez tarda alrededor de 1 hora.

## 5. Verificar que todo está OK (solo lectura)
```bash
./.venv/Scripts/crm.exe clientes verificar
```
Debe terminar en **`0 fallas - TODO LISTO`**. Revise también la línea de versión de Advantage y las de catálogos.

## 6. Encender el CRM
Para probarlo a mano (Ctrl+C lo detiene):
```bash
./.venv/Scripts/crm.exe servir
```
Abra `http://127.0.0.1:8900/clientes`. La franja azul debe decir «Conectado a ADVANTAGE… Modo solo lectura».

Para dejarlo como servicio que arranca con Windows y carga datos cada noche, ejecute **como Administrador**:
```bash
powershell -ExecutionPolicy Bypass -File scripts/instalar-servicio.ps1
```

## 7. Activar la escritura (después del piloto en solo lectura)
```bash
sed -i 's/^CRM_CLIENTES_ESCRITURA=.*/CRM_CLIENTES_ESCRITURA=true/' .env
./.venv/Scripts/crm.exe clientes verificar --escritura
```
`--escritura` crea en `POSCLI` el cliente de prueba `9900000077`, lo edita, le agrega una mascota, comprueba que la caja lo vería y lo elimina. Debe terminar en `0 fallas`. Después reinicie el servicio:
```bash
powershell -Command "Stop-ScheduledTask 'FORTUNER CRM'; Start-ScheduledTask 'FORTUNER CRM'"
```
**Ideal:** hacer esta prueba con alguien facturando en caja al mismo tiempo.

## 8. Revisión diaria durante el piloto
```bash
./.venv/Scripts/crm.exe clientes verificar
```
La línea «CRM: auditoría» debe decir *sin cambios pendientes ni fallidos*.

## Actualizar a una versión nueva
```bash
powershell -Command "Stop-ScheduledTask 'FORTUNER CRM'"
git pull
bash scripts/instalar.sh
./.venv/Scripts/crm.exe clientes instalar
./.venv/Scripts/crm.exe clientes verificar
powershell -Command "Start-ScheduledTask 'FORTUNER CRM'"
```
El servidor se detiene primero porque, si está corriendo, Windows no deja reemplazar `crm.exe`.

## Volver atrás
- **Desactivar la edición** sin apagar nada: `CRM_CLIENTES_ESCRITURA=false` en `.env` y reiniciar el servicio.
- **Quitar el servicio:** `powershell -ExecutionPolicy Bypass -File scripts/instalar-servicio.ps1 -Quitar`
- **Quitar Clientes 360° por completo:** borrar la carpeta `CRM` del diccionario del CRM. El ERP no se toca. Cada valor que el CRM cambió en `POSCLI` tiene su valor anterior en `CRM_AUDITORIA`.
