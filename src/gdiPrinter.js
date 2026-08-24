'use strict';
// =============================================================================
// gdiPrinter.js  –  CBS Print Service  (modo 43I / GDI real)
//
// Imprime texto con GDI nativo de Windows (gdi32.dll vía FFI koffi), a través
// del driver de la impresora, respetando los parámetros del nombre del archivo:
//   f = fuente, t = tamaño, b = negrita, w = ancho máximo por línea.
//
// La secuencia GDI se ejecuta en un WORKER THREAD (src/gdiWorker.js) para que
// un driver que se cuelgue NUNCA bloquee el hilo principal ni la cola FIFO:
//   - timeout configurable (gdiTimeoutMs, default 60 s): si se excede, el
//     worker se termina y el archivo cae a la lógica normal de reintentos.
  //   - guard de puerto PORTPROMPT (impresoras virtuales interactivas): desde
//     un servicio Session 0 el driver pide nombre de archivo y colgaría; se
//     detecta por registro y se falla rápido con un error claro.
//
// Session 0-safe: solo se envía el trabajo al spooler vía el driver.
// =============================================================================

const fs       = require('fs');
const path     = require('path');
const { execFile } = require('child_process');
const { Worker }  = require('worker_threads');
const logger   = require('./logger');

const WORKER_SCRIPT  = path.join(__dirname, 'gdiWorker.js');
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Renderiza el texto aplicando word-wrap a maxChars por línea (lógica pura).
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function wordWrap(text, maxChars) {
  if (!maxChars || maxChars <= 0) return text;

  const lines = text.split('\n');
  const result = [];

  for (const line of lines) {
    if (line.length <= maxChars) {
      result.push(line);
      continue;
    }

    let remaining = line;
    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        result.push(remaining);
        break;
      }

      let cut = remaining.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;

      result.push(remaining.substring(0, cut));
      remaining = remaining.substring(cut).trimStart();
    }
  }

  return result.join('\n');
}

/**
 * Convierte el contenido en el arreglo de líneas a dibujar (word-wrap).
 * @param {string} text
 * @param {number} maxCharsPerLine
 * @returns {string[]}
 */
function layoutLines(text, maxCharsPerLine) {
  const max = maxCharsPerLine && maxCharsPerLine > 0 ? maxCharsPerLine : 40;
  return wordWrap(text, max).split('\n');
}

/**
 * Consulta el puerto de la impresora en el registro de Windows.
 * @param {string} printerName  Nombre REAL de la impresora
 * @returns {Promise<string|null>}  'PORTPROMPT:', 'LPT1:', 'USB001', etc., o null si no se pudo determinar
 */
function getPrinterPort(printerName) {
  return new Promise(resolve => {
    const key = `HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\${printerName}`;
    execFile('reg.exe', ['query', key, '/v', 'Port'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /Port\s+REG_(?:S|M)Z\s+(\S+)/i.exec(stdout || '');
      resolve(m ? m[1] : null);
    });
  });
}

/**
 * Verifica si un puerto de impresora es PORTPROMPT (pide nombre de archivo
 * al imprimir → colgaría desde un servicio Session 0).
 * @param {string|null} port
 * @returns {boolean}
 */
function isPortPromptPort(port) {
  return !!port && port.toUpperCase().startsWith('PORTPROMPT');
}

/**
 * Ejecuta la secuencia GDI en un worker thread con timeout.
 * Si el worker se cuelga, se termina y se rechaza (la cola nunca se bloquea).
 *
 * @param {object} job  workerData para gdiWorker.js
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function runGdiInWorker(job, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WORKER_SCRIPT)) {
      return reject(new Error(`Modo GDI real: no se encontró ${WORKER_SCRIPT}.`));
    }

    const worker = new Worker(WORKER_SCRIPT, { workerData: job });
    let done = false;

    const finish = (cb, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(
        `Modo GDI real: timeout de ${timeoutMs} ms esperando a la impresora "${job.printerName}" (driver colgado o sin respuesta).`
      ));
      worker.terminate().catch(() => {});
    }, timeoutMs);

    worker.on('message', msg => {
      if (msg && msg.ok) {
        finish(resolve, msg);
      } else {
        finish(reject, new Error((msg && msg.error) || 'Modo GDI real: error desconocido en el worker.'));
      }
    });

    worker.on('error', err => {
      finish(reject, new Error(`Modo GDI real: error en el worker: ${err.message}`));
    });

    worker.on('exit', code => {
      if (!done && code !== 0) {
        finish(reject, new Error(`Modo GDI real: el worker terminó inesperadamente (código ${code}).`));
      }
    });
  });
}

/**
 * Imprime contenido de texto con GDI real respetando los parámetros del
 * nombre del archivo (f=fuente, t=tamaño, b=bold, w=ancho por línea).
 *
 * @param {string} content  Contenido ya decodificado (fileEncoding)
 * @param {object} [opts]
 *   opts.printerName       {string}  Nombre REAL de la impresora (resuelto)
 *   opts.maxCharsPerLine   {number}  Ancho máximo por línea (w)
 *   opts.bold              {boolean} Negrita (b)
 *   opts.fontName          {string}  Nombre de fuente (f), `_` → espacio
 *   opts.fontSize          {number}  Tamaño en puntos (t)
 *   opts.copies            {number}  Copias
 *   opts.docTitle          {string}  Título del trabajo
 *   opts.timeoutMs         {number}  Timeout GDI (default 60000)
 * @returns {Promise<void>}
 */
async function printGdi(content, opts = {}) {
  const {
    printerName,
    maxCharsPerLine = 40,
    bold = false,
    fontName = 'Courier New',
    fontSize = 9,
    copies = 1,
    docTitle = 'Recibo',
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = opts;

  if (!printerName) {
    throw new Error('Modo GDI real: falta el nombre de la impresora.');
  }

  const cleanFont = String(fontName || 'Courier New').replace(/_/g, ' ') || 'Courier New';
  const parsedSize = parseInt(fontSize, 10);
  const safeSize = isNaN(parsedSize) || parsedSize < 1 || parsedSize > 72 ? 9 : parsedSize;
  const nCopies = copies && copies > 0 ? copies : 1;
  const nTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const lines = layoutLines(content, maxCharsPerLine);

  // Guard anti-bloqueo: puertos PORTPROMPT de impresoras virtuales piden
  // nombre de archivo al imprimir y desde Session 0 colgarían el driver.
  const port = await getPrinterPort(printerName);
  if (isPortPromptPort(port)) {
    throw new Error(
      `Modo GDI real: la impresora "${printerName}" usa puerto PORTPROMPT ` +
      `(pide nombre de archivo al imprimir). Desde un servicio Session 0 se colgaría; ` +
      `use una impresora con puerto real (LPT, USB, red) u otro modo de impresión.`
    );
  }

  logger.get().debug('Iniciando impresión modo GDI real', {
    printerName,
    fontName: cleanFont,
    fontSize: safeSize,
    bold: !!bold,
    maxCharsPerLine,
    copies: nCopies,
    timeoutMs: nTimeout,
    port: port || 'desconocido',
    lineas: lines.length
  });

  await runGdiInWorker({
    printerName,
    lines,
    fontName: cleanFont,
    fontSize: safeSize,
    bold: !!bold,
    copies: nCopies,
    docTitle
  }, nTimeout);

  logger.get().info('Impresión GDI real completada', {
    printerName,
    fontName: cleanFont,
    fontSize: safeSize,
    bold: !!bold,
    copies: nCopies
  });
}

module.exports = { printGdi, wordWrap, layoutLines, getPrinterPort, isPortPromptPort, runGdiInWorker };
