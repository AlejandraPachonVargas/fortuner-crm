<#
  Carga datos del ERP (ADVANTAGE / Publidata) al modelo analítico del CRM.
  Uso:   scripts\cargar-datos.ps1            -> incremental (maestros + 2 últimos meses de ventas)
         scripts\cargar-datos.ps1 -Completo  -> histórico completo (la primera vez; puede tardar ~1 h)
  Es SOLO LECTURA sobre el ERP: no bloquea la facturación.
#>
param([switch]$Completo, [int]$Meses = 0)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$args2 = @('etl')
if ($Completo) { $args2 += '--full' }
if ($Meses -gt 0) { $args2 += @('--meses', $Meses) }
& .\.venv\Scripts\crm.exe @args2
