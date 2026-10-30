@echo off
:: =============================================================================
:: uninstall.bat  -  CBS Print Service
:: Desinstala el servicio, las tareas, los registros y las carpetas de impresion.
:: REQUIERE ejecutar como Administrador.
:: =============================================================================

setlocal enabledelayedexpansion

set "INSTALL_DIR=C:\CBS\PrintService"
set "SERVICE_KEY=cbsprintservice"
set "UNINSTALL_LOG=%INSTALL_DIR%\uninstall.log"

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Requiere privilegios de Administrador.
    pause
    exit /b 1
)

title CBS Print Service - Desinstalador

echo.
echo ============================================================
echo  CBS Print Service  -  Desinstalador
echo ============================================================
echo.
echo Se eliminaran el servicio, las tareas, los registros de Event Log
echo y las carpetas de impresion configuradas en config.json.
echo.
echo Instalacion: %INSTALL_DIR%
echo.

set /p CONFIRM=Confirmar desinstalacion? (S/N):
if /i "%CONFIRM%" neq "S" (
    echo Operacion cancelada.
    exit /b 0
)

if exist "%INSTALL_DIR%\scripts\uninstall-cleanup.ps1" (
    echo Ejecutando limpieza completa...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_DIR%\scripts\uninstall-cleanup.ps1" -AppDir "%INSTALL_DIR%" -LogPath "%UNINSTALL_LOG%" -DeleteData
    if !errorLevel! neq 0 (
        echo [AVISO] La limpieza devolvio errores. Revise %UNINSTALL_LOG%.
    )
) else (
    echo [AVISO] No se encontro uninstall-cleanup.ps1. Aplicando limpieza basica...
    schtasks.exe /End /TN "\CBS Print Service\CBSAlertWatcher" >nul 2>&1
    schtasks.exe /Delete /TN "\CBS Print Service\CBSAlertWatcher" /F >nul 2>&1
    schtasks.exe /End /TN "\CBS Print Service\CBSBootGuard" >nul 2>&1
    schtasks.exe /Delete /TN "\CBS Print Service\CBSBootGuard" /F >nul 2>&1
    sc.exe stop "%SERVICE_KEY%" >nul 2>&1
    taskkill.exe /F /T /IM cbsprintservice.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
    sc.exe delete "%SERVICE_KEY%" >nul 2>&1
    reg.exe delete "HKLM\SYSTEM\CurrentControlSet\Services\EventLog\Application\cbsprintservice" /f >nul 2>&1
    reg.exe delete "HKLM\SYSTEM\CurrentControlSet\Services\EventLog\Application\cbsprintservice.exe" /f >nul 2>&1
    reg.exe delete "HKLM\SYSTEM\CurrentControlSet\Services\EventLog\Application\CBSPrintService Monitor" /f >nul 2>&1
    reg.exe delete "HKLM\SYSTEM\CurrentControlSet\Services\EventLog\Application\CBSPrintService wrapper" /f >nul 2>&1
    reg.exe delete "HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v CBSPrintService_PostInstall /f >nul 2>&1
    if exist "%ProgramData%\CBSPrintService" rmdir /S /Q "%ProgramData%\CBSPrintService" >nul 2>&1
    if exist "%INSTALL_DIR%\config.json" (
        for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "$c=Get-Content -Raw -LiteralPath '%INSTALL_DIR%\config.json' | ConvertFrom-Json; if($c.watchFolder){$c.watchFolder}"`) do (
            if exist "%%P" rmdir /S /Q "%%P" >nul 2>&1
        )
    )
)

echo.
echo Desinstalacion completada. Eliminando archivos de la aplicacion...
echo.

cd /d "%TEMP%"
> "%TEMP%\cbs_remove_app.cmd" (
    echo @echo off
    echo timeout /t 3 /nobreak ^>nul
    echo rmdir /S /Q "%INSTALL_DIR%"
    echo del /Q "%%~f0"
)
start "" /b cmd.exe /c ""%TEMP%\cbs_remove_app.cmd""
exit /b 0
