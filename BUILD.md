# Build - CBS Print Service

## Requisitos (máquina de build)

El `build.bat` detecta e instala automáticamente lo que falte:

| Componente | Auto-instalación | Descarga |
|---|---|---|
| Node.js 22 LTS | ✅ Automática | ~50 MB |
| Python 3.12 | ✅ Automática | ~30 MB |
| VS 2022 Build Tools | ✅ Con confirmación | ~2 GB |
| Inno Setup 6+ | ✅ Automática | ~3 MB |

Solo necesitas **Windows 10/11 64 bits** y conexión a internet.

## Build del instalador

Ejecutar **como Administrador** desde la raíz del proyecto:

```powershell
build.bat
```

El script:
1. Instala Node.js si no existe
2. Instala Python si no existe
3. Pregunta si instalar VS Build Tools (necesario para módulo nativo)
4. Instala Inno Setup si no existe
5. Ejecuta `npm install`
6. Ejecuta `npm test`
7. Genera `dist\CBSPrintService_3.1.0_Setup.exe`

## Instalación silenciosa (SCCM / GPO)

```batch
CBSPrintService_3.1.0_Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\cbs_install.log"
```

## Despliegue masivo

### Opción 1: SCCM (ConfigMgr)
1. Crear Aplicación en SCCM
2. Tipo: Script de instalación de Windows
3. Comando de instalación:
   ```
CBSPrintService_3.1.0_Setup.exe /VERYSILENT /SUPPRESSMSGBOXES
   ```
4. Detección: `ProductCode {B8F4A3D2-1E5C-4A7B-9D6F-8C2E3F1A5B7D}`

### Opción 2: GPO (Group Policy)
1. Copiar el instalador a `\\domain\NETLOGON\CBS\`
2. Crear GPO → Configuración del equipo → Scripts de inicio
3. Agregar script:
   ```batch
   \\domain\NETLOGON\CBS\CBSPrintService_3.1.0_Setup.exe /VERYSILENT
   ```

### Opción 3: PDQ / Lanzadores
```batch
CBSPrintService_3.1.0_Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="%TEMP%\cbs_install.log"
```

## Notas

- El instalador incluye `node_modules` pre-compilados. Se debe ejecutar `build.bat` solo en la máquina de build.
- `config.json` se crea con valores por defecto si no existe en el destino.
- Las rutas de carpetas se configuran durante la instalación (o se editan en `config.json` después).
- Si no instalas VS Build Tools, el módulo nativo `@tbalegas/node-printer` no se compilará. El instalador funcionará pero la impresión fallará hasta que se compile en cada máquina destino con `npm install`.
