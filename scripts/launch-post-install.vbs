' =============================================================================
' launch-post-install.vbs  -  CBS Print Service
'
' Wrapper invisible para lanzar post-install.bat sin ventana de cmd.
' Se usa como respaldo en RunOnce tras la instalacion (setup.iss).
' El servicio queda registrado e iniciado en segundo plano, sin UI visible.
' =============================================================================

Dim fso, scriptDir, appDir, batPath, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.GetParentFolderName(scriptDir)
batPath = appDir & "\post-install.bat"
cmd = "cmd.exe /c """ & batPath & """"
CreateObject("WScript.Shell").Run cmd, 0, False
