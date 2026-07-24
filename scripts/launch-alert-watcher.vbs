' =============================================================================
' launch-alert-watcher.vbs  –  CBS Print Service
'
' Wrapper invisible para lanzar alert-watcher.ps1 sin ventana de PowerShell.
' Se usa como accion de la tarea programada CBSAlertWatcher.
' =============================================================================

Dim scriptDir, ps1Path, cmd
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ps1Path = scriptDir & "\alert-watcher.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """"
CreateObject("WScript.Shell").Run cmd, 0, False
