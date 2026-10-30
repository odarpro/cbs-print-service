param(
  [string]$AppDir = '',
  [string]$LogPath = '',
  [switch]$DeleteData,
  [switch]$DryRun
)

if (-not $AppDir) {
  $AppDir = Split-Path -Parent $PSScriptRoot
}
if (-not $LogPath) {
  $LogPath = Join-Path $env:TEMP 'cbs_uninstall.log'
}

$ServiceName = 'cbsprintservice'
$TaskNames = @(
  '\CBS Print Service\CBSAlertWatcher',
  '\CBS Print Service\CBSBootGuard'
)
$EventLogSources = @(
  'cbsprintservice',
  'cbsprintservice.exe',
  'CBSPrintService Monitor',
  'CBSPrintService wrapper'
)
$script:HadError = $false

function Write-Log {
  param([string]$Message)
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  try {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 -ErrorAction Stop
  } catch {
  }
  Write-Host $line
}

function Invoke-Tool {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  Write-Log ('Ejecutando: {0} {1}' -f $FilePath, ($Arguments -join ' '))
  if ($DryRun) {
    return [pscustomobject]@{ Code = 0; Output = '(dry-run)' }
  }
  try {
    $output = (& $FilePath @Arguments 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    if ($output) {
      Write-Log $output
    }
    return [pscustomobject]@{ Code = $code; Output = $output }
  } catch {
    Write-Log ('ERROR ejecutando {0}: {1}' -f $FilePath, $_.Exception.Message)
    return [pscustomobject]@{ Code = 1; Output = $_.Exception.Message }
  }
}

function Wait-ServiceState {
  param(
    [string]$Name,
    [ValidateSet('Stopped', 'Missing')]
    [string]$State,
    [int]$TimeoutSeconds = 30
  )
  if ($DryRun) {
    return $true
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($State -eq 'Missing' -and -not $service) {
      return $true
    }
    if ($State -eq 'Stopped' -and (-not $service -or $service.Status -eq 'Stopped')) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Remove-Tree {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return
  }
  Write-Log ('Eliminando: {0}' -f $Path)
  if ($DryRun) {
    return
  }
  try {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    Write-Log ('Eliminado: {0}' -f $Path)
  } catch {
    $script:HadError = $true
    Write-Log ('ERROR eliminando {0}: {1}' -f $Path, $_.Exception.Message)
  }
}

function Test-SafeDataPath {
  param([string]$Path)
  try {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  } catch {
    return $false
  }

  $root = [IO.Path]::GetPathRoot($full)
  if (-not $root -or $full -eq $root.TrimEnd('\')) {
    return $false
  }

  $systemRoots = @(
    $env:SystemRoot,
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:ProgramData
  ) | Where-Object { $_ }
  foreach ($item in $systemRoots) {
    $protected = [IO.Path]::GetFullPath($item).TrimEnd('\')
    if ($full -eq $protected -or $full.StartsWith($protected + '\', [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }

  $userRoots = @(
    $env:USERPROFILE,
    $env:LOCALAPPDATA,
    $env:APPDATA,
    $env:PUBLIC
  ) | Where-Object { $_ }
  foreach ($item in $userRoots) {
    $protected = [IO.Path]::GetFullPath($item).TrimEnd('\')
    if ($full -eq $protected) {
      return $false
    }
    if ($protected.StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }

  $app = [IO.Path]::GetFullPath($AppDir).TrimEnd('\')
  if ($full -eq $app -or $app.StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }

  return $true
}

function Get-ConfiguredDataPaths {
  param([string]$ConfigPath)
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Log ('No se encontro config.json en {0}; no se eliminaran datos.' -f $ConfigPath)
    return @()
  }

  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
  } catch {
    Write-Log ('No se pudo leer config.json: {0}' -f $_.Exception.Message)
    return @()
  }

  $paths = @()
  foreach ($key in @('watchFolder', 'historyFolder', 'errorFolder', 'logFolder', 'alertFolder')) {
    $value = $config.$key
    if ($value -is [string] -and $value.Trim()) {
      $paths += $value.Trim()
    }
  }

  if ($config.logFolder -is [string] -and $config.logFolder.Trim()) {
    $logParent = Split-Path -Parent $config.logFolder.Trim()
    if ($logParent) {
      $paths += [IO.Path]::Combine($logParent, 'Alertas')
    }
  }

  return $paths
}

function Remove-ConfiguredData {
  $paths = @(Get-ConfiguredDataPaths -ConfigPath (Join-Path $AppDir 'config.json'))
  $safePaths = @()

  foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) {
      Write-Log ('La ruta configurada no existe: {0}' -f $path)
      continue
    }
    try {
      $resolved = (Resolve-Path -LiteralPath $path -ErrorAction Stop).Path.TrimEnd('\')
    } catch {
      $resolved = [IO.Path]::GetFullPath($path).TrimEnd('\')
    }
    if (-not (Test-SafeDataPath -Path $resolved)) {
      Write-Log ('Ruta protegida, se conserva: {0}' -f $resolved)
      continue
    }
    if ($safePaths -notcontains $resolved) {
      $safePaths += $resolved
    }
  }

  $topLevel = @()
  foreach ($path in $safePaths) {
    $nested = $false
    foreach ($other in $safePaths) {
      if ($path -ne $other -and $path.StartsWith($other + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $nested = $true
        break
      }
    }
    if (-not $nested) {
      $topLevel += $path
    }
  }

  foreach ($path in $topLevel) {
    Remove-Tree -Path $path
  }
}

Write-Log 'Iniciando limpieza de CBS Print Service.'
Write-Log ('Directorio de instalacion: {0}' -f $AppDir)

foreach ($taskName in $TaskNames) {
  Invoke-Tool 'schtasks.exe' @('/End', '/TN', $taskName) | Out-Null
  Invoke-Tool 'schtasks.exe' @('/Delete', '/TN', $taskName, '/F') | Out-Null
}

if (-not $DryRun) {
  try {
    $schedule = New-Object -ComObject Schedule.Service
    $schedule.Connect()
    $rootFolder = $schedule.GetFolder('\')
    try {
      $rootFolder.GetFolder('CBS Print Service') | Out-Null
      $rootFolder.DeleteFolder('CBS Print Service', 0)
      Write-Log 'Carpeta de tareas de CBS eliminada.'
    } catch {
      Write-Log 'La carpeta de tareas de CBS no existe o no se pudo eliminar.'
    }
  } catch {
    Write-Log ('No se pudo acceder al Programador de tareas: {0}' -f $_.Exception.Message)
  }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  Invoke-Tool 'sc.exe' @('stop', $ServiceName) | Out-Null
  if (-not (Wait-ServiceState -Name $ServiceName -State 'Stopped' -TimeoutSeconds 30)) {
    Write-Log 'AVISO: el servicio no se detuvo en 30 segundos.'
  }
}

Invoke-Tool 'taskkill.exe' @('/F', '/T', '/IM', 'cbsprintservice.exe') | Out-Null
Start-Sleep -Seconds 2

$appNode = Join-Path $AppDir 'bin\node.exe'
Get-Process -Name 'node' -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    if ($_.Path -and $_.Path.Equals($appNode, [StringComparison]::OrdinalIgnoreCase)) {
      Write-Log ('Terminando proceso node del servicio: PID {0}' -f $_.Id)
      if (-not $DryRun) {
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
      }
    }
  } catch {
    Write-Log ('No se pudo terminar proceso node PID {0}: {1}' -f $_.Id, $_.Exception.Message)
  }
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Invoke-Tool 'sc.exe' @('delete', $ServiceName) | Out-Null
  if (-not (Wait-ServiceState -Name $ServiceName -State 'Missing' -TimeoutSeconds 30)) {
    $script:HadError = $true
    Write-Log 'ERROR: el servicio sigue registrado en el SCM.'
  }
}

foreach ($source in $EventLogSources) {
  $key = 'HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application\' + $source
  if (Test-Path -LiteralPath $key) {
    Write-Log ('Eliminando origen de Event Log: {0}' -f $source)
    if (-not $DryRun) {
      try {
        Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop
      } catch {
        Write-Log ('ERROR eliminando Event Log {0}: {1}' -f $source, $_.Exception.Message)
      }
    }
  }
}

$runOnce = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
if (Test-Path -LiteralPath $runOnce) {
  Write-Log 'Eliminando valor RunOnce CBSPrintService_PostInstall.'
  if (-not $DryRun) {
    Remove-ItemProperty -LiteralPath $runOnce -Name 'CBSPrintService_PostInstall' -ErrorAction SilentlyContinue
  }
}

Remove-Tree -Path (Join-Path $env:ProgramData 'CBSPrintService')

if ($DeleteData) {
  Remove-ConfiguredData
} else {
  Write-Log 'La opcion DeleteData no esta activa; se conservan las carpetas de impresion.'
}

$tempItems = @(
  (Join-Path $env:TEMP 'cbs_install.log'),
  (Join-Path $env:TEMP 'cbs_uninstall.log'),
  (Join-Path $env:TEMP 'cbs_service_uninstall.log'),
  (Join-Path $env:TEMP 'cbs_svc_query.txt'),
  (Join-Path $env:TEMP 'cbs_create_dirs.ps1'),
  (Join-Path $env:TEMP 'cbs_npm_install.log'),
  (Join-Path $env:TEMP 'cbs_service_install.log')
)
foreach ($item in $tempItems) {
  if (Test-Path -LiteralPath $item) {
    Write-Log ('Eliminando archivo temporal: {0}' -f $item)
    if (-not $DryRun) {
      Remove-Item -LiteralPath $item -Force -ErrorAction SilentlyContinue
    }
  }
}
Remove-Tree -Path (Join-Path $env:TEMP 'cbs-alert-watcher-build')

if ($DryRun) {
  Write-Log 'DryRun completado.'
} elseif ($script:HadError) {
  Write-Log 'Limpieza completada con errores.'
  exit 1
} else {
  Write-Log 'Limpieza completada.'
  exit 0
}
