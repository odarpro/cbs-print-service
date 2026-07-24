# =============================================================================
# alert-watcher.ps1  –  CBS Print Service
#
# Vigilante de alertas que corre en la sesión del usuario.
# Monitorea la carpeta Alertas (ruta derivada de config.json) y muestra MessageBox por cada archivo nuevo.
# Incluye guard anti-múltiples-instancias para evitar MessageBox duplicados.
# =============================================================================

# ── Guard: evitar múltiples instancias ──────────────────────────────────────
$mutexName = 'Global\CBSAlertWatcher_v190_SingleInstance'
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) {
    # Ya hay otra instancia corriendo, salir silenciosamente
    exit 0
}

# Leer configuración
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
if (-not (Test-Path $alertDir)) { New-Item -ItemType Directory -Path $alertDir -Force | Out-Null }

Add-Type -AssemblyName System.Windows.Forms

try {
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

                [System.Windows.Forms.MessageBox]::Show($body.Trim(), $title.Trim(), [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]$vbIcon)
            }
            try { Remove-Item -Path $file.FullName -Force } catch {}
        }
        Start-Sleep -Seconds 2
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
