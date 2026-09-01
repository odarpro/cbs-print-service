@echo on
:: =============================================================================
:: uninstall.bat  -  CBS Print Service
:: Desinstala el Servicio de Windows y elimina los archivos de la aplicacion.
:: REQUIERE ejecutar como Administrador.
:: =============================================================================

setlocal

:: Archivo de log del desinstalador
set UNINSTALL_LOG=%TEMP%\cbs_uninstall.log
if exist "%UNINSTALL_LOG%" del /q "%UNINSTALL_LOG%" >nul 2>&1
echo Desinstalador iniciado: %DATE% %TIME% > "%UNINSTALL_LOG%"

title CBS Print Service - Desinstalador

echo.
echo ============================================================
echo  CBS Print Service  -  Desinstalador
echo ============================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Requiere privilegios de Administrador.
    echo [ERROR] Requiere privilegios de Administrador. >> "%UNINSTALL_LOG%"
    pause
    exit /b 1
)

set INSTALL_DIR=C:\CBS\PrintService
set SERVICE_KEY=cbsprintservice.exe

echo Se eliminara el servicio y los archivos en:
echo   %INSTALL_DIR%
echo.
echo Instalacion dir: %INSTALL_DIR% >> "%UNINSTALL_LOG%"

:: Mostrar ambiente para depuracion
echo PATH: %PATH%
where node 2>nul || echo node no encontrado en PATH
node -v 2>nul || echo node -v no disponible en este contexto
echo.

set /p CONFIRM=Confirmar desinstalacion? (S/N): 
if /i "%CONFIRM%" neq "S" (
    echo Operacion cancelada.
    echo Operacion cancelada. >> "%UNINSTALL_LOG%"
    pause
    exit /b 0
)

echo.
:: ── 1) Intentar desinstalar mediante script node (si existe) ───────────────
echo [1/3] Intentando detener y desinstalar el servicio via node script...
if exist "%INSTALL_DIR%\scripts\uninstall-service.js" (
    cd /d "%INSTALL_DIR%"
    set SVC_UNINSTALL_LOG=%TEMP%\cbs_service_uninstall.log
    if exist "%SVC_UNINSTALL_LOG%" del /q "%SVC_UNINSTALL_LOG%" >nul 2>&1
    echo Ejecutando: node scripts\uninstall-service.js >> "%UNINSTALL_LOG%"
    if exist "%INSTALL_DIR%\bin\node.exe" (
        "%INSTALL_DIR%\bin\node.exe" scripts\uninstall-service.js > "%SVC_UNINSTALL_LOG%" 2>&1
    ) else (
        node scripts\uninstall-service.js > "%SVC_UNINSTALL_LOG%" 2>&1
    )
    if %errorLevel% neq 0 (
        echo [WARN] El script node devolvio error. Se aplicara fallback. >> "%UNINSTALL_LOG%"
        echo Contenido de %SVC_UNINSTALL_LOG%: >> "%UNINSTALL_LOG%"
        type "%SVC_UNINSTALL_LOG%" >> "%UNINSTALL_LOG%"
    ) else (
        echo Script de desinstalacion node ejecutado correctamente. >> "%UNINSTALL_LOG%"
        type "%SVC_UNINSTALL_LOG%"
    )
) else (
    echo Script uninstall-service.js no encontrado en %INSTALL_DIR%. >> "%UNINSTALL_LOG%"
)

:: ── 1b) Eliminar tarea programada del vigilante Java de alertas ────────────
echo [1b] Eliminando tarea programada del vigilante de alertas...
echo [%DATE% %TIME%] Eliminando watcher de alertas... >> "%UNINSTALL_LOG%"
if exist "%INSTALL_DIR%\scripts\stop-alert-watcher.bat" (
    call "%INSTALL_DIR%\scripts\stop-alert-watcher.bat" >> "%UNINSTALL_LOG%" 2>&1
)
schtasks.exe /End /TN "\CBS Print Service\CBSAlertWatcher" >> "%UNINSTALL_LOG%" 2>&1
schtasks.exe /Delete /TN "\CBS Print Service\CBSAlertWatcher" /F >> "%UNINSTALL_LOG%" 2>&1
if %errorLevel% neq 0 (
    echo [%DATE% %TIME%] [ERROR] No se pudo eliminar el watcher de alertas. >> "%UNINSTALL_LOG%"
) else (
    echo [%DATE% %TIME%] Watcher de alertas eliminado. >> "%UNINSTALL_LOG%"
)
:: También eliminar bat legacy de Startup si existe
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CBSAlertWatcher.bat" (
    del /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CBSAlertWatcher.bat" >> "%UNINSTALL_LOG%" 2>&1
    echo Bat legacy de Startup eliminado. >> "%UNINSTALL_LOG%"
)

:: ── 2) Fallback: detener y eliminar servicio usando PowerShell/sc ────────────
echo.
echo [2/3] Asegurando que el servicio esté detenido y eliminado (fallback)...
echo Deteniendo servicio (si existe) >> "%UNINSTALL_LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Try { Stop-Service -Name '%SERVICE_KEY%' -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; } Catch { }"
sc.exe delete "%SERVICE_KEY%" >> "%UNINSTALL_LOG%" 2>&1 || echo sc.exe delete devolvio error >> "%UNINSTALL_LOG%"

:: Comprobar si sigue existiendo
sc query "%SERVICE_KEY%" > "%TEMP%\cbs_svc_query.txt" 2>&1
if %errorlevel% equ 0 (
    echo [ERROR] El servicio %SERVICE_KEY% sigue existiendo. Revisa permisos/logs. >> "%UNINSTALL_LOG%"
    echo El servicio sigue existiendo. Revisa %UNINSTALL_LOG% para detalles.
) else (
    echo Servicio eliminado o no existente. >> "%UNINSTALL_LOG%"
    echo Servicio eliminado o no existente.
)

:: ── 3) Eliminar archivos de aplicacion (preservar Logs y config) ───────────
echo.
echo [3/3] Eliminando archivos de aplicacion (preservando Logs)...
echo (Los logs y configuracion seran preservados en %INSTALL_DIR%\Logs) >> "%UNINSTALL_LOG%"
if exist "%INSTALL_DIR%\src" (
    rmdir /S /Q "%INSTALL_DIR%\src" >> "%UNINSTALL_LOG%" 2>&1
)
if exist "%INSTALL_DIR%\scripts" (
    rmdir /S /Q "%INSTALL_DIR%\scripts" >> "%UNINSTALL_LOG%" 2>&1
)
if exist "%INSTALL_DIR%\node_modules" (
    rmdir /S /Q "%INSTALL_DIR%\node_modules" >> "%UNINSTALL_LOG%" 2>&1
)
if exist "%INSTALL_DIR%\package.json" del /Q "%INSTALL_DIR%\package.json" >> "%UNINSTALL_LOG%" 2>&1
if exist "%INSTALL_DIR%\package-lock.json" del /Q "%INSTALL_DIR%\package-lock.json" >> "%UNINSTALL_LOG%" 2>&1

echo.
echo ============================================================
echo  Desinstalacion completada. Revisa el log: %UNINSTALL_LOG%
echo ============================================================
echo.
type "%UNINSTALL_LOG%" | more
pause
