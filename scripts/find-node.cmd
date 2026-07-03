@echo off
setlocal enabledelayedexpansion

REM Try system Node.js first
for /f "delims=" %%i in ('node --version 2^>nul') do set NODE_VER=%%i
if defined NODE_VER (
    echo node
    exit /b 0
)

REM Fallback: bundled portable node.exe
if exist "%~dp0..\bin\node.exe" (
    echo "%~dp0..\bin\node.exe"
    exit /b 0
)

echo ERROR: Node.js no encontrado. Instale Node.js 18+ o asegurese de que bin\node.exe exista.
exit /b 1
