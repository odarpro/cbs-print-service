# =============================================================================
# install-alert-watcher-scheduled.ps1  –  CBS Print Service
#
# Registra el vigilante de alertas como tarea programada de Windows.
# Se ejecuta en la sesión del usuario (no Session 0) al iniciar sesión.
# Reinicia automáticamente si falla.
# =============================================================================

param(
    [string]$WatcherPath = '',
    [switch]$Uninstall
)

$TaskName = 'CBSAlertWatcher'
$TaskFolder = '\CBS Print Service'

# ── Modo desinstalación ────────────────────────────────────────────────────
if ($Uninstall) {
    # La tarea usa un wrapper VBS que deja el watcher como proceso independiente.
    # Detenerlo explícitamente evita que sobreviva a la eliminación de la tarea.
    try {
        Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -like '*alert-watcher.ps1*' } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Write-Host "[OK] Proceso del vigilante detenido."
    } catch {
        Write-Host "[INFO] No se pudo comprobar el proceso del vigilante."
    }

    try {
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath "$TaskFolder\" -Confirm:$false -ErrorAction Stop
        Write-Host "[OK] Tarea '$TaskName' eliminada."
    } catch {
        Write-Host "[INFO] La tarea '$TaskName' no existía."
    }
    # También eliminar el bat legacy de Startup si existe
    $legacyBat = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\CBSAlertWatcher.bat'
    if (Test-Path $legacyBat) {
        Remove-Item $legacyBat -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Bat legacy de Startup eliminado."
    }
    exit 0
}

# Resolver ruta del wrapper .vbs (lanza alert-watcher.ps1 sin ventana visible)
$VbsWrapper = Join-Path $PSScriptRoot 'launch-alert-watcher.vbs'
$WatcherPath = Join-Path $PSScriptRoot 'alert-watcher.ps1'

if (-not (Test-Path $WatcherPath)) {
    Write-Error "No se encontró alert-watcher.ps1 en: $WatcherPath"
    exit 1
}

if (-not (Test-Path $VbsWrapper)) {
    Write-Error "No se encontró launch-alert-watcher.vbs en: $VbsWrapper"
    exit 1
}

# ── Eliminar tarea anterior si existe ──────────────────────────────────────
$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "$TaskFolder\" -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath "$TaskFolder\" -Confirm:$false -ErrorAction SilentlyContinue
}

# ── Eliminar bat legacy de Startup si existe ───────────────────────────────
$legacyBat = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\CBSAlertWatcher.bat'
if (Test-Path $legacyBat) {
    Remove-Item $legacyBat -Force -ErrorAction SilentlyContinue
    Write-Host "[INFO] Bat legacy de Startup eliminado."
}

# ── Crear carpeta de tarea ─────────────────────────────────────────────────
try {
    $folder = Get-ScheduledTaskFolder -TaskPath "$TaskFolder\" -ErrorAction SilentlyContinue
    if (-not $folder) {
        New-ScheduledTaskFolder -Path $TaskFolder -ErrorAction Stop | Out-Null
    }
} catch {
    # La carpeta puede ya existir, ignorar
}

# ── Configurar acción ──────────────────────────────────────────────────────
# Usar wscript.exe + .vbs wrapper para garantizar que no aparezca ventana visible
$wrapperExe = 'wscript.exe'
$wrapperArgs = "`"$VbsWrapper`""

$action = New-ScheduledTaskAction `
    -Execute $wrapperExe `
    -Argument $wrapperArgs

# ── Configurar triggers ────────────────────────────────────────────────────
# Al iniciar sesión del usuario actual
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# ── Configurar settings ────────────────────────────────────────────────────
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

# ── Configurar principal (solo usuario logueado, desktop interactivo) ──────
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# ── Registrar tarea ────────────────────────────────────────────────────────
try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $TaskFolder `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'Vigilante de alertas CBS Print - Muestra MessageBox en sesión del usuario' `
        -Force `
        -ErrorAction Stop | Out-Null

    Write-Host "[OK] Tarea '$TaskName' registrada en Task Scheduler."
    Write-Host "    Trigger: Al iniciar sesion de $env:USERNAME"
    Write-Host "    Ejecuta: $wrapperExe $wrapperArgs"
    Write-Host "    La tarea se ejecuta automaticamente al registrar (si ya esta logueado)"
    Write-Host "    o en el proximo login."

    # Iniciar la tarea de inmediato (si el usuario esta logueado) para que el
    # vigilante arranque sin necesidad de cerrar sesion
    try {
        Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskFolder -ErrorAction Stop
        Write-Host "    Tarea iniciada de inmediato."
    } catch {
        Write-Host "    La tarea se iniciara en el proximo inicio de sesion."
    }
} catch {
    Write-Error "Error al registrar tarea: $_"
    exit 1
}
