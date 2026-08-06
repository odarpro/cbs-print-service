# ============================================================================
# install-virtual-printer.ps1
# Crea una impresora virtual que captura la salida en un archivo PDF FIJO,
# sin mostrar el diálogo "Guardar como" (a diferencia de PORTPROMPT).
#
# Metodo: clonar el driver "Microsoft Print To PDF" y asignar un puerto local
# con ruta de archivo. Cada trabajo de impresión SOBREESCRIBE el archivo
# (ver nota al final). Referencia: KB 2528405.
#
# ADVERTENCIA: en la practica, el driver "Microsoft Print To PDF" suele IGNORAR
# el puerto local de archivo (los trabajos terminan en estado Normal/Error sin
# escribir nada). Para validar los PDFs generados por el servicio use
# config.json -> pdfCaptureFolder (ver README "Validación de PDFs en desarrollo").
#
# Requisito: EJECUTAR COMO ADMINISTRADOR.
#   Uso:
#     powershell -ExecutionPolicy Bypass -File install-virtual-printer.ps1
#     powershell -ExecutionPolicy Bypass -File install-virtual-printer.ps1 -PrinterName "Recibos"
#     powershell -ExecutionPolicy Bypass -File install-virtual-printer.ps1 -OutputFile "D:\Impresiones\PDF_Captura\impresion.pdf"
# ============================================================================

param(
  [string]$PrinterName = "CapturaPDF",
  [string]$DriverName  = "Microsoft Print To PDF",
  [string]$OutputFile  = "C:\Impresiones\PDF_Captura\impresion.pdf"
)

$ErrorActionPreference = "Stop"

# --- Verificar administrador -----------------------------------------------
$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Debe ejecutar este script COMO ADMINISTRADOR (clic derecho -> Ejecutar con PowerShell / Ejecutar como administrador)."
  exit 1
}

Write-Host "== Instalando impresora virtual: $PrinterName ==" -ForegroundColor Cyan

# --- Carpeta de salida ------------------------------------------------------
$outDir = Split-Path -Parent $OutputFile
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  Write-Host "Carpeta creada: $outDir" -ForegroundColor Green
}

# --- Verificar driver -------------------------------------------------------
$driver = Get-PrinterDriver -Name $DriverName -ErrorAction SilentlyContinue
if (-not $driver) {
  Write-Error "Driver no encontrado: $DriverName"
  exit 1
}
Write-Host "Driver OK: $DriverName"

# --- Crear puerto local (ruta de archivo) ----------------------------------
$port = Get-PrinterPort -Name $OutputFile -ErrorAction SilentlyContinue
if (-not $port) {
  Add-PrinterPort -Name $OutputFile
  Write-Host "Puerto local creado: $OutputFile" -ForegroundColor Green
} else {
  Write-Host "Puerto local ya existia: $OutputFile" -ForegroundColor Yellow
}

# --- (Re)crear impresora ----------------------------------------------------
$existing = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "La impresora '$PrinterName' ya existia; se reconfigura..." -ForegroundColor Yellow
  Remove-Printer -Name $PrinterName
}

Add-Printer -Name $PrinterName -DriverName $DriverName -PortName $OutputFile

Write-Host ""
Write-Host "Impresora virtual creada correctamente:" -ForegroundColor Green
Write-Host "  Nombre : $PrinterName"
Write-Host "  Driver : $DriverName"
Write-Host "  Salida : $OutputFile"
Write-Host ""
Write-Host "NOTAS:"
Write-Host "  * ATENCION: el driver 'Microsoft Print To PDF' puede ignorar el puerto"
Write-Host "    local de archivo (trabajos en estado Normal sin archivo generado)."
Write-Host "    Para validar PDFs use config.json -> pdfCaptureFolder."
Write-Host "  * Cada impresion SOBREESCRIBE $OutputFile (nombre fijo)."
Write-Host "    Para conservar resultados, copie/renombre el archivo tras cada impresion."
Write-Host "  * Para usarla desde el servicio: en config.json (o parametro 'p' del"
Write-Host "    archivo) use un nombre que coincida, ej. printers.voucher.name = 'Captura'"
Write-Host "    o -PrinterName 'Recibos' para reutilizar la configuracion actual."
Write-Host ""
Write-Host "Desinstalacion: powershell -ExecutionPolicy Bypass -File uninstall-virtual-printer.ps1 -PrinterName '$PrinterName'"
