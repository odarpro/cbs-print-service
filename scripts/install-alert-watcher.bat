@echo off
:: =============================================================================
:: install-alert-watcher.bat  –  CBS Print Service
::
:: Registra el vigilante de alertas en la carpeta Startup del usuario actual.
:: Se ejecuta automáticamente durante la post-instalación.
:: =============================================================================

setlocal

:: Carpeta Startup del usuario
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

:: Ruta del script de vigilancia
set "WATCHER_SRC=%~dp0alert-watcher.ps1"
set "WATCHER_DST=%~dp0..\alert-watcher.ps1"

:: Crear acceso directo VBS para ejecutar PowerShell sin consola
set "VBS_FILE=%STARTUP%\CBSAlertWatcher.vbs"

echo Instalando vigilante de alertas en Startup del usuario...

:: Crear archivo VBS que lanza PowerShell oculto
(
echo Set objShell = CreateObject^("WScript.Shell"^)
echo objShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File ""%WATCHER_DST%""", 0, False
) > "%VBS_FILE%"

echo [OK] Vigilante instalado en: %VBS_FILE%
echo     Se ejecutara automaticamente al iniciar sesion.
echo.

endlocal
