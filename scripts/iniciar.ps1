<#
  Inicia el CRM (API + interfaz) en una sola ventana. Uso: scripts\iniciar.ps1
  Para dejarlo como servicio que arranca con Windows: scripts\instalar-servicio.ps1
#>
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:PYTHONIOENCODING = 'utf-8'
& .\.venv\Scripts\crm.exe servir
