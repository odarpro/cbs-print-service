'use strict';
// =============================================================================
// jobTracker.js  –  CBS Print Service
//
// Seguimiento y cancelación de trabajos en la cola de Windows.
//
// Objetivo: que el servicio NUNCA deje un trabajo huérfano en el spooler.
//   - Genera nombres de documento únicos con prefijo "CBSPrint|" para poder
//     identificar los trabajos propios sin tocar los de otras aplicaciones.
//   - Sonda la cola de la impresora hasta que el trabajo desaparece.
//   - Si el trabajo no sale de la cola en el timeout, lo elimina (DELETE).
//   - Permite cancelar el trabajo activo durante el apagado del servicio.
//
// Sin llamadas a cmd.exe ni powershell: usa @tbalegas/node-printer.
// =============================================================================

const logger = require('./logger');

// ---------------------------------------------------------------------------
// Carga del módulo nativo (puede no estar disponible en Linux/CI)
// ---------------------------------------------------------------------------
let nativePrinter = null;
try {
  nativePrinter = require('@tbalegas/node-printer');
} catch {
  nativePrinter = null;
}

const PREFIX = 'CBSPrint|';
const DEFAULT_POLL_MS = 500;
const DEFAULT_APPEAR_GRACE_MS = 3000;

const JOB_STATUS_PRINTED = 0x00000080;

/**
 * Error lanzado cuando el apagado del servicio cancela una impresión en curso.
 */
class JobAbortedError extends Error {
  constructor(message = 'Impresión cancelada durante el apagado del servicio.') {
    super(message);
    this.name = 'JobAbortedError';
    this.code = 'CBS_JOB_ABORTED';
  }
}

/**
 * Construye un nombre de documento único e identificable.
 * Formato: CBSPrint|<timestamp-base36>|<aleatorio>|<archivo>
 *
 * La clave única va al principio para que siga siendo reconocible incluso si
 * el driver/spooler truncara el nombre del documento.
 *
 * @param {string} docTitle
 * @returns {string}
 */
