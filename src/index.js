'use strict';
// =============================================================================
// index.js  –  CBS Print Service
//
// Punto de entrada del servicio.
// Puede ejecutarse de dos formas:
//   A) node src/index.js              → Modo consola (desarrollo/diagnóstico)
//   B) Como Windows Service instalado → gestionado por node-windows / SCM
//
// Arranque robusto:
//   - Deja rastro en C:\ProgramData\CBSPrintService\startup.log desde el
//     primer instante (antes de cargar config/logger).
//   - Limpia trabajos CBS huérfanos del spooler y .txt pendientes al arrancar.
//   - Apagado ordenado: deja de aceptar archivos, drena la cola y, si no
//     termina a tiempo, cancela el trabajo activo y limpia la cola.
// =============================================================================

const fs       = require('fs');
const path     = require('path');
const logger   = require('./logger');
const watcher  = require('./watcher');
const notifier = require('./notifier');
const jobTracker = require('./jobTracker');
const { migrateConfig } = require('./configMigration');

// ---------------------------------------------------------------------------
// Rutas base y log de arranque (independiente de config.json)
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const HEALTH_CHECK_PATH = path.join(__dirname, '..', 'healthcheck.json');

const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const BOOTSTRAP_DIR = path.join(PROGRAM_DATA, 'CBSPrintService');
const BOOTSTRAP_LOG = path.join(BOOTSTRAP_DIR, 'startup.log');
const MAX_BOOTSTRAP_LOG_BYTES = 1024 * 1024;

function rotateBootstrapLog() {
  try {
    if (fs.existsSync(BOOTSTRAP_LOG) && fs.statSync(BOOTSTRAP_LOG).size > MAX_BOOTSTRAP_LOG_BYTES) {
      const old = `${BOOTSTRAP_LOG}.old`;
      try { fs.unlinkSync(old); } catch {}
      fs.renameSync(BOOTSTRAP_LOG, old);
    }
  } catch {
    // La rotación nunca debe impedir el arranque.
  }
}

/**
 * Escribe una línea en el log de arranque. No usa el logger de la app para
 * poder registrar fallos ocurridos antes de que exista config.json/logger.
 */
function bootstrapLog(message, err) {
  try {
    fs.mkdirSync(BOOTSTRAP_DIR, { recursive: true });
    rotateBootstrapLog();
    const detail = err
      ? ` | ${err.stack || err.message || String(err)}`
      : '';
    const line = `[${new Date().toISOString()}] [pid ${process.pid}] ${message}${detail}\n`;
    fs.appendFileSync(BOOTSTRAP_LOG, line, 'utf8');
  } catch {
    // Si ni siquiera se puede escribir aquí, no hay nada más que hacer.
  }
}

let log = null;
let folderWatcher = null;
let healthTimer = null;
let shuttingDown = false;

function appLog(level, message, meta) {
  try {
    if (log) log[level](message, meta);
  } catch {
    // Un fallo del logger no debe tumbar el servicio.
  }
}

// ---------------------------------------------------------------------------
// Health check: archivo de estado para monitoreo externo
// ---------------------------------------------------------------------------

