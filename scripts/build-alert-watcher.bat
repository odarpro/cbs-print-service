@echo off
setlocal

set "ROOT=%~dp0.."
set "SOURCE=%ROOT%\java\AlertWatcher.java"
set "OUTPUT=%~dp0cbs-alert-watcher.jar"
set "BUILD_DIR=%TEMP%\cbs-alert-watcher-build"

where javac.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Se requiere un JDK 17 o superior para compilar el vigilante Java.
    exit /b 1
)

where jar.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] No se encontro jar.exe. Instale un JDK 17 o superior.
    exit /b 1
)

if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%\classes" >nul 2>&1

javac.exe --release 17 -d "%BUILD_DIR%\classes" "%SOURCE%"
if errorlevel 1 exit /b 1

jar.exe --create --file "%OUTPUT%" --main-class AlertWatcher -C "%BUILD_DIR%\classes" .
set "RESULT=%errorlevel%"
rmdir /s /q "%BUILD_DIR%"
exit /b %RESULT%
