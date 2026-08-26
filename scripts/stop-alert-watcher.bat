@echo off
:: Finaliza solo procesos Java que ejecutan el JAR de este servicio.
setlocal
set "WATCHER_JAR=%~dp0cbs-alert-watcher.jar"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$jar = $env:WATCHER_JAR; $watchers = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'java.exe' -or $_.Name -eq 'javaw.exe') -and $_.CommandLine -like ('*' + $jar + '*') }; foreach ($watcher in $watchers) { $result = Invoke-CimMethod -InputObject $watcher -MethodName Terminate; if ($result.ReturnValue -eq 0) { Write-Output ('Vigilante Java detenido. PID: ' + $watcher.ProcessId) } else { Write-Output ('No se pudo detener el vigilante Java. PID: ' + $watcher.ProcessId + ', código: ' + $result.ReturnValue) } }"
exit /b %ERRORLEVEL%
