# Build - CBS Print Service

## Requisitos (mÃ¡quina de build)

El `build.bat` detecta e instala automÃ¡ticamente lo que falte:

| Componente | Auto-instalaciÃ³n | Descarga |
|---|---|---|
| Node.js 22 LTS | âœ… AutomÃ¡tica | ~50 MB |
| Python 3.12 | âœ… AutomÃ¡tica | ~30 MB |
| VS 2022 Build Tools | âœ… Con confirmaciÃ³n | ~2 GB |
| Inno Setup 6+ | âœ… AutomÃ¡tica | ~3 MB |
| JDK 17+ | âŒ Manual | Compila el vigilante de alertas Java |

Solo necesitas **Windows 10/11 64 bits** y conexiÃ³n a internet.

## Build del instalador

Ejecutar **como Administrador** desde la raÃ­z del proyecto:

```powershell
build.bat
```

El script:
1. Instala Node.js si no existe
2. Instala Python si no existe
3. Pregunta si instalar VS Build Tools (necesario para mÃ³dulo nativo)
4. Instala Inno Setup si no existe
5. Ejecuta `npm install`
6. Compila el vigilante Java con JDK 17+
7. Ejecuta `npm test`
8. Genera `dist\CBSPrintService_3.2.7_Setup.exe`

## InstalaciÃ³n silenciosa (SCCM / GPO)

```batch
CBSPrintService_3.2.7_Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\cbs_install.log"
```

## Despliegue masivo

### OpciÃ³n 1: SCCM (ConfigMgr)
1. Crear AplicaciÃ³n en SCCM
2. Tipo: Script de instalaciÃ³n de Windows
3. Comando de instalaciÃ³n:
   ```
CBSPrintService_3.2.7_Setup.exe /VERYSILENT /SUPPRESSMSGBOXES
   ```
4. DetecciÃ³n: `ProductCode {B8F4A3D2-1E5C-4A7B-9D6F-8C2E3F1A5B7D}`

### OpciÃ³n 2: GPO (Group Policy)
1. Copiar el instalador a `\\domain\NETLOGON\CBS\`
2. Crear GPO â†’ ConfiguraciÃ³n del equipo â†’ Scripts de inicio
3. Agregar script:
   ```batch
\\domain\NETLOGON\CBS\CBSPrintService_3.2.7_Setup.exe /VERYSILENT
   ```

### OpciÃ³n 3: PDQ / Lanzadores
```batch
CBSPrintService_3.2.7_Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="%TEMP%\cbs_install.log"
```

## Notas

- El instalador incluye `node_modules` pre-compilados. Se debe ejecutar `build.bat` solo en la mÃ¡quina de build.
- Los equipos destino requieren Java 8+ para ejecutar el vigilante de alertas.
- `config.json` se crea con valores por defecto si no existe en el destino.
- Las rutas de carpetas se configuran durante la instalaciÃ³n (o se editan en `config.json` despuÃ©s).
- Si no instalas VS Build Tools, el mÃ³dulo nativo `@tbalegas/node-printer` no se compilarÃ¡. El instalador funcionarÃ¡ pero la impresiÃ³n fallarÃ¡ hasta que se compile en cada mÃ¡quina destino con `npm install`.
