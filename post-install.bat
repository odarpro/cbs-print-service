@echo off
cd /d "%~dp0"
set SERVICE_KEY=cbsprintservice

REM Detectar qué Node.js usar (system PATH o bundled portable)
for /f "delims=" %%i in ('node scripts\find-node.cmd 2^>nul') do set NODE_EXE=%%i
if not defined NODE_EXE (
    for /f "delims=" %%i in ('scripts\find-node.cmd 2^>nul') do set NODE_EXE=%%i
)
if not defined NODE_EXE (
    echo [%DATE% %TIME%] ERROR: Node.js no encontrado >> install.log 2>&1
    exit /b 1
)

echo [%DATE% %TIME%] Usando Node.js: %NODE_EXE% >> install.log 2>&1
echo [%DATE% %TIME%] Iniciando post-instalacion >> install.log 2>&1

echo [%DATE% %TIME%] Aplicando configuracion de carpetas... >> install.log 2>&1
%NODE_EXE% scripts\apply-settings.js >> install.log 2>&1
if errorlevel 1 (
    echo [%DATE% %TIME%] ERROR: apply-settings.js fallo. Revise config.json. >> install.log 2>&1
    exit /b 1
)

echo [%DATE% %TIME%] Detectando impresora... >> install.log 2>&1
%NODE_EXE% scripts\populate-printers.js >> install.log 2>&1

echo [%DATE% %TIME%] Registrando servicio... >> install.log 2>&1
%NODE_EXE% scripts\install-service.js >> install.log 2>&1
if errorlevel 1 (
    echo [%DATE% %TIME%] AVISO: install-service.js fallo, reintentando net start... >> install.log 2>&1
    net start %SERVICE_KEY% >> install.log 2>&1
)

echo [%DATE% %TIME%] Verificando estado del servicio... >> install.log 2>&1
sc query %SERVICE_KEY% | findstr /I "RUNNING" >nul
if errorlevel 1 (
    echo [%DATE% %TIME%] AVISO: el servicio no quedo en estado RUNNING. >> install.log 2>&1
    echo [%DATE% %TIME%] Ejecute manualmente: net start %SERVICE_KEY% >> install.log 2>&1
) else (
    echo [%DATE% %TIME%] Servicio en RUNNING. >> install.log 2>&1
)

echo [%DATE% %TIME%] Instalando vigilante de alertas... >> install.log 2>&1
call scripts\install-alert-watcher.bat >> install.log 2>&1
if errorlevel 1 (
    echo [%DATE% %TIME%] AVISO: no se instalo el vigilante de alertas. >> install.log 2>&1
)

echo [%DATE% %TIME%] Instalacion completada >> install.log 2>&1
