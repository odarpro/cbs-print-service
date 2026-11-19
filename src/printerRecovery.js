'use strict';
// =============================================================================
// printerRecovery.js  –  CBS Print Service
//
// Recupera impresoras configuradas que quedan Offline/NotAvailable/Pausada
// tras un reinicio (puerto USB no listo a tiempo). Pensado para ejecutarse
// desde CBSBootGuard (SYSTEM, Session 0) ANTES de arrancar el servicio.
//
// Diseño no bloqueante:
//   - recoverPrinters() NUNCA lanza excepción: siempre devuelve un resultado.
//   - Un fallo de recuperación no impide arrancar CBSPrintService.
//
// Secuencia por intento (menos a más invasivo):
//   1. Quitar flag WorkOffline (0x400) del registro si está activo.
//   2. Resume-Printer si la cola está en pausa.
//   3. Esperar a que el puerto USB se enumere y re-verify.
//   4. (Opcional) Tras agotar intentos: reiniciar el Spooler una vez.
// =============================================================================

const { execFile } = require('child_process');

// PRINTER_STATUS_* relevantes (PRINTER_INFO_2.Status)
const STATUS_OFFLINE       = 0x00000100;
const STATUS_NOT_AVAILABLE = 0x00002000;
const STATUS_PAUSED        = 0x00000002;
const RECOVERY_STATUS_BITS = STATUS_OFFLINE | STATUS_NOT_AVAILABLE | STATUS_PAUSED;

// PRINTER_ATTRIBUTE_WORK_OFFLINE (no confundir con 0x80000)
const ATTR_WORK_OFFLINE = 0x00000400;

const REG_PRINTERS = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers';

const DEFAULT_ATTEMPTS   = 6;
const DEFAULT_INTERVAL_MS = 5000;

/**
 * Indica si una impresora necesita recuperación (Offline/NotAvailable/Pausada).
 * Función pura: exportada para pruebas unitarias.
 *
 * @param {object|null} printer  objeto de getPrinters() o similar
 * @returns {boolean}
 */
function needsRecovery(printer) {
  if (!printer || typeof printer !== 'object') return false;

  const st = Number(printer.statusNumber) || 0;
  if ((st & RECOVERY_STATUS_BITS) !== 0) return true;

  const statuses = Array.isArray(printer.status) ? printer.status : [];
  return statuses.some(s => /^(OFFLINE|NOT.?AVAILABLE|PAUSED)$/i.test(String(s).trim()));
}

/**
 * Lista única de nombres de impresoras configuradas en config.printers.*.name.
 * Función pura: exportada para pruebas unitarias.
 *
 * @param {object|null} config
 * @returns {string[]}
 */
function configuredPrinterNames(config) {
  const names = [];
  const printers = (config && config.printers) || {};
  for (const value of Object.values(printers)) {
    if (value && value.name && !names.includes(value.name)) {
      names.push(value.name);
    }
  }
  return names;
}

/**
 * Limpia el bit PRINTER_ATTRIBUTE_WORK_OFFLINE (0x400) de un valor Attributes.
 * Función pura: exportada para pruebas unitarias.
 *
 * @param {number} attributes
 * @returns {number} valor sin el bit WorkOffline (siempre sin signo 32-bit)
 */
function clearWorkOfflineFlag(attributes) {
  const attr = (Number(attributes) || 0) >>> 0;
  return (attr & ~ATTR_WORK_OFFLINE) >>> 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultExec(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: 20000, ...opts },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          output: `${stdout || ''}${stderr || ''}`.trim()
        });
      }
    );
  });
}

/**
 * Lee el valor DWORD Attributes de la clave de registro de una impresora.
 * @returns {Promise<number|null>}
 */
async function readPrinterAttributes(printerName, exec = defaultExec) {
  const res = await exec('reg.exe', ['query', `${REG_PRINTERS}\\${printerName}`, '/v', 'Attributes']);
  if (res.code !== 0) return null;
  const m = /Attributes\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/i.exec(res.output || '');
  if (!m) return null;
  const raw = m[1];
  return raw.toLowerCase().startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10);
}