function updateHealthCheck(status) {
  try {
    const data = JSON.stringify({
      status,
      pid:       process.pid,
      uptime:    process.uptime(),
      queue:     folderWatcher ? folderWatcher.queueLength : 0,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(HEALTH_CHECK_PATH, data, 'utf8');
  } catch {
    // Si falla la escritura del health check no debe romper el servicio
  }
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No se encontró config.json en ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config.json inválido: ${e.message}`);
  }

  const changes = migrateConfig(config);
  if (changes.length > 0) {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
      bootstrapLog(`config.json migrado: ${changes.map(change => change.key).join(', ')}`);
    } catch (err) {
      bootstrapLog('No se pudo guardar config.json migrado; se usará en memoria', err);
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Limpieza de trabajos huérfanos al arrancar
// ---------------------------------------------------------------------------

async function cleanupStaleJobs(config) {
  if (!jobTracker.isAvailable()) {
    appLog('warn', 'Módulo nativo no disponible: no se pueden limpiar jobs del spooler al arrancar');
    return;
  }

  const configured = [];
  const printers = config && config.printers ? config.printers : {};
  for (const value of Object.values(printers)) {
    if (value && value.name && !configured.includes(value.name)) {
      configured.push(value.name);
    }
  }

  if (configured.length === 0) {
    appLog('info', 'No hay impresoras configuradas para limpiar jobs al arrancar');
    return;
  }

  const includeLegacy = config.cleanupLegacyCbsJobs === true;

  for (const name of configured) {
    const resolved = jobTracker.resolvePrinterName(name);
    if (!resolved) {
      appLog('warn', 'Impresora configurada no encontrada al limpiar jobs', { printerName: name });
      continue;
    }

    try {
      const result = jobTracker.cleanupCbsJobs(resolved, { includeLegacy });
      appLog('info', 'Limpieza de jobs CBS al arrancar', {
        printerName: resolved,
        includeLegacy,
        found: result.found,
        deleted: result.deleted,
        jobs: jobTracker.describeJobs(result.jobs)
      });
    } catch (err) {
      appLog('warn', 'No se pudieron limpiar jobs CBS al arrancar', {
        printerName: resolved,
        error: err.message
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function bootstrap() {
  bootstrapLog('Proceso iniciado');

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    bootstrapLog('No se pudo cargar config.json', err);
    console.error(`[CBS Print Service] ERROR: ${err.message}`);
    process.exit(1);
    return;
  }

  try {
    logger.init(config);
    log = logger.get();
    bootstrapLog('Logger inicializado');
  } catch (err) {
    bootstrapLog('No se pudo inicializar el logger', err);
    process.exit(1);
    return;
  }

  appLog('info', '============================================================');
  appLog('info', 'CBS Print Service  v3.2.7  arrancando...');
  appLog('info', '============================================================');
  appLog('info', 'Configuración cargada', { configPath: CONFIG_PATH });

  try {
    notifier.init(config);
  } catch (err) {
    appLog('warn', 'No se pudo inicializar el notificador', { error: err.message });
  }

  // Limpiar trabajos propios que hayan quedado atascados de una ejecución anterior.
  await cleanupStaleJobs(config);

  try {
    folderWatcher = new watcher(config);
    await folderWatcher.start();
  } catch (err) {
    appLog('error', 'No se pudo iniciar el monitoreo de carpetas', {
      error: err.message,
      stack: err.stack
    });
    bootstrapLog('No se pudo iniciar el monitoreo de carpetas', err);
    updateHealthCheck('error');
    process.exit(1);
    return;
  }

  updateHealthCheck('running');
  healthTimer = setInterval(() => updateHealthCheck('running'), 30000);

  bootstrapLog('Servicio activo');
  appLog('info', 'CBS Print Service activo. Esperando archivos de impresión...');
  updateHealthCheck('active');
}

// ---------------------------------------------------------------------------
// Apagado ordenado
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  appLog('info', `Señal recibida: ${signal}. Deteniendo servicio...`);
  bootstrapLog(`Deteniendo servicio (${signal})`);
  updateHealthCheck('stopping');

  // Si algo se cuelga durante el apagado, no dejar el proceso vivo.
  const watchdog = setTimeout(() => {
    bootstrapLog('Watchdog de apagado agotado; forzando salida');
    process.exit(1);
  }, 20000);
  watchdog.unref();

  try {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }

    if (folderWatcher) {
      // 1. Cerrar la entrada de archivos nuevos y el watcher.
      folderWatcher.processor.stopAccepting();
      await folderWatcher.stop();

      // 2. Dar tiempo a que termine el trabajo en curso y la cola.
      const drained = await folderWatcher.processor.drain(10000);
      if (!drained) {
        appLog('warn', 'La cola no terminó a tiempo; cancelando el trabajo activo');
        folderWatcher.processor.cancelActiveJob(signal);
        await folderWatcher.processor.drain(3000);
      }
    }

    try { fs.unlinkSync(HEALTH_CHECK_PATH); } catch {}
    bootstrapLog('Servicio detenido correctamente');
    appLog('info', 'CBS Print Service detenido correctamente.');
  } catch (err) {
    bootstrapLog('Error durante el apagado', err);
    appLog('error', 'Error durante el apagado', { error: err.message, stack: err.stack });
  } finally {
    clearTimeout(watchdog);
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Señales del Sistema Operativo / SCM
// ---------------------------------------------------------------------------

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGBREAK',() => shutdown('SIGBREAK'));   // Ctrl+Break en Windows

// Capturar errores no manejados para evitar que el servicio muera silenciosamente.
process.on('uncaughtException', (err) => {
  bootstrapLog('Excepción no capturada', err);
  appLog('error', 'Excepción no capturada', { error: err.message, stack: err.stack });
  try { notifier.notifyCritical('Excepción no capturada', err.message); } catch {}
  updateHealthCheck('error');
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  bootstrapLog('Promise rechazada sin manejar', reason instanceof Error ? reason : new Error(msg));
  appLog('error', 'Promise rechazada sin manejar', {
    reason: msg,
    stack: reason instanceof Error ? reason.stack : undefined
  });
  try { notifier.notifyCritical('Promise rechazada sin manejar', msg); } catch {}
  updateHealthCheck('error');
});

bootstrap().catch((err) => {
  bootstrapLog('Fallo no controlado durante el arranque', err);
  appLog('error', 'Fallo no controlado durante el arranque', {
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});
