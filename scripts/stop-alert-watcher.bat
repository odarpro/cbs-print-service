@echo off
:: Finaliza la tarea programada del vigilante de alertas.
setlocal

schtasks.exe /End /TN "\CBS Print Service\CBSAlertWatcher" >nul 2>&1
exit /b 0
