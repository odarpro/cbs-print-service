# CBS Print Service

Servicio de Windows (Node.js) que reemplaza `CBSprint.exe` (VB). Monitorea `watchFolder`, detecta archivos `Rec*.txt` / `Val*.txt` generados por Oracle Forms y los envía a impresora en tres modos:

| Modo | Código | Descripción |
|------|--------|-------------|
| **DIRECT** | `43A` | RAW directo al spooler vía Winspool API — sin procesos externos |
| **GDI** | `43I` | GDI nativo de Windows con word-wrap, fuente, tamaño y negrita a través del driver de la impresora |
| **CLASSIC** | `43C` | Replica exacta del CBSprint.exe VB: render GDI+ `DrawString` vía `PrintDocument` a través del driver de Windows |

---

## Requisitos

| Componente | Versión |
|---|---|
| Windows | 10 / 11 (64 bits) |
| Node.js | 18 LTS o superior |
| npm | incluido con Node.js |
| Java | JRE 17 o superior en `PATH` o `JAVA_HOME` (para las alertas visuales) |
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
2. Genera `dist\CBSPrintService_3.2.0_Setup.exe`.
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
| `historyRetentionDays` | number | `30` | Días de retención de archivos en `historyFolder` |
| `errorRetentionDays` | number | `90` | Días de retención de archivos en `errorFolder` |
| `alertRetentionDays` | number | `7` | Días de retención de alertas no leídas en la carpeta `Alertas` |
| `printMethod` | string | `"DIRECT"` | Modo de impresión global: `"DIRECT"` (RAW), `"GDI"` (GDI nativo con word-wrap) o `"CLASSIC"` (GDI+ VB). Por archivo: `43A` = DIRECT, `43I` = GDI, `43C` = Clásico/GDI+ VB |
| `gdiTimeoutMs` | number | `60000` | (Modo GDI real `43I`) Timeout del worker thread en ms. Si el driver no responde, el worker se termina y el archivo sigue la lógica de reintentos/errores |
| `classicTimeoutMs` | number | `60000` | (Modo CLÁSICO `43C`) Timeout de PowerShell en ms. Si el driver no responde, se finaliza el árbol de procesos y el archivo sigue la lógica de reintentos/errores |
| `fileEncoding` | string | `"latin1"` | Codificación de archivo (`"latin1"` = Windows-1252) |
| `fileAction` | string | `"MOVE"` | Post-impresión: `"MOVE"` (a historyFolder) o `"DELETE"` |
| `pollingIntervalMs` | number | `1000` | Intervalo de sondeo en ms para detectar archivos |
| `fileStabilizeMs` | number | `500` | Espera de estabilización antes de procesar el archivo |
| `retryCount` | number | `3` | Reintentos adicionales ante fallo; use `0` para mover a `Errores` tras el primer fallo |
| `retryIntervalMs` | number | `5000` | Intervalo entre reintentos en ms |
| `toastEnabled` | boolean | `true` | Habilitar notificaciones toast de Windows |
| `toastOnSuccess` | boolean | `true` | Mostrar toast al imprimir exitosamente |
| `toastOnError` | boolean | `true` | Mostrar toast al fallar impresión o parámetros inválidos |

Las retenciones de Histórico, Errores y Alertas se revisan al iniciar el servicio y cada hora. Los archivos vencidos se eliminan según su fecha de modificación. `watchFolder` no se limpia automáticamente para no borrar trabajos pendientes; los logs conservan su limpieza diaria mediante `logRetentionDays`.

### `printers` — Configuración por tipo de documento

```
printers.voucher  → para archivos Rec*.txt
printers.slip     → para archivos Val*.txt
```

| Sub-campo | Tipo | Default | Descripción |
|---|---|---|---|
| `name` | string | `"EPSON LX-350"` | Nombre parcial o exacto de la impresora |
| `fontName` | string | `"Courier New"` | Modos GDI y CLÁSICO |
| `fontSize` | number | `9` | Modos GDI y CLÁSICO |
| `bold` | boolean | `false` | Modos GDI y CLÁSICO |
| `maxCharsPerLine` | number | `40` | Word-wrap en GDI; corte de línea duro en CLÁSICO |
| `copies` | number | `1` | Número de copias |

