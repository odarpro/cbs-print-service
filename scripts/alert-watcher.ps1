# =============================================================================
# alert-watcher.ps1  –  CBS Print Service
#
# Vigilante de alertas que corre en la sesión del usuario.
# Monitorea la carpeta Alertas (ruta derivada de config.json) y muestra un
# MessageBox por cada archivo nuevo.
#
# Cada MessageBox se muestra en un proceso PowerShell hijo (asíncrono) para que
# el bucle de vigilancia NUNCA se bloquee, aunque el usuario no confirme la caja.
# =============================================================================

# ── Guard: evitar múltiples instancias ──────────────────────────────────────
$mutexName = 'Global\CBSAlertWatcher_v300_SingleInstance'
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) {
    exit 0
}

# ── Log de diagnóstico ──────────────────────────────────────────────────────
$logFile = Join-Path $env:TEMP 'cbs-alert-watcher.log'
function Write-WatcherLog([string]$Message) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

Add-Type -AssemblyName System.Windows.Forms

# ── Muestra un MessageBox en proceso hijo (no bloquea el bucle) ─────────────
function Show-AlertBox([string]$Body, [string]$Title, [int]$Icon) {
    $escapedBody  = $Body.Replace("'", "''")
    $escapedTitle = $Title.Replace("'", "''")
    $script = @"
Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.MessageBox]::Show('$escapedBody', '$escapedTitle', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]$Icon)
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    Start-Process powershell.exe `
        -ArgumentList '-NoProfile','-WindowStyle','Hidden','-EncodedCommand',$encoded `
        -WindowStyle Hidden
}

try {
    Write-WatcherLog 'Iniciando vigilante de alertas'

    $configPath = Join-Path $PSScriptRoot '..\config.json'
    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.logFolder) {
            $alertDir = Join-Path (Split-Path $config.logFolder -Parent) 'Alertas'
        } else {
            $alertDir = 'C:\Impresiones\Alertas'
        }
    } else {
        $alertDir = 'C:\Impresiones\Alertas'
    }
    if (-not (Test-Path $alertDir)) {
        New-Item -ItemType Directory -Path $alertDir -Force -ErrorAction SilentlyContinue | Out-Null
        icacls $alertDir /grant '*S-1-5-32-545:(OI)(CI)M' 2>$null | Out-Null
    }
    Write-WatcherLog "Carpeta de alertas: $alertDir"

    while ($true) {
        $files = Get-ChildItem -Path $alertDir -Filter '*.txt' -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
            if ($content) {
                $vbIcon = 64
                if ($content -match '\[ERROR\]') { $vbIcon = 0 }
                elseif ($content -match '\[AVISO\]') { $vbIcon = 48 }

                $title = ($content -split "`n")[0]
                $body = ($content -split "`n`n", 2)[1]
                if (-not $body) { $body = $content }

                Show-AlertBox $body.Trim() $title.Trim() $vbIcon
                Write-WatcherLog "Alerta mostrada: $($title.Trim())"
            }
            try { Remove-Item -Path $file.FullName -Force } catch {}
        }
        Start-Sleep -Seconds 2
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
