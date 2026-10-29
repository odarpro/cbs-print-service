'use strict';
// =============================================================================
// fileProcessor.js  –  CBS Print Service
//
// Gestiona la cola de archivos detectados:
//   1. Espera a que el archivo esté completamente escrito (estabilización).
//   2. Determina el tipo (Voucher / Slip) por el prefijo del nombre.
//   3. Selecciona la configuración de impresora correspondiente.
//   4. Invoca printer.printFile() — sin procesos externos.
//   5. Aplica política de reintentos ante error.
//   6. Mueve o elimina el archivo según configuración.
//   7. Todo archivo trasladado a errorFolder genera su entrada de log (ERROR)
//      en el log global del servicio con el motivo y el detalle del fallo.
// =============================================================================

const fs             = require('fs');
const path           = require('path');
const logger         = require('./logger');
const printer        = require('./printer');
const filenameParser = require('./filenameParser');
const notifier       = require('./notifier');
const jobTracker     = require('./jobTracker');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Espera a que el tamaño del archivo deje de cambiar durante `ms` milisegundos.
 * Garantiza que Oracle Forms haya terminado de escribir el archivo antes de
 * intentar leerlo (evita lecturas parciales).
 * Timeout máximo de 30 segundos para evitar bloqueos indefinidos.
 */
async function waitForFileStable(filePath, ms = 500, signal = null) {
  let prevSize = -1;
  let stable   = false;
  let emptyCount = 0;
  const start  = Date.now();
  const MAX_WAIT_MS = 30000;

  while (!stable) {
    if (signal && signal.aborted) return;
    if (Date.now() - start > MAX_WAIT_MS) {
      logger.get().warn('Tiempo máximo de estabilización excedido, procesando archivo', { filePath });
      return;
    }
    await sleep(ms, signal);
    try {
      const { size } = fs.statSync(filePath);
      if (size === 0) {
        emptyCount++;
        if (emptyCount >= 3) {
          logger.get().warn('Archivo vacío detectado en waitForFileStable', { filePath });
          return;
        }
      }
      stable   = (size === prevSize && size > 0);
      prevSize = size;
    } catch {
      stable = true;
    }
  }
}

