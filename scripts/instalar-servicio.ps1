<#
  Deja el CRM funcionando en el servidor Windows SIN instalar software adicional, con el Programador de tareas:
    - «FORTUNER CRM» : arranca con Windows, se reinicia solo si se cae (cada minuto, hasta 999 veces).
    - «FORTUNER CRM carga» : actualiza los datos del ERP cada noche (02:30).
  Ejecutar como Administrador:   powershell -ExecutionPolicy Bypass -File scripts\instalar-servicio.ps1
  Para quitarlo:                 scripts\instalar-servicio.ps1 -Quitar
  Alternativa: NSSM (https://nssm.cc) si prefiere un servicio de Windows clásico.
#>
param([switch]$Quitar, [string]$Hora = '02:30')
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$crm = Join-Path $raiz '.venv\Scripts\crm.exe'
$log = Join-Path $raiz 'data\logs'

if ($Quitar) {
    'FORTUNER CRM', 'FORTUNER CRM carga' | ForEach-Object { Unregister-ScheduledTask -TaskName $_ -Confirm:$false -ErrorAction SilentlyContinue }
    Write-Host 'Tareas eliminadas.'; return
}
if (-not (Test-Path $crm)) { throw 'Ejecute primero scripts\instalar.ps1' }
New-Item -ItemType Directory -Force $log | Out-Null

# cmd /c permite redirigir la salida a un archivo de registro.
$srv = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$crm`" servir >> `"$log\servidor.log`" 2>&1`"" -WorkingDirectory $raiz
$etl = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$crm`" etl >> `"$log\carga.log`" 2>&1`"" -WorkingDirectory $raiz
$ajustes = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
$sistema = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName 'FORTUNER CRM' -Action $srv -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $ajustes -Principal $sistema -Force | Out-Null
Register-ScheduledTask -TaskName 'FORTUNER CRM carga' -Action $etl -Trigger (New-ScheduledTaskTrigger -Daily -At $Hora) -Settings $ajustes -Principal $sistema -Force | Out-Null
Start-ScheduledTask -TaskName 'FORTUNER CRM'
Write-Host "Listo. CRM en marcha (puerto CRM_PORT de .env). Carga nocturna a las $Hora. Registros en $log"
Write-Host 'Recuerde: la cuenta SYSTEM debe poder leer la carpeta del ERP (ADS_DATA_DIRECTORY) y tener el driver ODBC instalado a nivel de equipo.' -ForegroundColor Yellow