---

## Parámetros en el nombre del archivo

Oracle Forms puede incrustar parámetros en el nombre del archivo separados por `~`:

```
Rec~t9~fCourier_New~bN~pMTU-950~w40~43A.txt
```

| Código | Parámetro | Valores | Default |
|---|---|---|---|
| `t` | `cTamañoLetra` | `1`–`72` | `9` |
| `f` | `cNombreFont` | nombre de la fuente | `Courier_New` |
| `b` | `cBold` | `S`=Negrita, `N`=No negrita | `N` |
| `p` | `cPrinterName` | nombre de impresora destino | — |
| `w` | `cAnchoMaximo` | `10`–`255` | `40` |
| `43` | `cImpresionDirecta` | `A`=Directa, `I`=GDI, `C`=Clásico/GDI+ VB | `A` |
| `44` | `cNotificacion` | `A`=Activa/Habilitada, `I`=Inactiva/Deshabilitada | Usa `toastEnabled` de config |

Cuando un archivo incluye parámetros, estos tienen prioridad sobre `config.json`. Los nombres legacy sin `~` (ej: `Rec20260706_143022.txt`) usan solo la configuración del JSON.

Ejecutar `node scripts/diagnostico.js` o `node -e "require('./src/filenameParser').describeFormat()"` para ver la documentación completa del formato.

---

## Modos de impresión

| Modo | `printMethod` | Descripción |
|---|---|---|
| **DIRECT** | `"DIRECT"` | Envía el contenido del .txt directamente al spooler vía Winspool API (RAW). Ignora `fontName`, `fontSize`, `bold`, `maxCharsPerLine`. Equivale a `43A`. |
| **GDI** | `"GDI"` | Imprime con **GDI nativo de Windows** vía FFI (`koffi` → `gdi32.dll`): `CreateDCW("WINSPOOL")` + `CreateFontW` (fuente TrueType, tamaño en puntos, negrita) + `TextOutW` línea por línea, enviado **a través del driver** de la impresora. Sin procesos externos (Session 0-safe). Respeta `fontName`, `fontSize`, `bold` y word-wrap por `maxCharsPerLine`. Equivale a `43I`. |
| **CLASSIC** | `"CLASSIC"` | Replica exacta del CBSprint.exe original: render GDI+ `DrawString` vía `PrintDocument` a través del driver de Windows (helper `scripts/print-classic.ps1`). Respeta fuentes TrueType, corte de línea duro a `maxCharsPerLine`, margen superior 3 mm y línea en blanco final, igual que `clsPrintManagement` del VB. Equivale a `43C`. |

### Modo CLÁSICO (43C): réplica del CBSprint.exe VB

El modo `43C` reproduce el comportamiento real del utilitario VB.NET que reemplaza este servicio. A diferencia del modo `43I` (GDI nativo), usa el **mismo motor de dibujo del original**: GDI+ `DrawString` sobre `PrintDocument`.

| Aspecto | Comportamiento (idéntico a VB) |
|---|---|
| Unidades | `PageUnit = Millimeter` |
| Márgenes | superior `3` mm, izquierdo `0` |
| Corte de línea | duro a `maxCharsPerLine` (sin word-wrap), igual que `drawLines()` |
| Línea final | una línea en blanco (`drawBlankLine()`) |
| Fuente | TrueType real por nombre (p. ej. `Calibri`), con `_` → espacio |
| Envío | Driver de Windows (GDI) → spooler |

> **Cómo funciona:** `classicPrinter.js` escribe el contenido a un temporal y ejecuta `powershell.exe -File scripts/print-classic.ps1` (no requiere .NET Runtime extra: usa `System.Drawing.Printing` de Windows PowerShell 5.1, presente en todas las versiones soportadas). Solo se envía el trabajo al spooler, por lo que funciona desde Session 0 (LocalSystem).

Si el driver queda bloqueado, `classicTimeoutMs` (predeterminado `60000`) finaliza PowerShell y su árbol de procesos. El archivo se reintenta según `retryCount` y, si no se imprime, se mueve a `errorFolder`, permitiendo que continúe la cola FIFO.

