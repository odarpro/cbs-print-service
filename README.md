# CBS Print Service

Servicio de Windows (Node.js) que reemplaza `CBSprint.exe` (VB). Monitorea `watchFolder`, detecta archivos `Rec*.txt` / `Val*.txt` generados por Oracle Forms y los envía a una impresora matricial vía Winspool API **sin invocar cmd.exe, powershell.exe ni procesos externos** (cumple Auditoría).

---

## Requisitos

| Componente | Versión |
|---|---|
| Windows | 10 / 11 (64 bits) |
| Node.js | 18 LTS o superior |
| npm | incluido con Node.js |
| Impresora | Driver instalado (USB, LPT, red) |

---

## Instalación

### Manual (desde el código fuente)
1. Ejecutar `install.bat` como **Administrador**.
2. Copia archivos a `D:\CBS\PrintService\`, instala dependencias npm y registra el servicio `CBSPrintService` (inicio automático).
3. Editar `D:\CBS\PrintService\config.json` con valores reales.
4. Reiniciar el servicio desde Administrador de Tareas → Servicios.

### Instalador distribuible (build)
1. Ejecutar `build.bat` como **Administrador** (requiere Node.js, Python, VS Build Tools e Inno Setup — se auto-instalan).
2. Genera `dist\CBSPrintService_<version>_Setup.exe`.
3. En máquinas destino ejecutar: `setup.exe /VERYSILENT` (GPO/SCCM: `/VERYSILENT /SUPPRESSMSGBOXES`).

### Actualización
Ejecutar `update.bat` como **Administrador**: detiene el servicio, reemplaza src/scripts/package.json, reinstala dependencias y reinicia. **config.json no se modifica**.

### Desinstalación
Ejecutar `uninstall.bat` como **Administrador**: detiene y elimina el servicio, remueve archivos preservando Logs.

---

## Configuración (`config.json`)

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `watchFolder` | string | `D:\Impresiones` | Carpeta monitoreada donde Oracle Forms deposita archivos .txt |
| `historyFolder` | string | `D:\Impresiones\Historico` | Destino de archivos impresos (cuando `fileAction: "MOVE"`) |
| `errorFolder` | string | `D:\Impresiones\Errores` | Destino de archivos que fallaron tras todos los reintentos |
| `logFolder` | string | `D:\CBS\PrintService\Logs` | Carpeta de logs rotativos diarios |
| `logLevel` | string | `"info"` | Nivel de log: `error`, `warn`, `info`, `debug` |
| `logRetentionDays` | number | `30` | Días de retención de archivos de log |
| `printMethod` | string | `"DIRECT"` | Modo de impresión: `"DIRECT"` o `"GDI"` |
| `fileEncoding` | string | `"latin1"` | Codificación de archivo (`"latin1"` = Windows-1252) |
| `fileAction` | string | `"MOVE"` | Post-impresión: `"MOVE"` (a historyFolder) o `"DELETE"` |
| `pollingIntervalMs` | number | `1000` | Intervalo de sondeo en ms para detectar archivos |
| `fileStabilizeMs` | number | `500` | Espera de estabilización antes de procesar el archivo |
| `retryCount` | number | `3` | Reintentos ante fallo de impresión |
| `retryIntervalMs` | number | `5000` | Intervalo entre reintentos en ms |

### `printers` — Configuración por tipo de documento

```
printers.voucher  → para archivos Rec*.txt
printers.slip     → para archivos Val*.txt
```

| Sub-campo | Tipo | Default | Descripción |
|---|---|---|---|
| `name` | string | `"EPSON LX-350"` | Nombre parcial o exacto de la impresora |
| `fontName` | string | `"Courier New"` | Solo modo GDI |
| `fontSize` | number | `9` | Solo modo GDI |
| `bold` | boolean | `false` | Solo modo GDI |
| `maxCharsPerLine` | number | `40` | Solo modo GDI (word-wrap) |
| `copies` | number | `1` | Número de copias |

---

## Parámetros en el nombre del archivo

Oracle Forms puede incrustar parámetros en el nombre del archivo separados por `~`:

```
Rec~m0~t9~fCourier_New~b0~a1contenido.txt~p1EPSON_LX-350~w140~43S.txt
```

| Código | Parámetro | Valores | Default |
|---|---|---|---|
| `m` | `cMetodo` | `0`=Original, `1`=Directo | `0` |
| `t` | `cTamañoLetra` | `1`–`72` | `9` |
| `f` | `cNombreFont` | nombre de la fuente | `Courier_New` |
| `b` | `cBold` | `0`=No, `1`=Sí | `0` |
| `a1` | `cNombreArchivo` | nombre del .txt a imprimir (sin ruta) | — |
| `p1` | `cPrinterName` | nombre de impresora destino | — |
| `w1` | `cAnchoMaximo` | `10`–`255` | `40` |
| `43` | `cImpresionDirecta` | `S`=Directa, `N`=GDI | `S` |

Cuando un archivo incluye parámetros, estos tienen prioridad sobre `config.json`. Los nombres legacy sin `~` (ej: `Rec20260706_143022.txt`) usan solo la configuración del JSON.

Ejecutar `node scripts/diagnostico.js` o `node -e "require('./src/filenameParser').describeFormat()"` para ver la documentación completa del formato.

---

## Modos de impresión

| Modo | `printMethod` | Descripción |
|---|---|---|
| **DIRECT** | `"DIRECT"` | Envía el contenido del .txt directamente al spooler vía Winspool API (RAW). Ignora `fontName`, `fontSize`, `bold`, `maxCharsPerLine`. Equivale a `/43 S`. |
| **GDI** | `"GDI"` | Aplica word-wrap por `maxCharsPerLine`, códigos ESC/P para negrita si `bold=true`, y envía el texto formateado. Equivale a `/43 N`. |

---

## Scripts del proyecto

### Batch files (raíz)

| Script | Admin | Descripción |
|---|---|---|
| `install.bat` | ✅ | Instala el servicio en `D:\CBS\PrintService`, crea carpetas, instala dependencias, registra servicio |
| `uninstall.bat` | ✅ | Detiene, elimina el servicio y remueve archivos (preserva Logs) |
| `update.bat` | ✅ | Detiene servicio, reemplaza código, reinstala dependencias y reinicia |
| `status.bat` | ❌ | Muestra estado del servicio, health check y archivos pendientes |
| `build.bat` | ✅ | Build completo: instala Node.js/Python/VS/Inno Setup, `npm install`, `npm test`, genera `dist\*.exe` |
| `post-install.bat` | — | Ejecutado por setup.exe tras la instalación (apply-settings, populate-printers, install-service) |

### Node.js scripts (`scripts/`)

| Script | Descripción |
|---|---|
| `install-service.js` | Registra `CBSPrintService` en el SCM vía `node-windows` |
| `uninstall-service.js` | Elimina el servicio del SCM |
| `diagnostico.js` | Diagnóstico: muestra config, verifica carpetas, lista impresoras instaladas, archivos pendientes |
| `populate-printers.js` | Detecta impresora por defecto y la asigna a `printers.voucher.name` / `printers.slip.name` en `config.json` |
| `apply-settings.js` | Aplica rutas de carpetas elegidas durante setup.exe |
| `find-node.js` / `find-node.cmd` | Localiza Node.js (system PATH o bundled portable) |

### npm scripts (`package.json`)

| Comando | Descripción |
|---|---|
| `npm start` | Ejecuta `src/index.js` en modo consola (desarrollo/diagnóstico) |
| `npm test` | Ejecuta tests unitarios con `node --test tests/*.test.js` |
| `npm run test:watch` | Tests en modo watch |
| `npm run install-service` | Registra el servicio Windows |
| `npm run uninstall-service` | Elimina el servicio Windows |

---

## Tests

```
npm test             # Ejecuta tests (Node.js 20+ o Node 18 con --experimental-test)
npm run test:watch   # Modo watch
```

| Archivo | Descripción |
|---|---|
| `tests/filenameParser.test.js` | Parseo y validación de nombres de archivo con parámetros |
| `tests/fileProcessor.test.js` | Cola FIFO, reintentos, post-procesamiento (MOVE/DELETE) |
| `tests/gdiPrinter.test.js` | Word-wrap, formato GDI, códigos ESC/P |
| `tests/printer.test.js` | Resolución de impresora, envío al spooler |

---

## Logs

Ruta: `logFolder` configurado (default `D:\CBS\PrintService\Logs`). Rotación diaria automática, retención configurable.

Formato: `[timestamp] [NIVEL] mensaje | {"meta":"json"}`

| Nivel | Descripción |
|---|---|
| `INFO` | Detección de archivos, impresiones exitosas, movimientos |
| `WARN` | Reintentos, archivos vacíos, advertencias |
| `ERROR` | Fallos tras reintentos, archivos movidos a errores |
| `DEBUG` | Detalle técnico (activar con `"logLevel": "debug"`) |

---

## Health Check

El servicio genera `healthcheck.json` con estado en vivo (actualizado cada 30s):

```json
{"status":"active","pid":1234,"uptime":3600,"queue":0,"timestamp":"2026-07-06T12:00:00.000Z"}
```

Verificar con: `status.bat` o `type D:\CBS\PrintService\healthcheck.json`.

---

## Seguridad y Auditoría

- Sin procesos externos: no invoca `cmd.exe`, `powershell.exe` ni `ShellExecute`
- Impresión vía Winspool API (`WritePrinter`) — módulo nativo `@tbalegas/node-printer`
- Servicio corre como `LocalSystem` (configurable desde SCM)
- Fallback PowerShell solo cuando el módulo nativo no está disponible
- Cada impresión queda registrada en logs con timestamp, archivo, impresora, modo, copias y resultado

---

## Estructura del proyecto

```
cbs-print-service/
├── src/                     # Código fuente
│   ├── index.js             # Punto de entrada / bootstrap
│   ├── watcher.js           # Monitoreo de carpeta (chokidar)
│   ├── fileProcessor.js     # Cola FIFO, reintentos, post-proceso
│   ├── printer.js           # Envío a impresora vía Winspool API
│   ├── gdiPrinter.js        # Renderizado modo GDI (word-wrap, ESC/P)
│   ├── logger.js            # Logging rotativo (winston)
│   └── filenameParser.js    # Parseo de parámetros en nombre de archivo
├── scripts/                 # Scripts auxiliares
│   ├── install-service.js
│   ├── uninstall-service.js
│   ├── diagnostico.js
│   ├── populate-printers.js
│   ├── apply-settings.js
│   ├── find-node.js
│   └── find-node.cmd
├── tests/                   # Tests unitarios
│   ├── filenameParser.test.js
│   ├── fileProcessor.test.js
│   ├── gdiPrinter.test.js
│   └── printer.test.js
├── dist/                    # Instalador generado (build.bat)
├── config.json              # Configuración (NO sobreescrita en updates)
├── config.example.json      # Plantilla de ejemplo
├── healthcheck.json         # Estado en vivo (generado automáticamente)
├── package.json
├── build.bat                # Genera instalador (requiere Inno Setup)
├── setup.iss                # Script Inno Setup
├── install.bat              # Instalador manual [Admin]
├── uninstall.bat            # Desinstalador manual [Admin]
├── update.bat               # Actualizador manual [Admin]
├── status.bat               # Verifica estado del servicio
├── post-install.bat         # Post-instalación (setup.exe)
├── BUILD.md                 # Guía de build / despliegue masivo
├── Riesgos.txt              # Análisis de riesgos del servicio
└── README.md
```

---

## Flujo operativo

```
Oracle Forms (Imprime_Recibo)
  │ genera Rec*.txt / Val*.txt
  ▼
watchFolder (D:\Impresiones)
  │ detectado por chokidar
  ▼
CBS Print Service
  │ printDirect() → Winspool API (Win32)
  ▼
Impresora matricial
  ▼
historyFolder (MOVE) o eliminación (DELETE)
```

---

## Diagnóstico de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Servicio no arranca | config.json inválido o ruta no existe | Validar JSON, verificar carpetas |
| Archivo pasa a Errores | Impresora offline o nombre incorrecto | `node scripts/diagnostico.js`, verificar nombre |
| No detecta archivos | watchFolder incorrecto | Verificar ruta en config.json |
| Error al instalar servicio | Sin privilegios de Admin | Ejecutar como Administrador |
| Módulo nativo no compila | Build tools no instaladas | `npm install --global windows-build-tools` |

---

## Historial de versiones

| Versión | Fecha | Descripción |
|---|---|---|
| 1.0.0 | Jun 2026 | Versión inicial. Reemplaza CBSprint.exe (VB). |
| 1.1.0 | Jul 2026 | Modo GDI, health check, status.bat, tests, config.example.json, pollingIntervalMs |
