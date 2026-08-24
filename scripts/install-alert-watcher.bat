@echo off
:: =============================================================================
:: install-alert-watcher.bat  –  CBS Print Service
::
:: Registra el vigilante Java de alertas como tarea programada de Windows.
:: Se ejecuta automaticamente durante la post-instalacion.
:: =============================================================================

setlocal

set "WATCHER_JAR=%~dp0cbs-alert-watcher.jar"
set "JAVA_EXE="

:: Elimina la implementación PowerShell anterior antes de registrar Java.
wmic process where "name='powershell.exe' and commandline like '%%alert-watcher.ps1%%'" call terminate >nul 2>&1
del /q "%~dp0alert-watcher.ps1" "%~dp0install-alert-watcher-scheduled.ps1" "%~dp0launch-alert-watcher.vbs" "%~dp0show-alert.ps1" >nul 2>&1

if not exist "%WATCHER_JAR%" (
    call "%~dp0build-alert-watcher.bat"
    if errorlevel 1 exit /b 1
)

if defined JAVA_HOME if exist "%JAVA_HOME%\bin\javaw.exe" set "JAVA_EXE=%JAVA_HOME%\bin\javaw.exe"
if not defined JAVA_EXE for /f "delims=" %%I in ('where javaw.exe 2^>nul') do if not defined JAVA_EXE set "JAVA_EXE=%%I"

if not defined JAVA_EXE (
    echo [ERROR] Java 17 o superior no esta disponible. Instale Java y configure PATH o JAVA_HOME.
    exit /b 1
)

echo Instalando vigilante Java de alertas via Task Scheduler...

schtasks.exe /Create /TN "\CBS Print Service\CBSAlertWatcher" /TR "\"%JAVA_EXE%\" -jar \"%WATCHER_JAR%\" \"%~dp0..\"" /SC ONLOGON /RU "%USERNAME%" /RL LIMITED /F

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Fallo al instalar el vigilante de alertas.
    exit /b 1
)

schtasks.exe /Run /TN "\CBS Print Service\CBSAlertWatcher" >nul 2>&1

echo.
echo El vigilante se ejecutara automaticamente al iniciar sesion.
echo.

endlocal
