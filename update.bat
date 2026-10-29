@echo off
:: =============================================================================
:: update.bat  -  CBS Print Service
:: Actualiza el codigo y REINSTALA el servicio para regenerar el XML de WinSW.
:: La configuracion existente (config.json) NO se modifica.
:: REQUIERE ejecutar como Administrador.
:: =============================================================================

setlocal

title CBS Print Service - Actualizador

echo.
echo ============================================================
echo  CBS Print Service  -  Actualizacion
echo ============================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Requiere privilegios de Administrador.
    pause
    exit /b 1
)

set INSTALL_DIR=C:\CBS\PrintService
set SERVICE_KEY=cbsprintservice
set BOOT_GUARD_TASK=\CBS Print Service\CBSBootGuard
set SOURCE_DIR=%~dp0

if not exist "%INSTALL_DIR%" (
    echo [ERROR] No existe %INSTALL_DIR%. Use install.bat para una instalacion nueva.
    pause
    exit /b 1
)

set NODE_EXE=node
if exist "%INSTALL_DIR%\bin\node.exe" set NODE_EXE=%INSTALL_DIR%\bin\node.exe

echo [1/7] Actualizando archivos (config.json NO sera modificado)...
xcopy /E /I /Y "%SOURCE_DIR%src"     "%INSTALL_DIR%\src\"     >nul
xcopy /E /I /Y "%SOURCE_DIR%scripts" "%INSTALL_DIR%\scripts\" >nul
xcopy /E /I /Y "%SOURCE_DIR%java"    "%INSTALL_DIR%\java\"    >nul
copy /Y "%SOURCE_DIR%package.json"      "%INSTALL_DIR%\" >nul
if exist "%SOURCE_DIR%package-lock.json" copy /Y "%SOURCE_DIR%package-lock.json" "%INSTALL_DIR%\" >nul
echo        Archivos actualizados.  [OK]

echo [2/7] Actualizando archivos bin (Node.js portable)...
if exist "%SOURCE_DIR%bin" (
    xcopy /E /I /Y "%SOURCE_DIR%bin" "%INSTALL_DIR%\bin\" >nul
    set NODE_EXE=%INSTALL_DIR%\bin\node.exe
    echo        Node.js portable actualizado.  [OK]
)

echo [3/7] Actualizando dependencias npm...
cd /d "%INSTALL_DIR%"
where npm >nul 2>&1
if %errorLevel% equ 0 (
    call npm install --omit=dev > "%TEMP%\cbs_update_npm.log" 2>&1
    if errorlevel 1 (
        echo [ERROR] Fallo la instalacion de dependencias npm.
        type "%TEMP%\cbs_update_npm.log"
        pause
        exit /b 1
    )
    echo        Dependencias actualizadas.  [OK]
) else (
    echo        npm no disponible. Las dependencias deben estar pre-instaladas.
)

echo [4/7] Desinstalando servicio anterior (tambien elimina boot-guard)...
"%NODE_EXE%" scripts\uninstall-service.js
if %errorLevel% neq 0 (
    echo [WARN] El desinstalador devolvio error. Se intentara reinstalar de todos modos.
)

echo        Limpiando trabajos CBS antiguos de la cola...
"%NODE_EXE%" scripts\limpiar-cola.js --delete-cbs --delete-legacy > "%TEMP%\cbs_update_queue.log" 2>&1
if %errorLevel% neq 0 (
    echo [WARN] No se pudo limpiar la cola. Revise %TEMP%\cbs_update_queue.log
) else (
    echo        Cola de trabajos CBS limpia.  [OK]
)

echo [5/7] Reinstalando servicio con la configuracion nueva...
"%NODE_EXE%" scripts\install-service.js
if %errorLevel% neq 0 (
    echo [ERROR] No se pudo reinstalar el servicio.
    echo         Revise los mensajes anteriores y ejecute install-service.js como Administrador.
    pause
    exit /b 1
)

echo [6/7] Instalando vigilante Java de alertas...
call scripts\install-alert-watcher.bat > "%TEMP%\cbs_alert_watcher_update.log" 2>&1
if %errorLevel% neq 0 (
    echo [WARN] No se pudo instalar el vigilante Java. Revise %TEMP%\cbs_alert_watcher_update.log
) else (
    echo        Vigilante Java instalado.  [OK]
)

echo [7/7] Verificando servicio y tarea de arranque...
sc query %SERVICE_KEY% | findstr /I "RUNNING" >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARN] El servicio no figura RUNNING. Intentando iniciar...
    sc start %SERVICE_KEY% >nul 2>&1
    timeout /t 5 /nobreak >nul
)

schtasks /Query /TN "%BOOT_GUARD_TASK%" >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARN] La tarea de arranque no esta registrada.
    "%NODE_EXE%" scripts\install-boot-guard.js
) else (
    echo        Tarea de arranque registrada.  [OK]
)

sc query %SERVICE_KEY% | findstr /I "RUNNING" >nul 2>&1
if %errorLevel% equ 0 (
    echo        Servicio RUNNING.  [OK]
) else (
    echo [WARN] El servicio no quedo RUNNING. Revise:
    echo        C:\ProgramData\CBSPrintService\startup.log
    echo        %INSTALL_DIR%\logs
)

echo.
echo ============================================================
echo  Actualizacion completada.
echo ============================================================
echo.
pause
