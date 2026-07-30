# CBS Print Service

Servicio de Windows (Node.js) que reemplaza `CBSprint.exe` (VB). Monitorea `watchFolder`, detecta archivos `Rec*.txt` / `Val*.txt` generados por Oracle Forms y los envía a impresora en tres modos:

| Modo | Código | Descripción |
|------|--------|-------------|
| **DIRECT** | `43A` | RAW directo al spooler vía Winspool API — sin procesos externos |
| **GDI** | `43I` | Word-wrap + códigos ESC/POS para control de fuente/tamaño/negrita en impresoras compatibles |
| **PDF** | `43H` | Renderiza el texto con fuente real mediante PDFKit y lo imprime a través del driver de Windows (más fiel al original VB.NET)

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
2. Copia archivos a `C:\CBS\PrintService\`, instala dependencias npm y registra el servicio `CBSPrintService` (inicio automático).
3. Editar `C:\CBS\PrintService\config.json` con valores reales.
4. Reiniciar el servicio desde Administrador de Tareas → Servicios.

### Instalador distribuible (build)
1. Ejecutar `build.bat` como **Administrador** (requiere Node.js, Python, VS Build Tools e Inno Setup — se auto-instalan).
2. Genera `dist\CBSPrintService_2.1.0_Setup.exe`.
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
| `logFolder` | string | `D:\Impresiones\Logs` | Carpeta de logs rotativos diarios |
| `logLevel` | string | `"info"` | Nivel de log: `error`, `warn`, `info`, `debug` |
| `logRetentionDays` | number | `30` | Días de retención de archivos de log |
| `printMethod` | string | `"DIRECT"` | Modo de impresión global: `"DIRECT"` (RAW), `"GDI"` (word-wrap + ESC/POS) o `"PDF"` (renderizado PDF + driver). Por archivo: `43A` = DIRECT, `43I` = GDI, `43H` = PDF/Híbrido |
| `fileEncoding` | string | `"latin1"` | Codificación de archivo (`"latin1"` = Windows-1252) |
| `fileAction` | string | `"MOVE"` | Post-impresión: `"MOVE"` (a historyFolder) o `"DELETE"` |
| `pollingIntervalMs` | number | `1000` | Intervalo de sondeo en ms para detectar archivos |
| `fileStabilizeMs` | number | `500` | Espera de estabilización antes de procesar el archivo |
| `retryCount` | number | `3` | Reintentos ante fallo de impresión |
| `retryIntervalMs` | number | `5000` | Intervalo entre reintentos en ms |
| `toastEnabled` | boolean | `true` | Habilitar notificaciones toast de Windows |
| `toastOnSuccess` | boolean | `true` | Mostrar toast al imprimir exitosamente |
| `toastOnError` | boolean | `true` | Mostrar toast al fallar impresión o parámetros inválidos |

### `printers` — Configuración por tipo de documento

```
printers.voucher  → para archivos Rec*.txt
printers.slip     → para archivos Val*.txt
```

| Sub-campo | Tipo | Default | Descripción |
|---|---|---|---|
| `name` | string | `"EPSON LX-350"` | Nombre parcial o exacto de la impresora |
| `fontName` | string | `"Courier New"` | Modos GDI y PDF |
| `fontSize` | number | `9` | Modos GDI y PDF |
| `bold` | boolean | `false` | Modos GDI y PDF |
| `maxCharsPerLine` | number | `40` | Word-wrap en GDI y PDF |
| `copies` | number | `1` | Número de copias |

---

## Parámetros en el nombre del archivo

Oracle Forms puede incrustar parámetros en el nombre del archivo separados por `~`:

```
Rec~t9~fCourier_New~b0~pMTU-950~w40~43S.txt
```

| Código | Parámetro | Valores | Default |
|---|---|---|---|
| `t` | `cTamañoLetra` | `1`–`72` | `9` |
| `f` | `cNombreFont` | nombre de la fuente | `Courier_New` |
| `b` | `cBold` | `S`=Negrita, `N`=No negrita | `N` |
| `p` | `cPrinterName` | nombre de impresora destino | — |
| `w` | `cAnchoMaximo` | `10`–`255` | `40` |
| `43` | `cImpresionDirecta` | `A`=Directa, `I`=GDI, `H`=Híbrido/PDF | `A` |
| `44` | `cNotificacion` | `S`=Habilitada, `N`=Deshabilitada | Usa `toastEnabled` de config |

Cuando un archivo incluye parámetros, estos tienen prioridad sobre `config.json`. Los nombres legacy sin `~` (ej: `Rec20260706_143022.txt`) usan solo la configuración del JSON.

Ejecutar `node scripts/diagnostico.js` o `node -e "require('./src/filenameParser').describeFormat()"` para ver la documentación completa del formato.

---

## Modos de impresión

| Modo | `printMethod` | Descripción |
|---|---|---|
| **DIRECT** | `"DIRECT"` | Envía el contenido del .txt directamente al spooler vía Winspool API (RAW). Ignora `fontName`, `fontSize`, `bold`, `maxCharsPerLine`. Equivale a `43A`. |
| **GDI** | `"GDI"` | Aplica word-wrap por `maxCharsPerLine`, códigos ESC/POS para fuente, tamaño y negrita. El texto se renderiza formateado antes de enviarse al spooler. **Requiere impresora compatible con ESC/POS.** Equivale a `43I`. |
| **PDF** | `"PDF"` | Renderiza el texto con word-wrap en un PDF usando **PDFKit** con mapeo a fuentes PDF estándar (Calibri/Arial → Helvetica, Courier New → Courier, etc.). El PDF se envía al driver de Windows mediante `Start-Process -Verb PrintTo`, produciendo un resultado visual similar al `DrawString` de VB.NET. Equivale a `43H`. |

---

## Notificaciones al usuario

El servicio notifica eventos clave al usuario mediante **archivos de alerta** y un **vigilante** que corre en la sesión del usuario.

### Arquitectura de notificación

```
Servicio (Session 0)                    Vigilante (Session 3 - escritorio del usuario)
     │                                            │
     │  escribe archivo .txt                      │
     ├─────── C:\Impresiones\Alertas\ ──────────►│  detecta archivo nuevo
     │                                            │  lee contenido
     │                                            │  muestra MessageBox nativo
     │                                            │  elimina archivo