Ejemplo de uso:
```
Rec~43C~t9~fCourier_New~bS~pEPSON_TM-U950~w40~contenido.txt
```


### Modo GDI (43I): GDI nativo de Windows

El modo `43I` ya no traduce a comandos ESC/POS: ahora imprime el texto con **GDI real** llamando directamente a `gdi32.dll` desde Node.js mediante la biblioteca FFI **`koffi`** (binario precompilado, no requiere compilar nada):

| Paso | Llamada GDI | Efecto |
|---|---|---|
| 1 | `CreateDCW("WINSPOOL", <impresora>)` | Abre el DC de la impresora (funciona en Session 0) |
| 2 | `CreateFontW` | Crea la fuente TrueType por nombre (`f`), tamaño en puntos (`t`) y peso negrita (`b`) |
| 3 | `GetTextMetricsW` | Calcula la altura de línea real de la fuente |
| 4 | `StartDocW` → `StartPage` → `TextOutW` (por línea) → `EndPage` → `EndDoc` | Dibuja el texto con word-wrap por `w` y lo envía al spooler a través del **driver** de la impresora |

Características:

- **Fuentes TrueType reales**: `fCalibri`, `fArial`, `fCourier_New`, etc. se usan tal cual (el `_` se convierte en espacio). Sin limitaciones de Font A/B de la impresora.
- **Sin procesos externos**: a diferencia del modo CLÁSICO (`43C`), no invoca `powershell.exe`.
- **Session 0-safe**: solo se envía el trabajo al spooler (igual que el modo CLÁSICO).
- **Anti-bloqueo (worker thread + timeout)**: la secuencia GDI se ejecuta en un *worker thread* (`gdiWorker.js`), por lo que un driver colgado **nunca congela el servicio** ni la cola FIFO. Si el driver no responde en `gdiTimeoutMs` (default 60000 ms), el worker se termina y el archivo cae a la lógica normal de reintentos/errores.
- **Guard PORTPROMPT**: las impresoras virtuales con puerto `PORTPROMPT` piden interacción al imprimir; desde Session 0 eso colgaría el driver. El servicio lo detecta por registro y **falla rápido con un error claro**, sin esperar el timeout.
- Los parámetros del nombre del archivo (`f`, `t`, `b`, `w`) tienen prioridad sobre `config.json`, como en todos los modos.

> **Diferencia con CLÁSICO (`43C`):** ambos usan el driver de Windows. `43I` dibuja el texto con GDI clásico (`TextOutW`, word-wrap) directamente desde Node; `43C` replica exactamente el `DrawString` + `PrintDocument` del VB.NET (corte de línea duro, margen 3 mm, línea final en blanco) vía PowerShell.

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
| `cbs-alert-watcher.jar` | `scripts/` | Vigilante Java: monitorea Alertas, muestra MessageBox y elimina el archivo |
| `install-alert-watcher.bat` | `scripts/` | Registra el vigilante Java en el Programador de tareas |

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
Rec~44A~contenido.txt      → Forzar notificación para este archivo
Rec~44I~contenido.txt      → Deshabilitar notificación para este archivo
Rec20260706_143022.txt     → Usa el valor de config.json
```

### Prioridad de resolución

```
44A/44I en archivo  >  toastEnabled en config.json  >  default: true
```

### Instalación del vigilante

El vigilante se instala automáticamente durante la post-instalación. Para instalarlo manualmente:

```batch
C:\CBS\PrintService\scripts\install-alert-watcher.bat
```

El instalador exige Java 17 o superior en `PATH` o `JAVA_HOME`. El vigilante se inicia de inmediato y también en cada inicio de sesión.

### Verificar el vigilante activo

Ejecutar en PowerShell para comprobar que el vigilante Java está activo:

```powershell
$watchers = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'java.exe' -or $_.Name -eq 'javaw.exe') -and
  $_.CommandLine -like '*cbs-alert-watcher.jar*'
}

