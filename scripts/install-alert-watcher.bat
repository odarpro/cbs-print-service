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

:: Ruta del script de vigilancia (misma carpeta que este .bat)
set "WATCHER_PS1=%~dp0alert-watcher.ps1"

:: Archivo BAT que se ejecuta al inicio de sesión
set "BAT_FILE=%STARTUP%\CBSAlertWatcher.bat"

echo Instalando vigilante de alertas en Startup del usuario...

:: Crear BAT en Startup que lanza el vigilante de forma invisible
(
echo @echo off
echo :loop
echo powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%WATCHER_PS1%"
echo timeout /t 5 /nobreak ^>nul
echo goto loop
) > "%BAT_FILE%"

echo [OK] Vigilante instalado en: %BAT_FILE%
echo     Se ejecutara automaticamente al iniciar sesion.
echo.

endlocal
