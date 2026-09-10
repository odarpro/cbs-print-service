@echo off
:: =============================================================================
:: status.bat  -  CBS Print Service
:: Verifica el estado del servicio y el health check.
:: No requiere privilegios de administrador.
:: =============================================================================

setlocal
set SERVICE_KEY=cbsprintservice

title CBS Print Service - Estado

echo ============================================================
echo  CBS Print Service  -  Estado del Servicio
echo ============================================================
echo.

:: ── 1. Estado del servicio en SCM ─────────────────────────────────────────────
echo [SERVICIO WINDOWS]
sc query %SERVICE_KEY% | findstr /I "STATE ESTADO NOMBRE_SERVICIO SERVICE_NAME"
echo.

:: ── 2. Health check (si existe) ───────────────────────────────────────────────
echo [HEALTH CHECK]
if exist "C:\CBS\PrintService\healthcheck.json" (
    type "C:\CBS\PrintService\healthcheck.json"
) else (
    echo   No disponible (el servicio podria no estar instalado o iniciado).
)
echo.

:: ── 3. Archivos pendientes ────────────────────────────────────────────────────
echo [ARCHIVOS PENDIENTES]
if exist "C:\CBS\PrintService\config.json" (
    for /f "tokens=2 delims=:," %%i in ('findstr /I "watchFolder" "C:\CBS\PrintService\config.json"') do (
        set WATCH_DIR=%%i
        set WATCH_DIR=!WATCH_DIR:"=!
        set WATCH_DIR=!WATCH_DIR: =!
    )
    setlocal enabledelayedexpansion
    if exist "!WATCH_DIR!" (
        dir /B "!WATCH_DIR!\Rec*.txt" "!WATCH_DIR!\Val*.txt" 2>nul | findstr /R "." >nul
        if errorlevel 1 (
            echo   Ninguno.
        ) else (
            echo   Archivos encontrados:
            dir /B "!WATCH_DIR!\Rec*.txt" "!WATCH_DIR!\Val*.txt" 2>nul
        )
    ) else (
        echo   Carpeta watchFolder no existe: !WATCH_DIR!
    )
    endlocal
) else (
    echo   config.json no encontrado en C:\CBS\PrintService\
)
echo.

echo ============================================================
echo  Para mas detalles ejecute:
if exist "C:\CBS\PrintService\bin\node.exe" (
    echo    C:\CBS\PrintService\bin\node.exe C:\CBS\PrintService\scripts\diagnostico.js
) else (
    echo    node C:\CBS\PrintService\scripts\diagnostico.js
)
echo ============================================================
echo.

pause