/**
 * Escribe Attributes en el registro de la impresora.
 * @returns {Promise<boolean>}
 */
async function writePrinterAttributes(printerName, value, exec = defaultExec) {
  const res = await exec('reg.exe', [
    'add',
    `${REG_PRINTERS}\\${printerName}`,
    '/v', 'Attributes',
    '/t', 'REG_DWORD',
    '/d', String(value >>> 0),
    '/f'
  ]);
  return res.code === 0;
}

/**
 * Quitar WorkOffline (0x400) si está activo. No lanza.
 * @returns {Promise<{changed: boolean, from: number|null, error?: string}>}
 */
async function clearWorkOffline(printerName, exec = defaultExec) {
  try {
    const before = await readPrinterAttributes(printerName, exec);
    if (before === null) {
      return { changed: false, from: null, error: 'Attributes no legible' };
    }
    if ((before & ATTR_WORK_OFFLINE) === 0) {
      return { changed: false, from: before };
    }
    const after = clearWorkOfflineFlag(before);
    const ok = await writePrinterAttributes(printerName, after, exec);
    return { changed: ok, from: before, to: after, error: ok ? undefined : 'reg add fallo' };
  } catch (err) {
    return { changed: false, from: null, error: err.message };
  }
}

/**
 * Resume-Printer si la cola está pausada. No lanza.
 * @returns {Promise<{resumed: boolean, error?: string}>}
 */
