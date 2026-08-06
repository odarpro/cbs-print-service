'use strict';
// =============================================================================
// index.js  –  CBS Print Service
//
// Punto de entrada del servicio.
// Puede ejecutarse de dos formas:
//   A) node src/index.js              → Modo consola (desarrollo/diagnóstico)
//   B) Como Windows Service instalado → gestionado por node-windows / SCM
//
// Sin llamadas a cmd.exe, powershell.exe, ShellExecute ni procesos externos.
// =============================================================================

const fs      = require('fs');
const path    = require('path');
const logger  = require('./logger');
const watcher = require('./watcher');
const notifier = require('./notifier');

// ---------------------------------------------------------------------------
// Cargar configuración
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[CBS Print Service] ERROR: No se encontró config.json en ${CONFIG_PATH}`);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[CBS Print Service] ERROR: config.json inválido: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config = loadConfig();

// Inicializar logger con la configuración cargada
logger.init(config);
const log = logger.get();

// Inicializar notificador toast
notifier.init(config);

log.info('============================================================');
log.info('CBS Print Service  v2.2.0  arrancando...');
log.info('============================================================');
log.info('Configuración cargada', { configPath: CONFIG_PATH });

// Inicializar watcher
const folderWatcher = new watcher(config);
folderWatcher.start();

// ---------------------------------------------------------------------------
// Health check: archivo de estado para monitoreo externo
// ---------------------------------------------------------------------------

const HEALTH_CHECK_PATH = path.join(__dirname, '..', 'healthcheck.json');

function updateHealthCheck(status) {
  try {
    const data = JSON.stringify({
      status,
      pid:       process.pid,
      uptime:    process.uptime(),
      queue:     folderWatcher.queueLength,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(HEALTH_CHECK_PATH, data, 'utf8');
  } catch {
    // Si falla la escritura del health check no debe romper el servicio
  }
}

// Actualizar cada 30 segundos
setInterval(() => updateHealthCheck('running'), 30000);
updateHealthCheck('running');

// ---------------------------------------------------------------------------
// Señales del Sistema Operativo / SCM
// Permiten al Windows Service Manager detener el servicio limpiamente.
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  log.info(`Señal recibida: ${signal}. Deteniendo servicio...`);
  updateHealthCheck('stopped');
  await folderWatcher.stop();
  // Limpiar health check al detener
  try { fs.unlinkSync(HEALTH_CHECK_PATH); } catch {}
  log.info('CBS Print Service detenido correctamente.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGBREAK',() => shutdown('SIGBREAK'));   // Ctrl+Break en Windows

// Capturar errores no manejados para evitar que el servicio muera silenciosamente
process.on('uncaughtException', (err) => {
  log.error('Excepción no capturada', { error: err.message, stack: err.stack });
  notifier.notifyCritical('Excepción no capturada', err.message);
  updateHealthCheck('error');
});

process.on('unhandledRejection', (reason) => {
  const msg = String(reason);
  log.error('Promise rechazada sin manejar', { reason: msg });
  notifier.notifyCritical('Promise rechazada sin manejar', msg);
  updateHealthCheck('error');
});

log.info('CBS Print Service activo. Esperando archivos de impresión...');
updateHealthCheck('active');
