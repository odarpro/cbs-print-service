# ============================================================================
# uninstall-virtual-printer.ps1
# Elimina la impresora virtual de captura y su puerto local.
# Requisito: EJECUTAR COMO ADMINISTRADOR.
#   Uso: powershell -ExecutionPolicy Bypass -File uninstall-virtual-printer.ps1
# ============================================================================

param(
  [string]$PrinterName = "CapturaPDF",
  [string]$OutputFile  = "C:\Impresiones\PDF_Captura\impresion.pdf"
)

$ErrorActionPreference = "Stop"

$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Debe ejecutar este script COMO ADMINISTRADOR."
  exit 1
}

Write-Host "== Desinstalando impresora virtual: $PrinterName ==" -ForegroundColor Cyan

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($printer) {
  Remove-Printer -Name $PrinterName
  Write-Host "Impresora eliminada: $PrinterName" -ForegroundColor Green
} else {
  Write-Host "La impresora '$PrinterName' no existia." -ForegroundColor Yellow
}

$port = Get-PrinterPort -Name $OutputFile -ErrorAction SilentlyContinue
if ($port) {
  Remove-PrinterPort -Name $OutputFile
  Write-Host "Puerto local eliminado: $OutputFile" -ForegroundColor Green
} else {
  Write-Host "El puerto local no existia." -ForegroundColor Yellow
}

Write-Host "Listo." -ForegroundColor Green
