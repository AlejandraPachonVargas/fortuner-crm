<#
  Instala el CRM en esta máquina (Windows): entorno Python, dependencias, compilación de la interfaz y .env.
  Uso:   powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1
  Requisitos previos: Python 3.11+ (en el PATH o con el lanzador `py`), Node.js 20+ (solo para compilar la interfaz),
  y el driver ODBC «Advantage StreamlineSQL ODBC» (el mismo que usa el ERP / fortuner-dashboards).
#>
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

Write-Host '1/4  Entorno Python (.venv)' -ForegroundColor Cyan
if (-not (Test-Path '.venv\Scripts\python.exe')) {
    if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv .venv } else { python -m venv .venv }
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip | Out-Null
& .\.venv\Scripts\python.exe -m pip install -e ".\backend[dev]"

Write-Host '2/4  Interfaz web (React) -> frontend\dist' -ForegroundColor Cyan
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location frontend
    npm install --no-audit --no-fund
    npm run build
    Pop-Location
} else {
    Write-Warning 'Node.js no está instalado: se omite la compilación. Compile en otra máquina y copie frontend\dist.'
}

Write-Host '3/4  Configuración (.env)' -ForegroundColor Cyan
if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    $k1 = & .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
    $k2 = & .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
    (Get-Content '.env') -replace '^CRM_API_KEY=.*', "CRM_API_KEY=$k1" -replace '^CRM_ADMIN_KEY=.*', "CRM_ADMIN_KEY=$k2" | Set-Content '.env' -Encoding UTF8
    Write-Host '   Se creó .env con claves de acceso nuevas. COMPLETE ADS_USER, ADS_PASSWORD, ADS_DATA_DIRECTORY y DEEPSEEK_API_KEY.' -ForegroundColor Yellow
} else { Write-Host '   .env ya existe: no se modifica.' }

Write-Host '4/4  Prueba de conexión al ERP (solo lectura)' -ForegroundColor Cyan
try { & .\.venv\Scripts\crm.exe probar-ads } catch { Write-Warning "No se pudo conectar al ERP: revise .env. $_" }

Write-Host "`nListo. Siguiente paso: scripts\cargar-datos.ps1  y luego  scripts\iniciar.ps1" -ForegroundColor Green
