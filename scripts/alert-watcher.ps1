# =============================================================================
# alert-watcher.ps1  –  CBS Print Service
#
# Vigilante de alertas que corre en la sesión del usuario.
# Monitorea C:\Impresiones\Alertas y muestra MessageBox por cada archivo nuevo.
# =============================================================================

$alertDir = 'C:\Impresiones\Alertas'
if (-not (Test-Path $alertDir)) { New-Item -ItemType Directory -Path $alertDir -Force | Out-Null }

Add-Type -AssemblyName System.Windows.Forms

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