function sleep(ms, signal = null) {
  return new Promise(resolve => {
    if (signal && signal.aborted) return resolve();

    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => {
      if (signal) {
        try { signal.removeEventListener('abort', onAbort); } catch {}
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function isAbortedError(err) {
  return !!err && err.code === 'CBS_JOB_ABORTED';
}

/**
 * Crea un directorio (y sus padres) si no existe.
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Mueve un archivo a destino.  Si ya existe un archivo con el mismo nombre
 * en destino, agrega un sufijo timestamp para no sobrescribir.
 */
function moveFile(src, destDir) {
  ensureDir(destDir);
  const baseName = path.basename(src);
  let   destPath = path.join(destDir, baseName);

  if (fs.existsSync(destPath)) {
    const ext  = path.extname(baseName);
    const name = path.basename(baseName, ext);
    destPath   = path.join(destDir, `${name}_${Date.now()}${ext}`);
  }

  fs.renameSync(src, destPath);
  return destPath;
}

/**
 * Elimina un archivo de forma segura.
 */
function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    logger.get().warn('No se pudo eliminar el archivo', { filePath, error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Determinar tipo de comprobante
// ---------------------------------------------------------------------------

/**
 * Imprime_Recibo genera:
 *   Rec<timestamp><session>.txt  → Voucher
 *   Val<timestamp><session>.txt  → Slip / Validación
 *
 * @param {string} fileName
 * @returns {'voucher'|'slip'|null}
 */
function detectDocType(fileName) {
  const base = path.basename(fileName).toLowerCase();
  if (base.startsWith('rec')) return 'voucher';
  if (base.startsWith('val')) return 'slip';
  return null;          // archivo no reconocido → ignorar
}

// ---------------------------------------------------------------------------
// Procesador principal
// ---------------------------------------------------------------------------

class FileProcessor {
  /**
   * @param {object} config  Contenido de config.json
   */
  constructor(config) {
    this.config = config;
    this._queue = [];        // cola FIFO
    this._busy  = false;     // bandera de procesamiento en curso
    this._accepting = true;  // false tras iniciar el apagado
    this._stopping  = false; // true cuando se cancela el trabajo activo
    this._activeJob = null;  // { controller, filePath, documentName, jobId, printerName, startedAt }
  }

  /**
   * Encola un archivo para procesamiento.
   * El procesamiento es serial (FIFO) para evitar colisiones en la impresora.
   * @param {string} filePath  Ruta completa del archivo detectado
   */
  enqueue(filePath) {
    const log = logger.get();
    if (!this._accepting) {
      log.warn('Archivo ignorado: el servicio está finalizando', { filePath });
      return false;
    }
    log.info('Archivo encolado', { filePath });
    this._queue.push(filePath);
    this._processNext();
    return true;
  }

  /**
   * Deja de aceptar archivos nuevos. Los ya encolados se siguen procesando.
   */
  stopAccepting() {
    if (!this._accepting) return;
    this._accepting = false;
    logger.get().info('El procesador dejó de aceptar archivos nuevos', {
      pendientes: this._queue.length,
      ocupado: this._busy
    });
  }

  /**
   * Espera a que la cola y el trabajo activo terminen, sin cancelarlos.
   * @param {number} timeoutMs
   * @returns {Promise<boolean>} true si quedó vacío
   */
  async drain(timeoutMs = 10000) {
    const start = Date.now();
    while (this._busy || this._queue.length > 0) {
      if (Date.now() - start >= timeoutMs) return false;
      await sleep(100);
    }
    return true;
  }

  /**
   * Cancela el trabajo activo: aborta PowerShell/GDI/DIRECT y elimina del
   * spooler los jobs propios que hayan quedado en la cola.
   * @param {string} reason
   * @returns {boolean} true si había un trabajo activo
   */
  cancelActiveJob(reason = 'apagado del servicio') {
    this._stopping = true;
    const active = this._activeJob;
    if (!active) {
      logger.get().warn('No hay trabajo activo que cancelar', { reason });
      return false;
    }

    const log = logger.get();
    log.warn('Cancelando trabajo activo', {
      reason,
      filePath: active.filePath,
      documentName: active.documentName,
      jobId: active.jobId,
      printerName: active.printerName
    });

    try {
      active.controller.abort(new jobTracker.JobAbortedError(reason));
    } catch (e) {
      log.warn('No se pudo abortar el controlador del trabajo', { error: e.message });
    }

    if (active.printerName && active.documentName) {
      try {
        jobTracker.deleteMatchingJobs(active.printerName, active.documentName);
      } catch (e) {
        log.warn('No se pudieron eliminar los jobs del spooler', { error: e.message });
      }
    }

    return true;
  }

  // ── Loop de cola ────────────────────────────────────────────────────────

  async _processNext() {
    if (this._stopping) return;
    if (this._busy || this._queue.length === 0) return;

    this._busy = true;
    const filePath = this._queue.shift();

    const controller = new AbortController();
    this._activeJob = {
      controller,
      filePath,
      documentName: null,
      jobId: null,
      printerName: null,
      startedAt: Date.now()
    };

    const onJobStarted = (info) => {
      if (!this._activeJob || this._activeJob.controller !== controller) return;
      if (!info) return;
      if (info.printerName) this._activeJob.printerName = info.printerName;
      if (info.documentName) this._activeJob.documentName = info.documentName;
      if (info.jobId !== undefined && info.jobId !== null) this._activeJob.jobId = info.jobId;
    };

    try {
      await this._processFile(filePath, { signal: controller.signal, onJobStarted });
    } catch (err) {
      if (isAbortedError(err) || controller.signal.aborted) {
        logger.get().info('Procesamiento abortado durante el apagado', {
          filePath,
          error: err.message
        });
      } else {
        // Error ya registrado en _processFile; continuamos con el siguiente
        logger.get().error('Error no esperado en _processNext', { error: err.message });
      }
    } finally {
      if (this._activeJob && this._activeJob.controller === controller) {
        this._activeJob = null;
      }
      this._busy = false;
      if (!this._stopping) {
        this._processNext();   // procesar el siguiente en la cola
      }
    }
  }

  // ── Procesamiento de un archivo ─────────────────────────────────────────

  async _processFile(filePath, ctx = {}) {
    const { signal = null, onJobStarted = null } = ctx;
    const log  = logger.get();
    const cfg  = this.config;

    if (signal && signal.aborted) {
      throw new jobTracker.JobAbortedError();
    }

    const fileName = path.basename(filePath);
    const docType  = detectDocType(fileName);

    // Ignorar archivos que no correspondan a la convención Rec*/Val*
    if (!docType) {
      log.debug('Archivo ignorado (no es Rec* ni Val*)', { fileName });
      return;
    }

    // Parsear parámetros desde el nombre del archivo
    const parsed = filenameParser.parse(filePath);

    if (parsed) {
      const validation = filenameParser.validate(parsed);
      if (!validation.valid) {
        log.warn('Parámetros inválidos en el nombre del archivo', {
          fileName,
          errors: validation.errors
        });

        const parsedParams = parsed && parsed.params ? parsed.params : null;
        notifier.notifyInvalidFile(fileName, validation.errors, parsedParams);

        this._moveToError(filePath, `Parámetros inválidos: ${validation.errors.join('; ')}`, {
          stage:    'validacion',
          docType,
          intentos: 0,
          detalle:  validation.errors
        });
        return;
      }
    }

    log.info('Iniciando procesamiento', {
      fileName,
      docType,
      hasParams: parsed ? parsed.hasParams : false
    });

    // 1. El archivo trigger es el que contiene el contenido a imprimir
    const contentFilePath = filePath;

    // 2. Esperar a que el archivo de contenido esté completamente escrito
    await waitForFileStable(contentFilePath, cfg.fileStabilizeMs || 500, signal);

    if (signal && signal.aborted) {
      throw new jobTracker.JobAbortedError();
    }

    // 3. Verificar archivo y validar contenido
    let content;
    try {
      content = fs.readFileSync(contentFilePath, { encoding: cfg.fileEncoding || 'latin1' });
    } catch (e) {
      log.warn('Archivo desapareció o no es legible antes de procesarse', { filePath: contentFilePath, error: e.message });
      return;
    }

    if (!content || content.trim().length === 0) {
      log.warn('Archivo vacío, moviendo a errores', { filePath: contentFilePath });
      const parsedParams = parsed && parsed.params ? parsed.params : null;
      notifier.notifyPrintError(fileName, 'Archivo vacío', parsedParams);
      this._moveToError(filePath, 'Archivo vacío', {
        stage:    'lectura',
        docType,
        intentos: 0
      });
      return;
    }

    // 4. Obtener configuración base desde config.json
    const printerCfg = cfg.printers[docType] || {};

    // 5. Resolver opciones de impresión:
    //    - Parámetros del filename tienen prioridad
    //    - Valores de config.json como fallback
    //    - Valores por defecto hardcodeados como último recurso

    const resolvedPrinterName = (parsed && parsed.params.p) || printerCfg.name;
    if (!resolvedPrinterName) {
      log.error('No hay impresora configurada para el tipo de documento', { docType });
      const parsedParams = parsed && parsed.params ? parsed.params : null;
      notifier.notifyPrintError(fileName, 'Sin impresora configurada', parsedParams);
      this._moveToError(filePath, 'Sin impresora configurada', {
        stage:    'configuracion',
        docType,
        intentos: 0
      });
      return;
    }

    const rawMethod43  = parsed && parsed.params['43'];
    const rawFontName  = parsed && parsed.params.f;
    const rawFontSize  = parsed && parsed.params.t;
    const rawBold      = parsed && parsed.params.b;
    const rawWidth     = parsed && parsed.params.w;

    const hasGdiParams = rawFontName !== undefined
      || rawFontSize !== undefined
      || rawBold !== undefined
      || rawWidth !== undefined;

    let resolvedPrintMethod;
    if (rawMethod43) {
      const upper = rawMethod43.toUpperCase();
      if (upper === 'I') resolvedPrintMethod = 'GDI';
      else if (upper === 'C') resolvedPrintMethod = 'CLASSIC';
      else resolvedPrintMethod = 'DIRECT';
    } else if (hasGdiParams) {
      resolvedPrintMethod = 'GDI';
      log.debug('Modo GDI auto-activado por parámetros de fuente en el filename');
    } else {
      resolvedPrintMethod = cfg.printMethod || 'DIRECT';
    }

    const resolvedBold = rawBold !== undefined
      ? (rawBold.toUpperCase() === 'S')
      : (printerCfg.bold || false);

    const resolvedMaxChars = rawWidth !== undefined
      ? parseInt(rawWidth, 10)
      : (printerCfg.maxCharsPerLine || 40);

    const resolvedFontName = rawFontName !== undefined
      ? rawFontName
      : (printerCfg.fontName || 'Courier New');

    const resolvedFontSize = rawFontSize !== undefined
      ? parseInt(rawFontSize, 10)
      : (printerCfg.fontSize || 9);

    log.debug('Opciones de impresión resueltas', {
      printerName:  resolvedPrinterName,
      printMethod:  resolvedPrintMethod,
      bold:         resolvedBold,
      maxCharsPerLine: resolvedMaxChars,
      fontName:     resolvedFontName,
      fontSize:     resolvedFontSize,
      contentFilePath
    });

    // 6. Intentar imprimir con reintentos
    // retryCount indica reintentos adicionales: 0 intenta una vez y, si falla,
    // mueve el archivo a Errores para que no mantenga detenida la cola.
    const retryCount = Number.isInteger(cfg.retryCount) && cfg.retryCount >= 0
      ? cfg.retryCount
      : 3;
    const maxAttempts = retryCount + 1;
    const retryMs = Number.isFinite(cfg.retryIntervalMs) && cfg.retryIntervalMs >= 0
      ? cfg.retryIntervalMs
      : 5000;
    let   lastError  = null;
    const attemptErrors = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal && signal.aborted) {
        throw new jobTracker.JobAbortedError();
      }

      try {
        await printer.printFile({
          filePath:       contentFilePath,
          printerName:    resolvedPrinterName,
          fileEncoding:   cfg.fileEncoding || 'latin1',
          copies:         printerCfg.copies || 1,
          docTitle:       fileName,
          content,
          printMethod:    resolvedPrintMethod,
          bold:           resolvedBold,
          maxCharsPerLine: resolvedMaxChars,
          fontName:       resolvedFontName,
          fontSize:       resolvedFontSize,
          gdiTimeoutMs:   cfg.gdiTimeoutMs,
          classicTimeoutMs: cfg.classicTimeoutMs,
          directTimeoutMs: cfg.directTimeoutMs,
          signal,
          onJobStarted
        });

        // ── Éxito ──────────────────────────────────────────────────────
        log.info('Impresión exitosa', {
          fileName,
          docType,
          printer:  resolvedPrinterName,
          copies:   printerCfg.copies || 1,
          modo:     resolvedPrintMethod,
          attempt
        });

        const parsedParams = parsed && parsed.params ? parsed.params : null;
        notifier.notifyPrintSuccess(fileName, resolvedPrinterName, parsedParams);

        this._postProcess(filePath);
        return;

      } catch (err) {
        if (isAbortedError(err) || (signal && signal.aborted)) {
          log.info('Impresión abortada; el archivo queda pendiente', {
            fileName,
            intento: attempt
          });
          throw new jobTracker.JobAbortedError();
        }

        lastError = err;
        attemptErrors.push(`Intento ${attempt}/${maxAttempts}: ${err.message}`);
        log.warn(`Intento ${attempt}/${maxAttempts} fallido`, {
          fileName,
          error: err.message
        });

        if (attempt < maxAttempts) {
          await sleep(retryMs, signal);
        }
      }
    }

    if (signal && signal.aborted) {
      throw new jobTracker.JobAbortedError();
    }

    // ── Agotados los reintentos ──────────────────────────────────────────
    const finalError = lastError ? lastError.message : 'Error desconocido';

    log.error('Archivo no pudo imprimirse tras todos los reintentos', {
      fileName,
      docType,
      impresora:     resolvedPrinterName,
      modo:          resolvedPrintMethod,
      intentos:      maxAttempts,
      reintentos:    retryCount,
      intervaloMs:   retryMs,
      error:         finalError,
      detalleIntentos: attemptErrors
    });

    const parsedParams = parsed && parsed.params ? parsed.params : null;
    notifier.notifyPrintError(fileName, finalError, parsedParams);

    this._moveToError(filePath, finalError, {
      stage:            'impresion',
      docType,
      impresora:        resolvedPrinterName,
      modo:             resolvedPrintMethod,
      intentos:         maxAttempts,
      reintentos:       retryCount,
      ultimoError:      finalError,
      detalleIntentos:  attemptErrors
    });
  }

  // ── Post-proceso ─────────────────────────────────────────────────────────

  _postProcess(filePath) {
    const log = logger.get();
    const cfg = this.config;

    if (cfg.fileAction === 'DELETE') {
      deleteFile(filePath);
      log.info('Archivo eliminado', { filePath });
    } else {
      // MOVE (default)
      const dest = moveFile(filePath, cfg.historyFolder);
      log.info('Archivo movido a histórico', { dest });
    }
  }

  /**
   * Traslada un archivo a errorFolder y registra su entrada en el log global.
   * Se genera SIEMPRE una línea ERROR con el motivo y el detalle del fallo,
   * tanto si el traslado se completa como si falla.
   *
   * @param {string} filePath
   * @param {string} reason   Motivo legible del fallo
   * @param {object} [details] Detalle adicional (etapa, intentos, impresora…)
   * @returns {string|null} Ruta destino o null si el traslado falló
   */
  _moveToError(filePath, reason, details = {}) {
    const log      = logger.get();
    const fileName = path.basename(filePath);
    const base     = { ...details, fileName, motivo: reason };

    try {
      const dest = moveFile(filePath, this.config.errorFolder);
      log.error('Archivo trasladado a carpeta de errores', {
        ...base,
        dest,
        errorFolder: this.config.errorFolder
      });
      return dest;
    } catch (e) {
      log.error('No se pudo mover archivo a carpeta de errores', {
        ...base,
        filePath,
        moveError: e.message
      });
      return null;
    }
  }

  /** Retorna la cantidad de archivos pendientes en la cola. */
  get queueLength() {
    return this._queue.length + (this._busy ? 1 : 0);
  }
}

module.exports = FileProcessor;
