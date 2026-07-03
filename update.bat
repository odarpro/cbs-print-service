@echo off
:: =============================================================================
:: update.bat  -  CBS Print Service
:: Actualiza el codigo del servicio preservando la configuracion existente.
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
set SOURCE_DIR=%~dp0

echo [1/5] Deteniendo servicio...
sc stop CBSPrintService >nul 2>&1
timeout /t 3 /nobreak >nul

echo [2/5] Actualizando archivos (config.json NO sera modificado)...
xcopy /E /I /Y "%SOURCE_DIR%src"     "%INSTALL_DIR%\src\"     >nul
xcopy /E /I /Y "%SOURCE_DIR%scripts" "%INSTALL_DIR%\scripts\" >nul
copy /Y "%SOURCE_DIR%package.json"   "%INSTALL_DIR%\"         >nul
echo        Archivos actualizados.  [OK]

echo [3/5] Actualizando archivos bin (Node.js portable)...
if exist "%~dp0bin" (
    xcopy /E /I /Y "%~dp0bin" "%INSTALL_DIR%\bin\" >nul
    echo        Node.js portable actualizado.  [OK]
)

echo [4/5] Actualizando dependencias npm...
cd /d "%INSTALL_DIR%"
where npm >nul 2>&1
if %errorLevel% equ 0 (
    call npm install --omit=dev > "%TEMP%\cbs_update_npm.log" 2>&1
    if %errorLevel% neq 0 (
        echo [ERROR] Fallo la instalacion de dependencias npm.
        type "%TEMP%\cbs_update_npm.log"
        pause
        exit /b 1
    )
    echo        Dependencias actualizadas.  [OK]
) else (
    echo        npm no disponible. Las dependencias deben estar pre-instaladas.
)

echo [5/5] Reiniciando servicio...
sc start CBSPrintService >nul 2>&1
if %errorLevel% equ 0 (
    echo        Servicio reiniciado.  [OK]
) else (
    echo [WARN] No se pudo reiniciar automaticamente.
    echo        Inicie el servicio manualmente desde Servicios de Windows.
)

echo.
echo ============================================================
echo  Actualizacion completada.
echo ============================================================
echo.
pause