async function resumePrinter(printerName, exec = defaultExec) {
  try {
    const escaped = String(printerName).replace(/'/g, "''");
    const res = await exec(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Resume-Printer -Name '${escaped}' -ErrorAction Stop`],
      { timeout: 30000 }
    );
    // Resume-Printer falla con código distinto de 0 si no está pausada;
    // se trata como "no pausada" (no es un error de recuperación).
    if (res.code === 0) return { resumed: true };
    return { resumed: false, error: res.output || `code=${res.code}` };
  } catch (err) {
    return { resumed: false, error: err.message };
  }
}

/**
 * Detiene e inicia el Spooler y espera a que vuelva a RUNNING.
 * @returns {Promise<boolean>} true si volvió a estar RUNNING
 */
async function restartSpooler(exec = defaultExec, waitFn = null) {
  await exec('sc.exe', ['stop', 'Spooler']);
  // Pequeña espera para que el SCM registre la parada
  await sleep(1000);
  await exec('sc.exe', ['start', 'Spooler']);

  if (typeof waitFn === 'function') {
    return waitFn();
  }

  // Espera propia hasta 60 s
  for (let i = 0; i < 30; i++) {
    const q = await exec('sc.exe', ['query', 'Spooler']);
    if (q.code === 0 && /(?:STATE|ESTADO)\s*:\s*\d+\s+RUNNING/i.test(q.output || '')) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

/**
 * Busca el objeto impresora real (getPrinters) por nombre resuelto.
 * @returns {object|null}
 */
function findPrinterObject(jobTracker, resolvedName) {
  const printers = jobTracker.getPrinters() || [];
  const needle = String(resolvedName || '').toUpperCase();
  return printers.find(p => String(p.name || '').toUpperCase() === needle) || null;
}

/**
 * Recupera las impresoras de config que estén Offline/NotAvailable/Pausada.
 *
 * NUNCA lanza excepción. Devuelve un resultado informativo:
 *   {
 *     skipped, reason?,
 *     checked, recovered, stillOffline,
 *     spoolerRestarted, attempts,
 *     errors: string[]
 *   }
 *
 * @param {object|null} config
 * @param {object} [deps]
 *   deps.log              {Function}  log(msg, meta)
 *   deps.sleep            {Function}  inyectable para tests
 *   deps.jobTracker       {Object}    inyectable (default: require ./jobTracker)
 *   deps.exec             {Function}  inyectable (default: execFile wrapper)
 *   deps.restartSpoolerFn {Function}  inyectable para tests
 * @returns {Promise<object>}
 */
async function recoverPrinters(config, deps = {}) {
  const log        = typeof deps.log === 'function' ? deps.log : () => {};
  const doSleep    = typeof deps.sleep === 'function' ? deps.sleep : sleep;
  const exec       = typeof deps.exec === 'function' ? deps.exec : defaultExec;
  const restartFn  = deps.restartSpoolerFn;

  const result = {
    skipped: false,
    reason: null,
    checked: 0,
    recovered: 0,
    stillOffline: 0,
    spoolerRestarted: false,
    attempts: 0,
    errors: []
  };

  try {
    if (!config || config.recoverPrintersOnBoot === false) {
      result.skipped = true;
      result.reason = 'deshabilitado en config';
      return result;
    }

    let jobTracker;
    try {
      jobTracker = deps.jobTracker || require('./jobTracker');
    } catch (err) {
      result.skipped = true;
      result.reason = `jobTracker no disponible: ${err.message}`;
      log(`Recuperacion de impresoras: ${result.reason}`);
      return result;
    }

    if (!jobTracker.isAvailable || !jobTracker.isAvailable()) {
      result.skipped = true;
      result.reason = 'modulo nativo de impresion no disponible';
      log(`Recuperacion de impresoras: ${result.reason}`);
      return result;
    }

    const names = configuredPrinterNames(config);
    if (names.length === 0) {
      result.skipped = true;
      result.reason = 'sin impresoras configuradas';
      return result;
    }

    // Resolver nombres reales y objetos
    const resolvedNames = [];
    for (const name of names) {
      const real = jobTracker.resolvePrinterName(name);
      if (real && !resolvedNames.includes(real)) resolvedNames.push(real);
      if (!real) {
        result.errors.push(`impresora no encontrada: ${name}`);
        log(`Recuperacion: impresora configurada no encontrada`, { printerName: name });
      }
    }

    if (resolvedNames.length === 0) {
      result.skipped = true;
      result.reason = 'ninguna impresora configurada resolvio a una cola real';
      log(`Recuperacion de impresoras: ${result.reason}`);
      return result;
    }

    result.checked = resolvedNames.length;

    const maxAttempts = Math.max(
      1,
      Number(config.printerRecoveryAttempts) || DEFAULT_ATTEMPTS
    );
    const intervalMs = Math.max(
      1000,
      Number(config.printerRecoveryIntervalMs) || DEFAULT_INTERVAL_MS
    );
    const allowSpoolerRestart = config.restartSpoolerIfOffline !== false;

    const pending = new Set(resolvedNames);
    let firstPass = true;

    log('Recuperacion de impresoras: iniciando', {
      printers: resolvedNames,
      maxAttempts,
      intervalMs,
      restartSpoolerIfOffline: allowSpoolerRestart
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result.attempts = attempt;

      // Acciones de una sola vez (paso 1 y 2) en el primer intento
      if (firstPass) {
        for (const name of resolvedNames) {
          const wo = await clearWorkOffline(name, exec);
          if (wo.changed) {
            log(`Recuperacion: WorkOffline retirado de '${name}'`, { from: wo.from, to: wo.to });
          }
          const rs = await resumePrinter(name, exec);
          if (rs.resumed) {
            log(`Recuperacion: cola reanudada ('${name}')`);
          }
        }
        firstPass = false;
      }

      // Re-verify estado actual
      const stillPending = new Set();
      for (const name of resolvedNames) {
        const obj = findPrinterObject(jobTracker, name);
        if (!obj) {
          // No se pudo leer: la dejamos en pending por si es transitorio
          stillPending.add(name);
          continue;
        }
        if (needsRecovery(obj)) {
          stillPending.add(name);
        } else if (pending.has(name)) {
          pending.delete(name);
          result.recovered++;
          log(`Recuperacion: '${name}' disponible`, {
            attempt,
            statusNumber: obj.statusNumber,
            status: Array.isArray(obj.status) ? obj.status : undefined
          });
        }
      }

      // ¿Todas OK?
      if (pending.size === 0) {
        result.stillOffline = 0;
        log('Recuperacion de impresoras: completada', {
          checked: resolvedNames.length,
          recovered: result.recovered,
          attempts: attempt
        });
        return result;
      }

      // Quedan: esperar a que el USB/puerto se enumere
      if (attempt < maxAttempts) {
        log('Recuperacion: algunas impresoras siguen no disponibles; esperando puerto...', {
          attempt,
          maxAttempts,
          pending: [...pending]
        });
        await doSleep(intervalMs);
      }
    }

    // Agotados los intentos -> último recurso: reiniciar Spooler (una vez)
    result.stillOffline = pending.size;
    if (allowSpoolerRestart && pending.size > 0) {
      log('Recuperacion: reiniciando Spooler (ultimo recurso)', {
        pending: [...pending]
      });
      try {
        const ok = restartFn
          ? await restartFn()
          : await restartSpooler(exec);
        result.spoolerRestarted = true;
        if (!ok) {
          result.errors.push('Spooler no volvio a RUNNING tras reinicio');
          log('Recuperacion: Spooler no volvio a RUNNING');
        } else {
          // Pequeña espera post-restart para que las colas se re-inicialicen
          await doSleep(2000);
          const still = [];
          for (const name of resolvedNames) {
            const obj = findPrinterObject(jobTracker, name);
            if (obj && needsRecovery(obj)) still.push(name);
          }
          const newlyRecovered = resolvedNames.filter(n => still.includes(n) === false);
          // recalcular recovered final
          result.recovered = newlyRecovered.length;
          result.stillOffline = still.length;
          if (still.length === 0) {
            log('Recuperacion de impresoras: completada tras reinicio de Spooler', {
              checked: resolvedNames.length,
              recovered: result.recovered
            });
          } else {
            log('Recuperacion de impresoras: algunas siguen no disponibles tras reinicio de Spooler', {
              pending: still
            });
          }
        }
      } catch (err) {
        result.errors.push(`restart Spooler: ${err.message}`);
        log('Recuperacion: error reiniciando Spooler', { error: err.message });
      }
    } else if (pending.size > 0) {
      log('Recuperacion de impresoras: agotados los intentos (restart Spooler deshabilitado)', {
        pending: [...pending]
      });
    }

    if (result.stillOffline > 0) {
      log('Recuperacion de impresoras: finalizada con impresoras aun no disponibles (no bloquea el arranque)', {
        checked: resolvedNames.length,
        recovered: result.recovered,
        stillOffline: result.stillOffline,
        attempts: result.attempts
      });
    }

    return result;
  } catch (err) {
    // Nunca propagar: el servicio debe arrancar siempre.
    result.errors.push(err.message);
    try {
      log('Recuperacion de impresoras: error inesperado (no bloquea el arranque)', {
        error: err.message
      });
    } catch { /* log tampoco debe romper */ }
    return result;
  }
}

module.exports = {
  // Constantes (tests / diagnóstico)
  STATUS_OFFLINE,
  STATUS_NOT_AVAILABLE,
  STATUS_PAUSED,
  RECOVERY_STATUS_BITS,
  ATTR_WORK_OFFLINE,
  DEFAULT_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
  // Funciones puras
  needsRecovery,
  configuredPrinterNames,
  clearWorkOfflineFlag,
  // Operaciones (también usadas por tests con exec inyectado)
  readPrinterAttributes,
  writePrinterAttributes,
  clearWorkOffline,
  resumePrinter,
  restartSpooler,
  findPrinterObject,
  // Orquestación principal (nunca lanza)
  recoverPrinters
};
