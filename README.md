# CBS Print Service — Manual Técnico

## Descripción

Servicio de Windows desarrollado en Node.js que reemplaza `CBSprint.exe` (VB).
Monitorea una carpeta local, detecta archivos `.txt` generados por Oracle Forms
y los envía directamente a la impresora matricial configurada **sin invocar
`cmd.exe`, `powershell.exe` ni ningún proceso externo** (cumple requisito de Auditoría).

---

## Flujo operativo

```
Oracle Forms (Imprime_Recibo)
        │
        │  genera Rec*.txt / Val*.txt
        ▼
  C:\Impresiones\          ← watchFolder
        │
        │  detectado por chokidar (fs.watch)
        ▼
  CBS Print Service
        │
        │  printDirect() → Winspool API (Win32)
        ▼
  Impresora matricial
        │
        ▼
  C:\Impresiones\Historico\  (o eliminado si fileAction=DELETE)
```

---

## Requisitos

| Componente | Versión mínima |
|---|---|
| Windows | 10 / 11 (64 bits) |
| Node.js | 18 LTS o superior |
| npm | incluido con Node.js |
| Impresora | Driver instalado en Windows (USB, LPT, red) |

---

## Instalación (primera vez)

1. Descomprimir el paquete en cualquier carpeta temporal.
2. **Hacer clic derecho** sobre `install.bat` → **"Ejecutar como administrador"**.
3. El instalador:
   - Verifica Node.js
   - Copia los archivos a `C:\CBS\PrintService\`
   - Instala dependencias npm
   - Registra `CBSPrintService` como Servicio de Windows (inicio automático)
4. Editar `C:\CBS\PrintService\config.json` con los valores reales.
5. Reiniciar el servicio:  
   `Administrador de Tareas → pestaña Servicios → CBSPrintService → Reiniciar`

---

## Actualización

1. **Hacer clic derecho** sobre `update.bat` → **"Ejecutar como administrador"**.
2. El actualizador detiene el servicio, reemplaza el código y lo reinicia.  
   **`config.json` NO es modificado.**

---

## Desinstalación

1. **Hacer clic derecho** sobre `uninstall.bat` → **"Ejecutar como administrador"**.
2. Los logs son preservados en `C:\CBS\PrintService\Logs`.

---

## Configuración (`config.json`)

```jsonc
{
  // Carpeta donde Oracle Forms deposita los archivos .txt
  "watchFolder":         "C:\\Impresiones",

  // Carpeta para archivos impresos correctamente
  "historyFolder":       "C:\\Impresiones\\Historico",

  // Carpeta para archivos que fallaron tras todos los reintentos
  "errorFolder":         "C:\\Impresiones\\Errores",

  // Carpeta de logs
  "logFolder":           "C:\\CBS\\PrintService\\Logs",

  // Nivel de log: "error" | "warn" | "info" | "debug"
  "logLevel":            "info",

  // Días de retención de archivos de log
  "logRetentionDays":    30,

  "printMethod":         "DIRECT",          // "DIRECT" | "GDI"

  "printers": {
    // Configuración para Vouchers (archivos Rec*.txt)
    "voucher": {
      "name":            "EPSON LX-350",   // Nombre parcial de la impresora
      "fontName":        "Courier New",    // Solo para modo GDI
      "fontSize":        9,                // Solo para modo GDI
      "bold":            false,            // Solo para modo GDI
      "maxCharsPerLine": 40,               // Solo para modo GDI (word-wrap)
      "copies":          1                 // Número de copias
    },
    // Configuración para Slips/Validación (archivos Val*.txt)
    "slip": {
      "name":            "EPSON LX-350",
      "fontName":        "Courier New",
      "fontSize":        9,
      "bold":            false,
      "maxCharsPerLine": 40,
      "copies":          1
    }
  },

  // Codificación del archivo: "latin1" (Windows-1252) compatible con Oracle Forms
  "fileEncoding":        "latin1",

  // Acción post-impresión: "MOVE" (mover a historyFolder) | "DELETE" (eliminar)
  "fileAction":          "MOVE",

  // Intervalo de sondeo en ms para detectar nuevos archivos (polling)
  "pollingIntervalMs":   1000,

  // Milisegundos de espera para estabilización del archivo antes de procesarlo
  "fileStabilizeMs":     500,

  // Reintentos ante impresora no disponible
  "retryCount":          3,
  "retryIntervalMs":     5000
}
```

### Identificar el nombre exacto de la impresora

Ejecutar el script de diagnóstico (no requiere privilegios especiales):

```
node C:\CBS\PrintService\scripts\diagnostico.js
```

Copiará el nombre exacto de la impresora que debe usarse en `config.json`.

---

## Estructura del proyecto

```
cbs-print-service/
├── src/
│   ├── index.js          ← Punto de entrada / bootstrap del servicio
│   ├── watcher.js        ← Monitoreo de carpeta (chokidar)
│   ├── fileProcessor.js  ← Cola FIFO, reintentos, post-proceso
│   ├── printer.js        ← Envío a impresora vía Winspool API
│   ├── gdiPrinter.js     ← Renderizado de texto modo GDI (word-wrap, ESC/P)
│   └── logger.js         ← Logging con rotación diaria (winston)
├── scripts/
│   ├── install-service.js   ← Registra el Servicio de Windows
│   ├── uninstall-service.js ← Elimina el Servicio de Windows
│   ├── diagnostico.js       ← Herramienta de diagnóstico
│   └── populate-printers.js ← Detecta impresora y actualiza config
├── tests/                ← Tests unitarios (npm test)
│   ├── fileProcessor.test.js
│   ├── gdiPrinter.test.js
│   └── printer.test.js
├── dist/                 ← Instalador generado (build.bat)
├── config.json           ← Configuración (NO sobreescrita en updates)
├── config.example.json   ← Plantilla de configuración con valores de ejemplo
├── healthcheck.json      ← Estado en vivo del servicio (generado automáticamente)
├── package.json
├── build.bat             ← Genera instalador (requiere Inno Setup)
├── setup.iss             ← Script de Inno Setup para instalador
├── BUILD.md              ← Guía de build / despliegue masivo
├── install.bat           ← Instalador manual [Admin]
├── uninstall.bat         ← Desinstalador manual [Admin]
├── update.bat            ← Actualizador manual [Admin]
├── status.bat            ← Verifica estado del servicio
└── README.md
```

---

## Logs

Los logs se encuentran en la carpeta configurada en `logFolder`.

Formato de cada entrada:
```
[2026-06-10 14:32:05] [INFO ] Nuevo archivo detectado | {"filePath":"C:\\Impresiones\\Rec20260610143205000001.txt"}
[2026-06-10 14:32:06] [INFO ] Impresión exitosa | {"fileName":"Rec...txt","docType":"voucher","printer":"EPSON LX-350","copies":1,"attempt":1}
```

Niveles:
- `INFO`  — operaciones normales (detección, impresión exitosa, movimiento de archivo)
- `WARN`  — reintentos, advertencias no críticas
- `ERROR` — fallos de impresión tras reintentos, archivos movidos a errores
- `DEBUG` — detalle técnico (activar cambiando `logLevel` a `"debug"`)

---

## Diagnóstico de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Servicio no arranca | config.json inválido o ruta no existe | Revisar config.json con JSON validator |
| Archivo pasa a carpeta Errores | Impresora offline o nombre incorrecto | Ejecutar `diagnostico.js`, verificar nombre |
| No detecta archivos nuevos | watchFolder incorrecto | Verificar ruta en config.json |
| Error al instalar servicio | Sin privilegios de Admin | Ejecutar install.bat como Administrador |
| Módulo nativo no compila | Build tools no instaladas | `npm install --global --production windows-build-tools` |

---

## Modos de Impresión

El servicio soporta dos modos, configurables mediante `printMethod` en `config.json`:

| Modo | Valor | Descripción |
|---|---|---|
| **DIRECT** | `"DIRECT"` | Envía el contenido del archivo .txt directamente al spooler de Windows vía API Winspool (RAW). Equivalente al modo Directo del VB original (`/43 S`). |
| **GDI** | `"GDI"` | Aplica word-wrap al texto según `maxCharsPerLine`, añade códigos ESC/P para negrita si `bold=true`, y envía el texto formateado a la impresora. Equivalente al modo GDI del VB original (`/43 N`). |

En modo DIRECT los parámetros `fontName`, `fontSize`, `bold` y `maxCharsPerLine` son ignorados.

---

## Health Check

El servicio genera automáticamente un archivo `healthcheck.json` en el directorio de instalación con el estado en vivo:

```bash
type C:\CBS\PrintService\healthcheck.json
```

Para una verificación rápida del servicio, ejecute:

```bash
status.bat
```

---

## Tests

Ejecutar las pruebas unitarias (requiere Node.js 20+ o Node.js 18 con flag `--experimental-test`):

```bash
npm test
```

---

## Seguridad y Auditoría

- **Sin procesos externos**: No se invoca `cmd.exe`, `powershell.exe` ni `ShellExecute`.
- La impresión usa directamente la API `Winspool` de Windows vía módulo nativo Node.js.
- El servicio corre bajo la cuenta `LocalSystem` (puede cambiarse a cuenta de servicio dedicada desde el SCM).
- Los logs de auditoría registran cada impresión con timestamp, archivo, impresora, modo, copias y resultado.

---

## Historial de versiones

| Versión | Fecha | Descripción |
|---|---|---|
| 1.0.0 | Junio 2026 | Versión inicial. Reemplaza CBSprint.exe (VB). |
| 1.1.0 | Julio 2026 | Modo GDI, health check, status.bat, tests unitarios, config.example.json, pollingIntervalMs, mejoras de estabilidad. |