if ($watchers) {
  $watchers | Select-Object ProcessId, Name, SessionId, CommandLine
} else {
  'El vigilante de alertas no está activo.'
}
```

La salida debe mostrar un proceso `javaw.exe` o `java.exe` que ejecute `cbs-alert-watcher.jar`.

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
| `build-alert-watcher.bat` | Compila `java/AlertWatcher.java` en el JAR del vigilante (requiere JDK 17+) |
| `install-alert-watcher.bat` | Registra el vigilante Java para iniciar en la sesión del usuario |
| `print-classic.ps1` | Helper del **modo CLÁSICO (43C)**: imprime con GDI+ `DrawString` (réplica del CBSprint.exe VB) vía `PrintDocument` |

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
| `tests/gdiPrinter.test.js` | Word-wrap, layout y anti-bloqueo del modo GDI real (43I): worker thread, timeout y guard PORTPROMPT |
| `tests/classicPrinter.test.js` | Modo CLÁSICO (43C): args de PowerShell, codepage, localización del helper |
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
- Modo GDI real (43I) vía `gdi32.dll` con FFI — dependencia `koffi` (binario precompilado)
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
│   ├── gdiPrinter.js        # Modo GDI real (43I): GDI nativo vía koffi → gdi32.dll (worker + timeout + guard PORTPROMPT)
│   ├── gdiWorker.js         # Secuencia GDI (CreateDCW/CreateFontW/TextOutW) en worker thread (anti-bloqueo)
│   ├── classicPrinter.js    # Renderizado modo CLÁSICO 43C (GDI+ VB vía print-classic.ps1)
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
│   ├── build-alert-watcher.bat   # Compila el vigilante Java
│   └── install-alert-watcher.bat # Registra el vigilante Java
├── java/
│   └── AlertWatcher.java         # Vigilante Java de alertas visuales
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
  │ ├── GDI:     printGdi() → gdi32.dll (CreateDCW/CreateFontW/TextOutW) → driver de Windows
  │ └── CLASSIC: printClassic() → print-classic.ps1 → GDI+ DrawString → driver de Windows
  │
  ├──► Impresora
  │      ▼
  │    historyFolder (MOVE) o eliminación (DELETE)
  │
  └──► C:\Impresiones\Alertas\ (archivo .txt)
         │
         ▼
        cbs-alert-watcher.jar (Session 3 - escritorio del usuario)
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
| 1.9.1 | Jul 2026 | Eliminado parámetro `m` (cMetodo) del parser de nombres — era legacy y no afectaba la impresión. Corrección de valores `43S`/`43N` a `43A`/`43I` en documentación. |
| 1.9.2 | Jul 2026 | Se realizan correcciones para los parametros de tipo de letra y tamaño de letra. |
| 2.2.0 | Ago 2026 | Bump de versión a 2.2.0. |
| 3.0.0 | Ago 2026 | Nuevo modo **CLÁSICO** (`43C`): réplica exacta del CBSprint.exe VB mediante GDI+ `DrawString` vía `PrintDocument` (helper `scripts/print-classic.ps1`). Se agregan `classicPrinter.js`, `print-classic.ps1` y `tests/classicPrinter.test.js`. Bump de versión a 3.0.0. |
| 3.1.0 | Ago 2026 | El modo **GDI** (`43I`) pasa de ESC/POS a **GDI nativo de Windows**: `gdi32.dll` vía FFI (`koffi`) con `CreateDCW`/`CreateFontW`/`TextOutW` a través del driver de la impresora. Fuente TrueType real, tamaño en puntos, negrita y word-wrap. Sin procesos externos (Session 0-safe). Se agrega dependencia `koffi` y se reescribe `gdiPrinter.js`. **Anti-bloqueo**: la secuencia GDI se ejecuta en un worker thread (`gdiWorker.js`) con timeout configurable (`gdiTimeoutMs`, default 60000) y guard de puerto `PORTPROMPT` (falla rápido con error claro en vez de colgar el servicio); la cola FIFO y el vigilante nunca se congelan. |
| 3.2.0 | Ago 2026 | Retención configurable para Histórico, Errores y Alertas. El vigilante Java procesa alertas una por una, las muestra centradas y en primer plano, y su desinstalación finaliza procesos Java asociados. |
