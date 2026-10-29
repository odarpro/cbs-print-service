'use strict';
// =============================================================================
// boot-guard.js  –  CBS Print Service
//
// Se ejecuta al arrancar Windows mediante la tarea programada CBSBootGuard.
//   1. Espera a que el servicio Spooler esté RUNNING.
//   2. Espera a que el disco/carpeta de trabajo esté disponible.
//   3. Limpia trabajos CBS huérfanos del spooler.
//   4. Elimina .txt pendientes (Rec*/Val*) del watchFolder.
//   5. Arranca el servicio CBSPrintService si no está RUNNING.
//
// Log: C:\ProgramData\CBSPrintService\boot-guard.log
// =============================================================================

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const jobTracker = require('../src/jobTracker');

const SERVICE_KEY = 'cbsprintservice';
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const LOG_DIR = path.join(PROGRAM_DATA, 'CBSPrintService');
const LOG_PATH = path.join(LOG_DIR, 'boot-guard.log');
const MAX_LOG_BYTES = 1024 * 1024;

const WAIT_TIMEOUT_MS = 180000;
const WAIT_POLL_MS = 3000;

function rotateLog() {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > MAX_LOG_BYTES) {
      const old = `${LOG_PATH}.old`;
      try { fs.unlinkSync(old); } catch {}
      fs.renameSync(LOG_PATH, old);
    }
  } catch {}
}

function log(message, meta) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateLog();
    const detail = meta ? ` | ${JSON.stringify(meta)}` : '';
    fs.appendFileSync(
      LOG_PATH,
      `[${new Date().toISOString()}] [pid ${process.pid}] ${message}${detail}\n`,
      'utf8'
    );
  } catch {
    // Sin log no hay nada más que hacer.
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runSc(args) {
  return new Promise(resolve => {
    execFile('sc.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code || 1) : 0,
        output: `${stdout || ''}${stderr || ''}`.trim()
      });
    });
  });
}

async function isServiceRunning(name) {
  const res = await runSc(['query', name]);
  if (res.code !== 0) return false;
  return /(?:STATE|ESTADO)\s*:\s*\d+\s*RUNNING/i.test(res.output) || /\bRUNNING\b/.test(res.output);
}

async function waitFor(description, condition, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (await condition()) {
        log(`${description}: OK`);
        return true;
      }
    } catch (err) {
      log(`${description}: error al comprobar`, { error: err.message });
    }
    await sleep(WAIT_POLL_MS);
  }

  log(`${description}: tiempo de espera agotado`, { timeoutMs });
  return false;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No se encontró ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function waitForSpooler() {
  return waitFor('Spooler disponible', async () => {
    if (await isServiceRunning('Spooler')) return true;
    await runSc(['start', 'Spooler']);
    return false;
  });
}

function waitForWatchFolder(watchFolder) {
  if (!watchFolder) {
    log('watchFolder no está configurado; se omite la espera del disco');
    return Promise.resolve(false);
  }

  const root = path.parse(watchFolder).root || path.dirname(watchFolder);

  return waitFor(`Carpeta de trabajo disponible (${watchFolder})`, async () => {
    if (!fs.existsSync(root)) return false;

    // Si la carpeta aún no existe, intentar crearla; si el disco no está
    // montado, mkdir fallará y se reintentará en la siguiente vuelta.
    if (!fs.existsSync(watchFolder)) {
      fs.mkdirSync(watchFolder, { recursive: true });
    }
    return fs.existsSync(watchFolder);
  });
}

function cleanupStaleJobs(config) {
  if (!jobTracker.isAvailable()) {
    log('Módulo nativo no disponible; no se pueden limpiar jobs del spooler');
    return;
  }

  const printers = config.printers || {};
  const names = [];
  for (const value of Object.values(printers)) {
    if (value && value.name && !names.includes(value.name)) names.push(value.name);
  }

  const includeLegacy = config.cleanupLegacyCbsJobs === true;

  for (const name of names) {
    const resolved = jobTracker.resolvePrinterName(name);
    if (!resolved) {
      log('Impresora configurada no encontrada', { printerName: name });
      continue;
    }

    try {
      const result = jobTracker.cleanupCbsJobs(resolved, { includeLegacy });
      log('Limpieza de jobs CBS', {
        printerName: resolved,
        includeLegacy,
        found: result.found,
        deleted: result.deleted,
        jobs: jobTracker.describeJobs(result.jobs)
      });
    } catch (err) {
      log('No se pudieron limpiar jobs CBS', { printerName: resolved, error: err.message });
    }
  }
}

function deletePendingFiles(config) {
  if (config.deletePendingOnStartup === false) {
    log('Limpieza de pendientes deshabilitada por configuración');
    return;
  }

  const watchFolder = config.watchFolder;
  if (!watchFolder || !fs.existsSync(watchFolder)) {
    log('No se pueden eliminar pendientes: watchFolder no disponible', { watchFolder });
    return;
  }

  let deleted = 0;
  const failed = [];

  let entries;
  try {
    entries = fs.readdirSync(watchFolder, { withFileTypes: true });
  } catch (err) {
    log('No se pudo leer watchFolder', { watchFolder, error: err.message });
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const base = entry.name.toLowerCase();
    if (!base.endsWith('.txt')) continue;
    if (!base.startsWith('rec') && !base.startsWith('val')) continue;

    try {
      fs.unlinkSync(path.join(watchFolder, entry.name));
      deleted++;
    } catch (err) {
      failed.push({ file: entry.name, error: err.message });
    }
  }

  log('Limpieza de archivos pendientes', { watchFolder, deleted, failed });
}

async function ensureServiceRunning() {
  if (await isServiceRunning(SERVICE_KEY)) {
    log('Servicio ya está RUNNING');
    return true;
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    log(`Iniciando servicio (intento ${attempt}/5)`);
    await runSc(['start', SERVICE_KEY]);
    await sleep(3000);
    if (await isServiceRunning(SERVICE_KEY)) {
      log('Servicio iniciado correctamente');
      return true;
    }
  }

  log('No se pudo iniciar el servicio tras 5 intentos');
  return false;
}

async function main() {
  log('Boot-guard iniciado');

  let config = null;
  try {
    config = loadConfig();
    log('config.json cargado');
  } catch (err) {
    log('No se pudo cargar config.json; se continuará con lo mínimo', { error: err.message });
  }

  await waitForSpooler();

  if (config) {
    await waitForWatchFolder(config.watchFolder);
    cleanupStaleJobs(config);
    deletePendingFiles(config);
  }

  await ensureServiceRunning();
  log('Boot-guard finalizado');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    log('Boot-guard terminó con error', { error: err.message, stack: err.stack });
    process.exit(1);
  });
