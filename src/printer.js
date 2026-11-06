'use strict';
// =============================================================================
// printer.js  –  CBS Print Service
//
// Envía archivos de texto a impresoras matriciales.
//
// Método principal (nativo):
//   Usa @tbalegas/node-printer para invocar WritePrinter (Winspool API)
//   directamente — sin cmd.exe, powershell ni procesos externos.
//
// El módulo nativo es obligatorio: no hay fallback por PowerShell.
// Si no está disponible, printFile falla con un error explícito para no
// enviar trabajos por una ruta distinta a RAW.
//
// Compatibilidad: Windows 10 / Windows 11, Node.js >= 18 LTS.
//
// Dependencia nativa:
//   npm install @tbalegas/node-printer
// =============================================================================

const fs       = require('fs');
const path     = require('path');
const logger   = require('./logger');
const gdiPrint = require('./gdiPrinter');
const jobTracker = require('./jobTracker');

// ---------------------------------------------------------------------------
// Carga del módulo nativo.
// Si no está instalado, nativePrinter queda null y printFile falla.
// ---------------------------------------------------------------------------
let nativePrinter;
try {
  nativePrinter = require('@tbalegas/node-printer');
} catch (e) {
  // En Linux/CI el módulo nativo no compila; usamos stub para pruebas unitarias.
  nativePrinter = null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// Flags PRINTER_STATUS_* considerados bloqueantes.
// LEGACY: lista original (v3.2.2) — solo offline/error/papelería.
// STRICT: lista ampliada (v3.2.6) — 14 flags que impiden imprimir.
const LEGACY_BLOCKING = [
  [0x00000080, 'Impresora offline.'],
  [0x00000002, 'Impresora en estado de error.'],
  [0x00000020, 'Impresora sin papel.']
];

const STRICT_BLOCKING = [
  [0x00000001, 'Impresora en pausa.'],
  [0x00000002, 'Impresora en estado de error.'],
  [0x00000004, 'Impresora pendiente de eliminación.'],
  [0x00000008, 'Atasco de papel.'],
  [0x00000010, 'Impresora sin papel.'],
  [0x00000040, 'Problema de papel.'],
  [0x00000080, 'Impresora offline.'],
  [0x00000800, 'Bandeja de salida llena.'],
  [0x00001000, 'Impresora no disponible.'],
  [0x00040000, 'Impresora sin tóner.'],
  [0x00100000, 'Requiere intervención del usuario.'],
  [0x00200000, 'Impresora sin memoria.'],
  [0x00400000, 'Puerta abierta.'],
  [0x00800000, 'Servidor de impresión desconocido.']
];

/**
 * Evalúa el estado de una impresora contra la lista de flags bloqueantes.
 * Función pura: exportada para pruebas unitarias.
 *
 * @param {number} statusNumber  PRINTER_INFO_2.Status
 * @param {boolean} [strict=false]  true = lista estricta (14 flags),
 *                                  false = tolerancia legacy (3 flags)
 * @returns {{ok: boolean, reason: string, flag: number}}
 */
function evaluateStatus(statusNumber, strict = false) {
  const st = Number(statusNumber) || 0;
  const list = strict ? STRICT_BLOCKING : LEGACY_BLOCKING;
  const blocking = list.find(([flag]) => (st & flag) !== 0);
  if (blocking) {
    return { ok: false, reason: blocking[1], flag: blocking[0] };
  }
  return { ok: true, reason: 'OK', flag: 0 };
}

/**
 * Describe el estado real de la impresora para diagnóstico (log/errores).
 * @param {object} printer  objeto devuelto por getPrinters()
 * @param {number} statusNumber
 * @returns {string} ej. "status=0x1000, puerto=USB001, estado=[OFFLINE]"
 */
function describePrinterState(printer, statusNumber) {
  const parts = [`status=0x${(Number(statusNumber) || 0).toString(16).toUpperCase().padStart(4, '0')}`];
  if (printer && printer.portName) parts.push(`puerto=${printer.portName}`);
  if (printer && printer.driverName) parts.push(`driver=${printer.driverName}`);
  if (printer && Array.isArray(printer.status) && printer.status.length) {
    parts.push(`estado=[${printer.status.join(',')}]`);
  }
  if (printer && Array.isArray(printer.attributes) && printer.attributes.length) {
    parts.push(`atributos=[${printer.attributes.join(',')}]`);
  }
  return parts.join(', ');
}

/**
 * Obtiene la información completa de una impresora por nombre parcial,
 * incluyendo su nombre real y estado. Una sola llamada a getPrinters().
 * @param {string} partialName
 * @param {boolean} [strict=false]  true = lista estricta de flags bloqueantes
 * @returns {{ resolvedName: string|null, status: { ok: boolean, reason: string } }}
 */
function getPrinterInfo(partialName, strict = false) {
  if (!nativePrinter) {
    return { resolvedName: null, status: { ok: false, reason: 'Módulo nativo de impresión no disponible.' } };
  }

  const installed = nativePrinter.getPrinters();
  const needle    = String(partialName || '').trim().toUpperCase();

  if (!needle) {
    return { resolvedName: null, status: { ok: false, reason: 'Nombre de impresora vacío.' } };
  }

  // Coincidencia exacta primero (evita resolver "Recibos" a "Recibos 2").
  let printer = installed.find(p => String(p.name || '').toUpperCase() === needle);
  if (!printer) {
    printer = installed.find(p => String(p.name || '').toUpperCase().includes(needle));
  }

  if (!printer) {
    return { resolvedName: null, status: { ok: false, reason: `Impresora "${partialName}" no encontrada en el sistema.` } };
  }

  const st = printer.statusNumber || 0;
  const result = evaluateStatus(st, strict);

  if (!result.ok) {
    // Detalle real (status hex, puerto, flags) para diagnosticar sin tocar código.
    const detail = describePrinterState(printer, st);
    return {
      resolvedName: printer.name,
      status: { ok: false, reason: `${result.reason} (${detail})` }
    };
  }

  return { resolvedName: printer.name, status: { ok: true, reason: 'OK' } };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Imprime un archivo de texto en la impresora indicada usando Winspool (Win32).
 * No invoca ningún proceso externo.
 *
 * @param {object} opts
 *   opts.filePath      {string}  Ruta completa del archivo .txt
 *   opts.printerName   {string}  Nombre parcial o completo de la impresora
 *   opts.fileEncoding  {string}  Codificación del archivo (default 'latin1')
 *   opts.copies        {number}  Número de copias (default 1)
 *   opts.docTitle      {string}  Título del trabajo de impresión (opcional)
 *
 * @returns {Promise<void>}  Resuelve si éxito, rechaza con Error si fallo.
 */
function assertNotAborted(signal) {
  if (signal && signal.aborted) {
    throw new jobTracker.JobAbortedError();
  }
}

/**
 * Resuelve y valida la impresora antes de crear cualquier trabajo.
 * @param {string} printerName
 * @param {boolean} [strict=false]  lista estricta de flags bloqueantes
 * @returns {string} Nombre real
 */
function resolveAndValidatePrinter(printerName, strict = false) {
  const { resolvedName, status } = getPrinterInfo(printerName, strict);
  if (!resolvedName) {
    throw new Error(`Impresora "${printerName}" no está instalada en este equipo.`);
  }
  if (!status.ok) {
    throw new Error(`Impresora "${resolvedName}": ${status.reason}`);
  }
  return resolvedName;
}

async function printFile(opts) {
  const {
    filePath,
    printerName,
    fileEncoding = 'latin1',
    copies       = 1,
    docTitle     = path.basename(filePath),
    content: preloadedContent,
    printMethod  = 'DIRECT',
    bold         = false,
    maxCharsPerLine = 40,
    fontName,
    fontSize,
    gdiTimeoutMs,
    classicTimeoutMs,
    directTimeoutMs,
    strictStatusCheck = false,
    signal = null,
    onJobStarted = null
  } = opts;

  const log = logger.get();
  assertNotAborted(signal);
  const strict = strictStatusCheck === true;

  // Usar contenido pre-cargado (desde fileProcessor) o leerlo directamente
  const content = preloadedContent || (() => {
    try {
      return fs.readFileSync(filePath, { encoding: fileEncoding });
    } catch (e) {
      throw new Error(`Archivo no encontrado o no legible: ${filePath} — ${e.message}`);
    }
  })();

  // 2. Aplicar modo según configuración
  const method = String(printMethod || 'DIRECT').toUpperCase();

  if (method === 'GDI') {
    const resolvedName = resolveAndValidatePrinter(printerName, strict);
    const timeoutMs = gdiTimeoutMs || 60000;
    const documentName = jobTracker.makeDocumentName(docTitle);
    const jobKey = jobTracker.makeJobKey(documentName);

    if (typeof onJobStarted === 'function') {
      onJobStarted({ printerName: resolvedName, documentName: jobKey, jobId: null });
    }

    try {
      await gdiPrint.printGdi(content, {
        printerName: resolvedName,
        maxCharsPerLine,
        bold,
        fontName,
        fontSize,
        copies,
        docTitle: documentName,
        timeoutMs,
        signal
      });

      const queueResult = await jobTracker.waitForJobsToClear(resolvedName, jobKey, {
        timeoutMs,
        signal,
        onSeen: (jobs) => {
          if (typeof onJobStarted === 'function') {
            onJobStarted({
              printerName: resolvedName,
              documentName: jobKey,
              jobId: jobs && jobs[0] ? jobs[0].id : null
            });
          }
        }
      });

      if (queueResult.outcome === 'timeout' || queueResult.outcome === 'blocked') {
        throw new Error(
          `Modo GDI real: el trabajo quedó atascado en la cola (${queueResult.outcome}); ` +
          'se canceló para no bloquear la impresora.'
        );
      }
    } catch (err) {
      jobTracker.deleteMatchingJobs(resolvedName, jobKey);
      throw err;
    }
    return;
  }

  if (method === 'CLASSIC' || method === 'C') {
    const classicPrinter = require('./classicPrinter');
    const resolvedName = resolveAndValidatePrinter(printerName, strict);

    await classicPrinter.printClassic(content, {
      printerName:    resolvedName,
      fontName,
      fontSize,
      bold,
      maxCharsPerLine,
      fileEncoding,
      copies,
      docTitle,
      signal,
      onJobStarted,
      timeoutMs: classicTimeoutMs || 60000
    });
    return;
  }

  log.debug('Modo DIRECT aplicado');

  // 3. Resolver nombre real de impresora y verificar estado (una sola llamada)
  const resolvedName = resolveAndValidatePrinter(printerName, strict);
  const timeoutMs = directTimeoutMs || 60000;

  // Convertir a Buffer con la codificación correcta para Winspool
  const dataBuffer = Buffer.from(content, fileEncoding);
  const documentName = jobTracker.makeDocumentName(docTitle);
  const jobKey = jobTracker.makeJobKey(documentName);

  log.debug('Iniciando impresión', {
    filePath,
    resolvedName,
    copies,
    printMethod,
    documentName,
    timeoutMs
  });

  // 4. Enviar al spooler — copias secuenciales, esperando cada trabajo.
  if (nativePrinter) {
    try {
      for (let i = 0; i < copies; i++) {
        assertNotAborted(signal);

        const copyDocName = copies > 1
          ? `${documentName} (copia ${i + 1}/${copies})`
          : documentName;

        if (typeof onJobStarted === 'function') {
          onJobStarted({ printerName: resolvedName, documentName: jobKey, jobId: null });
        }

        const jobId = await new Promise((resolve, reject) => {
          try {
            nativePrinter.printDirect({
              data:       dataBuffer,
              printer:    resolvedName,
              docname:    copyDocName,
              type:       'RAW',
              success:    (res) => resolve(res),
              error:      (err) => reject(new Error(`Error en copia ${i + 1}: ${err}`))
            });
          } catch (err) {
            reject(err);
          }
        });

        if (typeof onJobStarted === 'function') {
          onJobStarted({
            printerName: resolvedName,
            documentName: jobKey,
            jobId: jobId || null
          });
        }

        log.info('Copia enviada al spooler', {
          copia: i + 1,
          copies,
          resolvedName,
          printMethod,
          jobId: jobId || null,
          documentName
        });

        const queueResult = await jobTracker.waitForJobsToClear(resolvedName, jobKey, {
          timeoutMs,
          signal,
          onSeen: (jobs) => {
            if (typeof onJobStarted === 'function') {
              onJobStarted({
                printerName: resolvedName,
                documentName: jobKey,
                jobId: jobs && jobs[0] ? jobs[0].id : jobId || null
              });
            }
          }
        });

        if (queueResult.outcome === 'timeout' || queueResult.outcome === 'blocked') {
          throw new Error(
            `Modo DIRECT: el trabajo quedó atascado en la cola (${queueResult.outcome}); ` +
            'se canceló para no bloquear la impresora.'
          );
        }
      }
    } catch (err) {
      jobTracker.deleteMatchingJobs(resolvedName, jobKey);
      throw err;
    }
  } else {
    throw new Error(
      'El módulo nativo @tbalegas/node-printer no está disponible. ' +
      'Reinstale las dependencias antes de imprimir.'
    );
  }

  log.info('Impresión completada', { filePath, resolvedName, copies, printMethod });
}

/**
 * Lista las impresoras instaladas en el equipo (para diagnóstico).
 * @returns {Array<{name: string, status: string}>}
 */
function listPrinters() {
  if (!nativePrinter) return [];
  return nativePrinter.getPrinters().map(p => ({
    name:   p.name,
    status: p.statusNumber === 0 ? 'OK' : `status=${p.statusNumber}`
  }));
}

module.exports = { printFile, listPrinters, getPrinterInfo, evaluateStatus };
