# =============================================================================
# alert-watcher.ps1  –  CBS Print Service
#
# Vigilante de alertas que corre en la sesión del usuario (no en Session 0).
# Monitorea la carpeta de alertas y muestra MessageBox por cada archivo nuevo.
# Se registra en la carpeta Startup del usuario para ejecutarse al iniciar sesión.
#
# No abrir consola — ejecutar con:
#   powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File alert-watcher.ps1
# =============================================================================

# ── Configuración ─────────────────────────────────────────────────────────────
$alertDir = 'C:\Impresiones\Alertas'
$pollMs   = 2000   # Cada 2 segundos revisa la carpeta

# Crear carpeta si no existe
if (-not (Test-Path $alertDir)) {
    New-Item -ItemType Directory -Path $alertDir -Force | Out-Null
}

# ── Icono en system tray ──────────────────────────────────────────────────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.Text = 'CBS Print Service - Vigilante de Alertas'

# Menú contextual (clic derecho para salir)
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$exitItem = $contextMenu.Items.Add('Salir')
$exitItem.Add_Click({
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $contextMenu

# ── Loop de vigilancia ────────────────────────────────────────────────────────
$processed = @{}

while ($true) {
    if (Test-Path $alertDir) {
        $files = Get-ChildItem -Path $alertDir -Filter '*.txt' -File -ErrorAction SilentlyContinue

        foreach ($file in $files) {
            $key = $file.FullName + '_' + $file.LastWriteTime.Ticks

            if (-not $processed.ContainsKey($key)) {
                $processed[$key] = $true

                # Leer contenido del archivo
                $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue

                if ($content) {
                    # Determinar icono por contenido
                    $vbIcon = 64  # Information
                    if ($content -match '\[ERROR\]') { $vbIcon = 0 }
                    elseif ($content -match '\[AVISO\]') { $vbIcon = 48 }

                    # Extraer título (primera línea)
                    $title = ($content -split "`n")[0]
                    if (-not $title) { $title = 'CBS Print Service' }

                    # Extraer mensaje (resto del contenido)
                    $body = ($content -split "`n`n", 2)[1]
                    if (-not $body) { $body = $content }

                    # Mostrar MessageBox
                    [System.Windows.Forms.MessageBox]::Show(
                        $body.Trim(),
                        $title.Trim(),
                        [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]$vbIcon
                    )
                }

                # Eliminar archivo después de mostrar
                try { Remove-Item -Path $file.FullName -Force } catch {}
            }
        }
    }

    Start-Sleep -Milliseconds $pollMs
}
