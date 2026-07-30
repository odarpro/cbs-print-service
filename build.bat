@echo off
setlocal enabledelayedexpansion

title CBS Print Service - Build

cd /d "%~dp0"

echo ============================================================
echo  CBS Print Service  v2.1.0  -  Build
echo ============================================================
echo.

net session >nul 2>&1
set "IS_ADMIN=%errorLevel%"

:: ?? 1. Node.js ?????????????????????????????????????????????????
echo [1/6] Verificando Node.js...
set "NODE_BIN="
for /f "delims=" %%p in ('where node 2^>nul') do set "NODE_BIN=%%p"
if not defined NODE_BIN (
    echo        Node.js no encontrado. Instalando...
    if not "%IS_ADMIN%"=="0" (
        echo [ERROR] Ejecute build.bat como Administrador.
        pause
        exit /b 1
    )
    echo        Descargando Node.js 22 LTS...
    curl -sL -o "%TEMP%\node-install.msi" "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    if errorlevel 1 (
        echo [ERROR] Fallo la descarga.
        pause
        exit /b 1
    )
    echo        Instalando...
    msiexec /i "%TEMP%\node-install.msi" /qn /norestart ADDLOCAL=ALL
    if errorlevel 1 (
        echo [ERROR] Fallo la instalacion.
        pause
        exit /b 1
    )
    set "PATH=C:\Program Files\nodejs;%PATH%"
    echo        Node.js instalado.  [OK]
) else (
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo        Node.js: %NODE_VER%  [OK]
)

:: ?? 2. Python ??????????????????????????????????????????????????
echo [2/6] Verificando Python...
where python >nul 2>&1
if errorlevel 1 (
    echo        Python no encontrado. Instalando...
    if not "%IS_ADMIN%"=="0" (
        echo [ERROR] Ejecute build.bat como Administrador.
        pause
        exit /b 1
    )
    echo        Descargando Python 3.12...
    curl -sL -o "%TEMP%\python-install.exe" "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe"
    if errorlevel 1 (
        echo [ERROR] Fallo la descarga.
        pause
        exit /b 1
    )
    "%TEMP%\python-install.exe" /quiet InstallAllUsers=1 PrependPath=1
    if errorlevel 1 (
        echo [ERROR] Fallo la instalacion.
        pause
        exit /b 1
    )
    set "PATH=C:\Program Files\Python312\;C:\Program Files\Python312\Scripts;%PATH%"
    echo        Python instalado.  [OK]
) else (
    for /f "tokens=*" %%v in ('python --version 2^>nul') do set "PY_VER=%%v"
    echo        Python: %PY_VER%  [OK]
)

:: 3. VS Build Tools
echo [3/6] Verificando VS Build Tools...
set "VS_FOUND="
where cl >nul 2>&1
if not errorlevel 1 set "VS_FOUND=1"
if not defined VS_FOUND (
    for /f "delims=" %%P in ('dir /S /B "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\cl.exe" 2^>nul') do set "VS_FOUND=1"
    for /f "delims=" %%P in ('dir /S /B "%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\cl.exe" 2^>nul') do set "VS_FOUND=1"
    for /f "delims=" %%P in ('dir /S /B "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\cl.exe" 2^>nul') do set "VS_FOUND=1"
    for /f "delims=" %%P in ('dir /S /B "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\cl.exe" 2^>nul') do set "VS_FOUND=1"
)
if defined VS_FOUND (
    echo        VS Build Tools  [OK]
) else (
    echo        VS Build Tools no encontrados.
    set /p "VS_CONFIRM=Descargar e instalar VS Build Tools (S/N): "
)
if /i "!VS_CONFIRM!"=="S" (
    if not "%IS_ADMIN%"=="0" (
        echo [ERROR] Ejecute build.bat como Administrador.
        pause
        exit /b 1
    )
    echo        Descargando...
    curl -sL -o "%TEMP%\vs_BuildTools.exe" "https://aka.ms/vs/17/release/vs_BuildTools.exe"
    if errorlevel 1 (
        echo [ERROR] Fallo la descarga.
        pause
        exit /b 1
    )
    "%TEMP%\vs_BuildTools.exe" --quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows10SDK.20348
    set "VS_INSTALL_ERR="
    if errorlevel 3010 set "VS_INSTALL_ERR=3010"
    if errorlevel 1 if not errorlevel 3010 set "VS_INSTALL_ERR=1"
    if "!VS_INSTALL_ERR!"=="3010" echo        VS Build Tools instalado, requiere reinicio.  [OK]
    if "!VS_INSTALL_ERR!"=="1" (
        echo [ERROR] Fallo la instalacion.
        pause
        exit /b 1
    )
    if not defined VS_INSTALL_ERR echo        VS Build Tools instalado.  [OK]
)
if /i "!VS_CONFIRM!"=="N" (
    echo        Omitiendo VS Build Tools.
    echo        Si npm install falla, instale VS Build Tools manualmente.
)

