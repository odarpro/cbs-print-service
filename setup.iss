; =============================================================================
; setup.iss  –  CBS Print Service
; Script para Inno Setup 6+
;
; Genera un instalador profesional para distribución empresarial.
;
; Requisitos:
;   1. Tener Inno Setup 6+ instalado (https://jrsoftware.org/isdl.php)
;   2. Ejecutar desde la raíz del proyecto:
;        iscc setup.iss
;
; Para instalación silenciosa (SCCM / GPO):
;   setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\cbs_install.log"
; =============================================================================

#define MyAppName      "CBS Print Service"
#define MyAppVersion   "1.7.0"
#define MyAppPublisher  "CBS"
#define MyAppURL       ""
#define MyExeName      "CBSPrintService.exe"

[Setup]
AppId                   = {{B8F4A3D2-1E5C-4A7B-9D6F-8C2E3F1A5B7D}
AppName                 = {#MyAppName}
AppVersion              = {#MyAppVersion}
AppPublisher            = {#MyAppPublisher}
DefaultDirName          = C:\CBS\PrintService
DefaultGroupName        = CBS Print Service
DisableProgramGroupPage = yes
OutputDir               = .\dist
OutputBaseFilename      = CBSPrintService_{#MyAppVersion}_Setup
Compression             = lzma2/max
SolidCompression        = yes
UninstallDisplayIcon   = {app}\src\icon.ico
PrivilegesRequired      = admin
PrivilegesRequiredOverridesAllowed = commandline
ArchitecturesInstallIn64BitMode    = x64compatible
MinVersion              = 10.0.10240
DisableWelcomePage      = no
DisableReadyPage        = no
CloseApplications       = no
RestartApplications     = no

[Messages]
WelcomeLabel2 = Este instalador lo guiará en la instalaci%C3%B3n de CBS Print Service.%n%nSe requiere Node.js 18+ instalado en el equipo.%n%nEl servicio se registrar%C3%A1 con inicio autom%C3%A1tico y se iniciar%C3%A1 al finalizar.

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; Código fuente
Source: "src\*";                       DestDir: "{app}\src";          Flags: ignoreversion recursesubdirs createallsubdirs

; Node.js portable
Source: "bin\*";                       DestDir: "{app}\bin";          Flags: ignoreversion recursesubdirs createallsubdirs

; Scripts
Source: "scripts\*";                   DestDir: "{app}\scripts";      Flags: ignoreversion recursesubdirs createallsubdirs

; Tests
Source: "tests\*";                     DestDir: "{app}\tests";        Flags: ignoreversion recursesubdirs createallsubdirs

; Configuración
Source: "config.json";                 DestDir: "{app}";              Flags: ignoreversion onlyifdoesntexist
Source: "config.example.json";         DestDir: "{app}";              Flags: ignoreversion

; Dependencias (pre-instaladas en máquina de build)
Source: "node_modules\*";              DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Paquete
Source: "package.json";                DestDir: "{app}";              Flags: ignoreversion
Source: "package-lock.json";           DestDir: "{app}";              Flags: ignoreversion

; Scripts batch
Source: "install.bat";                 DestDir: "{app}";              Flags: ignoreversion
Source: "uninstall.bat";               DestDir: "{app}";              Flags: ignoreversion
Source: "update.bat";                  DestDir: "{app}";              Flags: ignoreversion
Source: "status.bat";                  DestDir: "{app}";              Flags: ignoreversion
Source: "post-install.bat";            DestDir: "{app}";              Flags: ignoreversion

; README
Source: "README.md";                   DestDir: "{app}";              Flags: ignoreversion

[Dirs]
Name: "{code:GetWatchFolder}\Logs";     Permissions: users-modify
Name: "{code:GetWatchFolder}";         Permissions: users-modify
Name: "{code:GetHistoryFolder}";       Permissions: users-modify
Name: "{code:GetErrorFolder}";         Permissions: users-modify

; [Run] — Eliminado intencionalmente.
; La post-instalación se ejecuta desde CurStepChanged(ssPostInstall)
; mediante ShellExec (más confiable que Exec para lanzar procesos).

[UninstallRun]
; Log inicio
Filename: "cmd.exe"; Parameters: "/C echo [%DATE% %TIME%] Iniciando desinstalacion >> ""{app}\uninstall.log"""; \
  Flags: runhidden; RunOnceId: "UninstallLogStart"

; Detener servicio
Filename: "cmd.exe"; Parameters: "/C echo [%DATE% %TIME%] Deteniendo servicio... >> ""{app}\uninstall.log"" & sc stop CBSPrintService >> ""{app}\uninstall.log"" 2>&1"; \
  Flags: runhidden; RunOnceId: "UninstallStop"

; Eliminar servicio
Filename: "cmd.exe"; Parameters: "/C echo [%DATE% %TIME%] Eliminando servicio... >> ""{app}\uninstall.log"" & sc delete CBSPrintService >> ""{app}\uninstall.log"" 2>&1"; \
  Flags: runhidden; RunOnceId: "UninstallDelete"

; Log fin
Filename: "cmd.exe"; Parameters: "/C echo [%DATE% %TIME%] Servicio eliminado. >> ""{app}\uninstall.log"""; \
  Flags: runhidden; RunOnceId: "UninstallLogEnd"

[Registry]
; Respaldo: ejecutar post-instalación en el próximo inicio de sesión
; en caso de que ShellExec en CurStepChanged falle silenciosamente.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\RunOnce"; \
  ValueType: String; ValueName: "CBSPrintService_PostInstall"; \
  ValueData: """{app}\post-install.bat"""; \
  Flags: createvalueifdoesntexist deletevalue

[Icons]
Name: "{group}\Iniciar Servicio";     Filename: "net";    Parameters: "start CBSPrintService"; Flags: runminimized
Name: "{group}\Detener Servicio";     Filename: "net";    Parameters: "stop CBSPrintService";  Flags: runminimized
Name: "{group}\Estado del Servicio";  Filename: "{app}\status.bat";                            Flags: runminimized
Name: "{group}\Diagnóstico";          Filename: "cmd.exe"; \
  Parameters: "/K node ""{app}\scripts\diagnostico.js""";                                       Flags: runminimized
Name: "{group}\Configuración (editar)"; Filename: "notepad.exe"; Parameters: "{app}\config.json"
Name: "{group}\Carpeta de Logs";      Filename: "{code:GetWatchFolder}\Logs"
Name: "{group}\Desinstalar";          Filename: "{uninstallexe}"

[Code]

var
  ConfigPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(
    wpSelectDir,
    'Configuración inicial',
    'Rutas de carpetas de impresión',
    'Puede modificarlas luego editando config.json en el directorio de instalación.'
  );

  ConfigPage.Add('Carpeta de impresión (watchFolder):', False);
  ConfigPage.Add('Carpeta de históricos (historyFolder):', False);
  ConfigPage.Add('Carpeta de errores (errorFolder):', False);

  ConfigPage.Values[0] := 'D:\Impresiones';
  ConfigPage.Values[1] := 'D:\Impresiones\Historico';
  ConfigPage.Values[2] := 'D:\Impresiones\Errores';
end;

function GetWatchFolder(Param: string): string;
begin
  if ConfigPage <> nil then
    Result := ConfigPage.Values[0]
  else
    Result := 'D:\Impresiones';
end;

function GetHistoryFolder(Param: string): string;
begin
  if ConfigPage <> nil then
    Result := ConfigPage.Values[1]
  else
    Result := 'D:\Impresiones\Historico';
end;

function GetErrorFolder(Param: string): string;
begin
  if ConfigPage <> nil then
    Result := ConfigPage.Values[2]
  else
    Result := 'D:\Impresiones\Errores';
end;

function JsonStr(const S: string): string;
var
  I: Integer;
begin
  Result := S;
  I := Pos('\', Result);
  while I > 0 do
  begin
    Delete(Result, I, 1);
    Insert('\\', Result, I);
    I := Pos('\', Result);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigContent: TArrayOfString;
begin
  if CurStep = ssInstall then
  begin
    ForceDirectories(ExpandConstant('{app}'));

    // Guardar preferencias del usuario para que post-install.bat las use
    SetArrayLength(ConfigContent, 3);
    ConfigContent[0] := ConfigPage.Values[0];
    ConfigContent[1] := ConfigPage.Values[1];
    ConfigContent[2] := ConfigPage.Values[2];
    SaveStringsToFile(ExpandConstant('{app}\.install-settings.txt'), ConfigContent, False);
  end;
end;

procedure DeInitializeSetup();
var
  ResultCode: Integer;
  BatchPath: string;
begin
  // Ejecutar post-instalación DESPUÉS de que el usuario hace clic en Finalizar
  // El instalador ya está cerrándose, no hay ventana que congelar
  BatchPath := ExpandConstant('{app}\post-install.bat');
  if FileExists(BatchPath) then
    Exec(BatchPath, '', '', SW_SHOW, ewNoWait, ResultCode);
end;
