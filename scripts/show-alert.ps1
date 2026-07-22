# =============================================================================
# show-alert.ps1  –  CBS Print Service
#
# Envía un mensaje al escritorio del usuario usando el comando msg de Windows.
# Funciona desde cualquier sesión, incluyendo Session 0 (servicios Windows).
#
# Uso:
#   msg * /time:10 "CBS Print - Titulo: Mensaje"
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Title,

    [Parameter(Mandatory=$true)]
    [string]$Message,

    [Parameter(Mandatory=$false)]
    [ValidateSet("info","warn","error")]
    [string]$Level = "info"
)

# Iconos por nivel para el titulo
$icon = switch ($Level) {
    "error" { "[ERROR]" }
    "warn"  { "[AVISO]" }
    default { "[INFO]" }
}

# Formatear mensaje para msg
$formattedMsg = "$icon CBS Print - $Title`n`n$Message"

# Enviar mensaje al escritorio del usuario (todos los sesiones activas)
# /time:15 = el mensaje se cierra solo después de 15 segundos
& msg * /time:15 $formattedMsg 2>&1

# Si msg falla (no disponible en algunas ediciones), escribir a archivo
if ($LASTEXITCODE -ne 0) {
    try {
        $alertDir = Join-Path (Split-Path $PSScriptRoot -Parent) "Alertas"
        if (-not (Test-Path $alertDir)) {
            New-Item -ItemType Directory -Path $alertDir -Force | Out-Null
        }
        $alertFile = Join-Path $alertDir "alert_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
        @"
CBS Print - $Title

$Message

Nivel: $Level
Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
"@ | Out-File -FilePath $alertFile -Encoding UTF8
    }
    catch {}
    exit 1
}

exit 0