```

> **¿Por qué dos procesos?** Un Windows Service corre en Session 0 (escritorio invisible). Ninguna UI puede mostrarse desde ahí. El vigilante corre en la sesión del usuario y sirve de puente visual.

### Componentes

| Archivo | Ubicación | Función |
|---|---|---|
| `notifier.js` | `src/` | Escribe archivos `.txt` en la carpeta Alertas |
| `alert-watcher.ps1` | `scripts/` | Monitorea Alertas, muestra MessageBox, elimina archivo |
| `install-alert-watcher.bat` | `scripts/` | Registra el vigilante en el Startup de Windows |

### Eventos notificados

| Evento | Título | Cuándo |
|---|---|---|
| Impresión OK | `CBS Print - Impresión exitosa` | Después de cada impresión exitosa |
| Error de impresión | `CBS Print - Error de impresión` | Cuando se agotan los reintentos |
| Parámetros inválidos | `CBS Print - Archivo inválido` | Nombre de archivo con parámetros incorrectos |
| Error crítico | `CBS Print - Excepción no capturada` | Error no manejado del servicio |

### Configuración

En `config.json`:

```json
{
  "toastEnabled":   true,
  "toastOnSuccess": true,
  "toastOnError":   true
}
```

> `toastEnabled` controla si se escriben archivos de alerta en la carpeta Alertas.

### Control por archivo (parámetro 44)

Se puede sobreescribir el comportamiento por archivo usando el parámetro `44` en el nombre:

```
Rec~44S~a1contenido.txt    → Forzar notificación para este archivo
Rec~44I~a1contenido.txt    → Deshabilitar notificación para este archivo
Rec~a1contenido.txt        → Usa el valor de config.json
```

### Prioridad de resolución

```
44S/44I en archivo  >  toastEnabled en config.json  >  default: true
```

### Instalación del vigilante

El vigilante se instala automáticamente durante la post-instalación. Para instalarlo manualmente:

```powershell
& "C:\CBS\PrintService\scripts\install-alert-watcher.bat"
```

Después **cerrar sesión y volver a entrar** para que arranque. El vigilante aparece como ícono en la bandeja del sistema (system tray).

---

## Scripts del proyecto

### Batch files (raíz)

| Script | Admin | Descripción |
|---|---|---|
| `install.bat` | ✅ | Instala el servicio en `C:\CBS\PrintService`, crea carpetas, instala dependencias, registra servicio |
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
| `alert-watcher.ps1` | Vigilante de alertas — monitorea la carpeta Alertas y muestra MessageBox (corre en sesión del usuario) |
| `install-alert-watcher.bat` | Instala el vigilante en la carpeta Startup del usuario actual |

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
| `tests/gdiPrinter.test.js` | Word-wrap, formato GDI, códigos ESC/POS |
| `tests/printer.test.js` | Resolución de impresora, envío al spooler |
| `tests/notifier.test.js` | Notificaciones toast, resolución de parámetro 44 |

---

## Logs

Ruta: `logFolder` configurado (default `D:\Impresiones\Logs`). Rotación diaria automática, retención configurable.

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

Verificar con: `status.bat` o `type C:\CBS\PrintService\healthcheck.json`.

---

## Seguridad y Auditoría

- Impresión vía Winspool API (`WritePrinter`) — módulo nativo `@tbalegas/node-printer`
- Servicio corre como `LocalSystem` (configurable desde SCM)
- Fallback PowerShell solo cuando el módulo nativo no está disponible
- Notificaciones via archivos (sin UI directa desde el servicio)
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
│   ├── gdiPrinter.js        # Renderizado modo GDI (word-wrap, ESC/POS)
│   ├── pdfPrinter.js        # Renderizado modo PDF (PDFKit + driver Windows)
│   ├── logger.js            # Logging rotativo (winston)
│   ├── filenameParser.js    # Parseo de parámetros en nombre de archivo
│   └── notifier.js          # Escritura de archivos de alerta para el vigilante
├── scripts/                 # Scripts auxiliares
│   ├── install-service.js
│   ├── uninstall-service.js
│   ├── diagnostico.js
│   ├── populate-printers.js
│   ├── apply-settings.js
│   ├── find-node.js
│   ├── find-node.cmd
│   ├── alert-watcher.ps1        # Vigilante de alertas (corre en sesión del usuario)
│   └── install-alert-watcher.bat # Instala vigilante en Startup del usuario
├── tests/                   # Tests unitarios
│   ├── filenameParser.test.js
│   ├── fileProcessor.test.js
│   ├── gdiPrinter.test.js
│   ├── printer.test.js
│   └── notifier.test.js
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
CBS Print Service (Session 0)
  │
  │ ├── DIRECT:  printDirect() → Winspool API (RAW)
  │ ├── GDI:     renderGdi() + printDirect() → Winspool API (RAW con ESC/POS)
  │ └── PDF:     renderPdfBuffer() → Start-Process -Verb PrintTo → driver de Windows
  │
  ├──► Impresora
  │      ▼
  │    historyFolder (MOVE) o eliminación (DELETE)
  │
  └──► C:\Impresiones\Alertas\ (archivo .txt)
         │
         ▼
       alert-watcher.ps1 (Session 3 - escritorio del usuario)
         │ detecta archivo
         ▼
       MessageBox nativo de Windows
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
| 1.2.0 | Jul 2026 | Notificaciones toast de Windows, parámetro 44 para control por archivo, configuración toastEnabled/toastOnSuccess/toastOnError |
| 1.6.0 | Jul 2026 | Sincronización de versiones en todos los archivos de configuración |
| 1.7.0 | Jul 2026 | Eliminación de dependencia node-notifier, notificaciones nativas via mshta.exe |
| 1.8.0 | Jul 2026 | Arquitectura de notificaciones dual: servicio escribe archivos + vigilante (alert-watcher.ps1) muestra MessageBox en la sesión del usuario. Eliminación de node-notifier. Instalación automática del vigilante en Startup. |
| 1.9.0 | Jul 2026 | Fix ventana PowerShell al iniciar sesión: wrapper VBS oculto (launch-alert-watcher.vbs). Fix alertas no mostradas: alert-watcher.ps1 ahora lee ruta desde config.json. Tarea programada CBSAlertWatcher con trigger inmediato tras registro. |
| 1.9.1 | Jul 2026 | Eliminado parámetro `m` (cMetodo) del parser de nombres — era legacy y no afectaba la impresión. Corrección de valores `43S`/`43N` a `43A`/`43I` en documentación. |
| 1.9.2 | Jul 2026 | Se realizan correcciones para los parametros de tipo de letra y tamaño de letra. |
| 2.1.0 | Jul 2026 | Nuevo modo **PDF/Híbrido** (`43H`). Renderiza el texto con fuentes reales mediante PDFKit y lo imprime a través del driver de Windows (`Start-Process -Verb PrintTo`), replicando el comportamiento del `DrawString` de VB.NET. Se agrega módulo `pdfPrinter.js` y dependencia `pdfkit`. |