function makeDocumentName(docTitle) {
  const safe = String(docTitle || 'documento')
    .replace(/[|\r\n]/g, '_')
    .slice(0, 120);
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${PREFIX}${stamp}|${random}|${safe}`;
}

/**
 * Extrae la clave corta y única de un nombre generado por makeDocumentName.
 * Se usa para localizar el trabajo en la cola sin depender del nombre completo.
 * @param {string} documentName
 * @returns {string}
 */
function makeJobKey(documentName) {
  const name = String(documentName || '');
  if (!name.startsWith(PREFIX)) return name;

  const parts = name.slice(PREFIX.length).split('|');
  if (parts.length >= 2) {
    return `${PREFIX}${parts[0]}|${parts[1]}`;
  }
  return name;
}

/**
 * Indica si un documento pertenece al CBS Print Service.
 * @param {string} document
 * @returns {boolean}
 */
function isCbsDocument(document) {
  return String(document || '').startsWith(PREFIX);
}

/**
 * Detecta nombres de trabajos generados por versiones anteriores del servicio
 * (antes de existir el prefijo CBSPrint|). Solo se usa bajo pedido explícito.
 * @param {string} document
 * @returns {boolean}
 */
function matchesLegacyCbsDocument(document) {
  const doc = String(document || '').trim();
  if (!doc) return false;
  if (doc === 'Recibo') return true;
  return /^(rec|val).*\.txt(?: \(copia \d+\/\d+\))?$/i.test(doc);
}

/**
 * Indica si el módulo nativo de impresión está disponible.
 * @returns {boolean}
 */
function isAvailable() {
  return !!nativePrinter;
}

/**
 * Devuelve la lista de impresoras instaladas.
 * @returns {Array<object>}
 */
function getPrinters() {
  if (!nativePrinter) return [];
  try {
    return nativePrinter.getPrinters() || [];
  } catch {
    return [];
  }
}

/**
 * Resuelve un nombre parcial de impresora al nombre real instalado.
 * @param {string} partialName
 * @returns {string|null}
 */
function resolvePrinterName(partialName) {
  const needle = String(partialName || '').trim().toUpperCase();
  if (!needle) return null;

  const printers = getPrinters();
  const exact = printers.find(p => String(p.name || '').toUpperCase() === needle);
  if (exact) return exact.name;

  const partial = printers.find(p => String(p.name || '').toUpperCase().includes(needle));
  return partial ? partial.name : null;
}

/**
 * Lista los trabajos activos de una impresora.
 * @param {string} printerName  Nombre real de la impresora
 * @returns {Array<object>}
 */
function listJobs(printerName) {
  if (!nativePrinter || !printerName) return [];
  try {
    const info = nativePrinter.getPrinter(printerName);
    const jobs = info && Array.isArray(info.jobs) ? info.jobs : [];
    return jobs.filter(job => job && typeof job === 'object' && !job.error);
  } catch {
    return [];
  }
}

/**
 * Normaliza el matcher: string (prefijo) o función.
 * @param {string|Function} matcher
 * @returns {Function}
 */
function toMatcher(matcher) {
  if (typeof matcher === 'function') return matcher;
  const prefix = String(matcher || '');
  // Un prefijo vacío coincidiría con TODOS los trabajos: nunca es seguro.
  if (!prefix) return () => false;
  return document => String(document || '').startsWith(prefix);
}

/**
 * Busca trabajos que coincidan con el matcher.
 * @param {string} printerName
 * @param {string|Function} matcher
 * @returns {Array<object>}
 */
function findMatchingJobs(printerName, matcher) {
  const test = toMatcher(matcher);
  return listJobs(printerName).filter(job => test(job.document));
}

/**
 * Elimina un trabajo de la cola.
 * @param {string} printerName
 * @param {number} jobId
 * @returns {boolean}
 */
function deleteJob(printerName, jobId) {
  if (!nativePrinter) return false;
  try {
    return nativePrinter.setJob(printerName, Number(jobId), 'DELETE') === true;
  } catch {
    return false;
  }
}

/**
 * Elimina todos los trabajos que coincidan con el matcher.
 * @param {string} printerName
 * @param {string|Function} matcher
 * @returns {{found: number, deleted: number, jobs: Array<object>}}
 */
function deleteMatchingJobs(printerName, matcher) {
  const jobs = findMatchingJobs(printerName, matcher);
  let deleted = 0;

  for (const job of jobs) {
    if (deleteJob(printerName, job.id)) deleted++;
  }

  return { found: jobs.length, deleted, jobs };
}

/**
 * Limpia trabajos del CBS Print Service en una impresora.
 * @param {string} printerName
 * @param {object} [opts]
 *   opts.includeLegacy {boolean}  Incluir nombres de versiones anteriores
 * @returns {{found: number, deleted: number, jobs: Array<object>}}
 */
function cleanupCbsJobs(printerName, opts = {}) {
  const matcher = opts.includeLegacy
    ? document => isCbsDocument(document) || matchesLegacyCbsDocument(document)
    : isCbsDocument;
  return deleteMatchingJobs(printerName, matcher);
}

/**
 * Obtiene los estados de un trabajo como array de strings.
 * @param {object} job
 * @returns {string[]}
 */
function jobStatuses(job) {
  if (!job) return [];
  if (Array.isArray(job.status)) return job.status.map(s => String(s).toUpperCase());
  if (job.status) return [String(job.status).toUpperCase()];
  return [];
}

function isJobFinished(job) {
  const statuses = jobStatuses(job);
  if (statuses.some(s => ['PRINTED', 'COMPLETE', 'RETAINED', 'DELETED', 'DELETING'].includes(s))) {
    return true;
  }
  return (Number(job.statusNumber || 0) & JOB_STATUS_PRINTED) !== 0;
}

function isJobBlocked(job) {
  const statuses = jobStatuses(job);
  return statuses.some(s => [
    'ERROR',
    'OFFLINE',
    'PAPEROUT',
    'USER-INTERVENTION',
    'BLOCKED-DEVQ'
  ].includes(s));
}

/**
 * Describe brevemente los trabajos para el log.
 * @param {Array<object>} jobs
 * @returns {Array<object>}
 */
function describeJobs(jobs) {
  return (jobs || []).map(job => ({
    id: job.id,
    document: job.document,
    status: jobStatuses(job).join(',') || String(job.statusNumber || 0)
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Espera a que los trabajos que coincidan con el matcher desaparezcan de la cola.
 *
 * Resultados posibles:
 *   - { outcome: 'cleared' }    El trabajo apareció y salió de la cola.
 *   - { outcome: 'printed' }    El trabajo quedó retenido pero figura impreso.
 *   - { outcome: 'not-seen' }   No se vio el trabajo (impreso muy rápido / no spooled).
 *   - { outcome: 'blocked' }    Estado de error/offline: se canceló de inmediato.
 *   - { outcome: 'timeout' }    No salió de la cola: se canceló al vencer.
 *
 * Si `signal` se aborta, elimina los trabajos y lanza JobAbortedError.
 *
 * @param {string} printerName
 * @param {string|Function} matcher
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function waitForJobsToClear(printerName, matcher, options = {}) {
  const {
    timeoutMs = 60000,
    pollMs = DEFAULT_POLL_MS,
    appearGraceMs = DEFAULT_APPEAR_GRACE_MS,
    signal = null,
    onSeen = null
  } = options;

  const start = Date.now();
  const deadline = start + Math.max(1000, Number(timeoutMs) || 60000);
  const seenIds = new Set();
  let seen = false;
  let lastJobs = [];

  while (true) {
    if (signal && signal.aborted) {
      const canceled = deleteMatchingJobs(printerName, matcher);
      throw new JobAbortedError(
        `Impresión cancelada durante el apagado; trabajos eliminados: ${canceled.deleted}.`
      );
    }

    const jobs = findMatchingJobs(printerName, matcher);

    if (jobs.length > 0) {
      seen = true;
      lastJobs = jobs;

      if (typeof onSeen === 'function') {
        const newJobs = jobs.filter(job => !seenIds.has(job.id));
        if (newJobs.length > 0) {
          newJobs.forEach(job => seenIds.add(job.id));
          try {
            onSeen(jobs);
          } catch {
            // El callback de seguimiento nunca debe romper la impresión.
          }
        }
      }

      if (jobs.every(isJobFinished)) {
        return {
          outcome: 'printed',
          jobs,
          elapsedMs: Date.now() - start
        };
      }

      if (jobs.some(isJobBlocked)) {
        const canceled = deleteMatchingJobs(printerName, matcher);
        return {
          outcome: 'blocked',
          jobs,
          canceled: canceled.deleted,
          elapsedMs: Date.now() - start
        };
      }
    } else if (seen) {
      return {
        outcome: 'cleared',
        jobs: lastJobs,
        elapsedMs: Date.now() - start
      };
    } else if (Date.now() - start >= appearGraceMs) {
      return {
        outcome: 'not-seen',
        jobs: [],
        elapsedMs: Date.now() - start
      };
    }

    if (Date.now() >= deadline) {
      const canceled = deleteMatchingJobs(printerName, matcher);
      return {
        outcome: 'timeout',
        jobs: lastJobs,
        canceled: canceled.deleted,
        elapsedMs: Date.now() - start
      };
    }

    const remaining = deadline - Date.now();
    await sleep(Math.max(50, Math.min(pollMs, remaining)));
  }
}

module.exports = {
  PREFIX,
  JobAbortedError,
  makeDocumentName,
  makeJobKey,
  isCbsDocument,
  matchesLegacyCbsDocument,
  isAvailable,
  getPrinters,
  resolvePrinterName,
  listJobs,
  findMatchingJobs,
  deleteJob,
  deleteMatchingJobs,
  cleanupCbsJobs,
  jobStatuses,
  isJobFinished,
  isJobBlocked,
  describeJobs,
  waitForJobsToClear
};