:: 4. Inno Setup
echo [4/6] Verificando Inno Setup...
set "ISCC_PATH="
for /f "delims=" %%p in ('where iscc 2^>nul') do set "ISCC_PATH=%%p"
if not defined ISCC_PATH call :find_iscc
if not defined ISCC_PATH (
    echo        Inno Setup no encontrado. Instalando...
    echo        Descargando...
    curl -sL -o "%TEMP%\innosetup.exe" "https://jrsoftware.org/download.php/is.exe"
    if errorlevel 1 (
        echo [ERROR] Fallo la descarga.
        pause
        exit /b 1
    )
    "%TEMP%\innosetup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
    if errorlevel 1 (
        echo [ERROR] Fallo la instalacion.
        pause
        exit /b 1
    )
    for /f "delims=" %%p in ('dir /S /B "!ProgramFiles(x86)!\iscc.exe" 2^>nul') do set "ISCC_PATH=%%p"
    if not defined ISCC_PATH set "ISCC_PATH=!ProgramFiles(x86)!\Inno Setup 6\iscc.exe"
    echo        Inno Setup instalado.  [OK]
) else (
    echo        Inno Setup: !ISCC_PATH!  [OK]
)
goto :end_find_iscc
:find_iscc
if exist "!ProgramFiles(x86)!\Inno Setup 6\iscc.exe" set "ISCC_PATH=!ProgramFiles(x86)!\Inno Setup 6\iscc.exe" & goto :eof
if exist "!ProgramFiles!\Inno Setup 6\iscc.exe" set "ISCC_PATH=!ProgramFiles!\Inno Setup 6\iscc.exe" & goto :eof
if exist "!LocalAppData!\Programs\Inno Setup 6\iscc.exe" set "ISCC_PATH=!LocalAppData!\Programs\Inno Setup 6\iscc.exe" & goto :eof
goto :eof
:end_find_iscc

:: 5. npm install
echo [5/6] Instalando dependencias npm...
call npm install --omit=dev
if errorlevel 1 (
    echo [WARN] npm fallo. Reintentando con --ignore-scripts...
    call npm install --ignore-scripts
    if errorlevel 1 (
        echo [ERROR] npm install fallo.
        pause
        exit /b 1
    )
    echo        Dependencias instaladas, sin modulo nativo.  [OK]
) else (
    echo        Dependencias instaladas.  [OK]
)

:: 6. Tests
echo [6/6] Ejecutando tests...
call npm test
if errorlevel 1 (
    echo [WARN] Algunos tests fallaron.
) else (
    echo        Tests OK.  [OK]
)

:: Compilar instalador
echo.
echo ============================================================
echo  Generando instalador Inno Setup...
echo ============================================================
if not exist "dist" mkdir dist >nul 2>&1
"%ISCC_PATH%" "setup.iss" /Q
if errorlevel 1 (
    echo [ERROR] Fallo la compilacion del instalador.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  BUILD COMPLETADO
echo ============================================================
echo.
dir /B dist\*.exe 2>nul
echo.
echo Instalador: dist\CBSPrintService_2.1.0_Setup.exe
echo.
echo Para distribuir, copie a las maquinas destino y ejecute:
echo   setup.exe /VERYSILENT
echo.
pause
