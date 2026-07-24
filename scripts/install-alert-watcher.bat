@echo off
:: =============================================================================
:: install-alert-watcher.bat  –  CBS Print Service
::
:: Registra el vigilante de alertas como tarea programada de Windows.
:: Se ejecuta automaticamente durante la post-instalacion.
:: =============================================================================

setlocal

echo Instalando vigilante de alertas via Task Scheduler...

:: Lanzar PowerShell para registrar la tarea programada
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-alert-watcher-scheduled.ps1"

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Fallo al instalar el vigilante de alertas.
    exit /b 1
)

echo.
echo El vigilante se ejecutara automaticamente al iniciar sesion.
echo.

endlocal
