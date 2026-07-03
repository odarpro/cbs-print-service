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
// =============================================================================

const fs      = require('fs');
const path    = require('path');
const logger  = require('./logger');
const printer = require('./printer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Espera a que el tamaño del archivo deje de cambiar durante `ms` milisegundos.
 * Garantiza que Oracle Forms haya terminado de escribir el archivo antes de
 * intentar leerlo (evita lecturas parciales).
 * Timeout máximo de 30 segundos para evitar bloqueos indefinidos.
 */
async function waitForFileStable(filePath, ms = 500) {
  let prevSize = -1;
  let stable   = false;
  let emptyCount = 0;
  const start  = Date.now();
  const MAX_WAIT_MS = 30000;

  while (!stable) {
    if (Date.now() - start > MAX_WAIT_MS) {
      logger.get().warn('Tiempo máximo de estabilización excedido, procesando archivo', { filePath });
      return;
    }
    await sleep(ms);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  }

  /**
   * Encola un archivo para procesamiento.
   * El procesamiento es serial (FIFO) para evitar colisiones en la impresora.
   * @param {string} filePath  Ruta completa del archivo detectado
   */
  enqueue(filePath) {
    const log = logger.get();
    log.info('Archivo encolado', { filePath });
    this._queue.push(filePath);
    this._processNext();
  }

  // ── Loop de cola ────────────────────────────────────────────────────────

  async _processNext() {
    if (this._busy || this._queue.length === 0) return;

    this._busy = true;
    const filePath = this._queue.shift();

    try {
      await this._processFile(filePath);
    } catch (err) {
      // Error ya registrado en _processFile; continuamos con el siguiente
      logger.get().error('Error no esperado en _processNext', { error: err.message });
    } finally {
      this._busy = false;
      this._processNext();   // procesar el siguiente en la cola
    }
  }

  // ── Procesamiento de un archivo ─────────────────────────────────────────

  async _processFile(filePath) {
    const log  = logger.get();
    const cfg  = this.config;

    const fileName = path.basename(filePath);
    const docType  = detectDocType(fileName);

    // Ignorar archivos que no correspondan a la convención Rec*/Val*
    if (!docType) {
      log.debug('Archivo ignorado (no es Rec* ni Val*)', { fileName });
      return;
    }

    log.info('Iniciando procesamiento', { fileName, docType });

    // 1. Esperar a que el archivo esté completamente escrito
    await waitForFileStable(filePath, cfg.fileStabilizeMs || 500);

    // 2. Verificar archivo y validar contenido (usa try-catch en vez de TOCTOU)
    let content;
    try {
      content = fs.readFileSync(filePath, { encoding: cfg.fileEncoding || 'latin1' });
    } catch (e) {
      log.warn('Archivo desapareció o no es legible antes de procesarse', { filePath, error: e.message });
      return;
    }

    if (!content || content.trim().length === 0) {
      log.warn('Archivo vacío, moviendo a errores', { filePath });
      this._moveToError(filePath, 'Archivo vacío');
      return;
    }

    // 3. Obtener configuración de la impresora según tipo de documento
    const printerCfg = cfg.printers[docType];
    if (!printerCfg || !printerCfg.name) {
      log.error('No hay impresora configurada para el tipo de documento', { docType });
      this._moveToError(filePath, 'Sin impresora configurada');
      return;
    }

    // 3. Intentar imprimir con reintentos
    const maxRetries = cfg.retryCount    || 3;
    const retryMs    = cfg.retryIntervalMs || 5000;
    let   lastError  = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await printer.printFile({
          filePath,
          printerName:  printerCfg.name,
          fileEncoding: cfg.fileEncoding || 'latin1',
          copies:       printerCfg.copies || 1,
          docTitle:     fileName,
          content,
          printMethod:  cfg.printMethod || 'DIRECT',
          bold:         printerCfg.bold || false,
          maxCharsPerLine: printerCfg.maxCharsPerLine || 40
        });

        // ── Éxito ──────────────────────────────────────────────────────
        log.info('Impresión exitosa', {
          fileName,
          docType,
          printer:  printerCfg.name,
          copies:   printerCfg.copies || 1,
          modo:     cfg.printMethod || 'DIRECT',
          attempt
        });

        this._postProcess(filePath);
        return;

      } catch (err) {
        lastError = err;
        log.warn(`Intento ${attempt}/${maxRetries} fallido`, {
          fileName,
          error: err.message
        });

        if (attempt < maxRetries) {
          await sleep(retryMs);
        }
      }
    }

    // ── Agotados los reintentos ──────────────────────────────────────────
    log.error('Archivo no pudo imprimirse tras todos los reintentos', {
      fileName,
      error: lastError ? lastError.message : 'desconocido',
      maxRetries
    });
    this._moveToError(filePath, lastError ? lastError.message : 'Error desconocido');
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

  _moveToError(filePath, reason) {
    const log = logger.get();
    try {
      const dest = moveFile(filePath, this.config.errorFolder);
      log.error('Archivo movido a carpeta de errores', { dest, reason });
    } catch (e) {
      log.error('No se pudo mover archivo a carpeta de errores', {
        filePath, reason, moveError: e.message
      });
    }
  }

  /** Retorna la cantidad de archivos pendientes en la cola. */
  get queueLength() {
    return this._queue.length + (this._busy ? 1 : 0);
  }
}

module.exports = FileProcessor;
