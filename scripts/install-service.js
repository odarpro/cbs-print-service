'use strict';
// =============================================================================
// install-service.js  –  CBS Print Service
//
// Registra la aplicación como Servicio de Windows usando node-windows.
// Ejecutar UNA SOLA VEZ con privilegios de administrador:
//
//   node scripts/install-service.js
//
// El servicio quedará registrado en el SCM con inicio automático y se intenta
// arrancar de inmediato, con reintentos y verificación del estado real vía
// sc.exe (evita el race conocido de node-windows install -> start).
// =============================================================================

const path        = require('path');
const fs          = require('fs');
const { execFile } = require('child_process');
const Service     = require('node-windows').Service;

const SERVICE_NAME        = 'CBSPrintService';
const SERVICE_ID          = 'cbsprintservice';
// WinSW registra el servicio con el valor de <id>; el .exe es solo el wrapper.
const SERVICE_KEY         = SERVICE_ID;
const SERVICE_DESCRIPTION = 'CBS Servicio de Impresion Directa para Impresoras Matriciales';
const SERVICE_SCRIPT      = path.join(__dirname, '..', 'src', 'index.js');
const INSTALL_DIR         = path.join(__dirname, '..');
const TIMEOUT_MS          = 180000;
const START_MAX_RETRIES   = 5;
const START_RETRY_MS      = 3000;

// Detectar Node.js: primero system PATH, luego bundled portable
let EXEC_PATH = 'node';
const bundled = path.join(__dirname, '..', 'bin', 'node.exe');
if (fs.existsSync(bundled)) {
  EXEC_PATH = bundled;
}

let finished = false;
const finish = (code) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  process.exit(code);
};

const timeout = setTimeout(() => {
  console.error(`\n[ERROR] Tiempo de espera agotado (${TIMEOUT_MS / 1000}s) al instalar/iniciar el servicio.`);
  console.error('       Ejecute manualmente como Administrador:');
  console.error(`         net start ${SERVICE_KEY}`);
  finish(1);
}, TIMEOUT_MS);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSc(args) {
  return new Promise((resolve) => {
    execFile('sc.exe', args, { windowsHide: true }, (err, stdout) => {
      resolve({ code: err ? (err.code || 1) : 0, out: String(stdout || '') });
    });
  });
}

async function waitRegistered(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const res = await runSc(['query', SERVICE_KEY]);
    // El código de salida de sc.exe no depende del idioma del sistema.
    if (res.code === 0) return true;
    await delay(1000);
  }
  return false;
}

async function isRunning() {
  const res = await runSc(['query', SERVICE_KEY]);
  // sc.exe solo traduce las etiquetas (STATE/ESTADO), pero el estado
  // (RUNNING/STOPPED/...) y el código numérico son universales.
  return /(?:STATE|ESTADO)\s*:\s*\d+\s*RUNNING/i.test(res.out) ||
         /\bRUNNING\b/.test(res.out);
}

async function startWithRetry() {
  for (let attempt = 1; attempt <= START_MAX_RETRIES; attempt++) {
    console.log(`       Intento ${attempt}/${START_MAX_RETRIES}...`);
    await runSc(['start', SERVICE_KEY]);
    if (await isRunning()) return true;
    if (attempt < START_MAX_RETRIES) await delay(START_RETRY_MS);
  }
  return false;
}

/**
 * Ajusta el servicio en el SCM para que arranque de forma confiable:
 *   - inicio retardado (deja montar discos y el spooler)
 *   - reinicio automático ante fallo
 */
async function applyServiceHardening() {
  console.log('Configurando inicio retardado y recuperación ante fallos...');

  const delayed = await runSc(['config', SERVICE_KEY, 'start=', 'delayed-auto']);
  if (delayed.code !== 0) {
    console.warn(`[WARN] No se pudo configurar el inicio retardado: ${delayed.out.trim()}`);
  } else {
    console.log('       Inicio retardado configurado.  [OK]');
  }

  const failure = await runSc([
    'failure', SERVICE_KEY,
    'reset=', '86400',
    'actions=', 'restart/60000/restart/60000/restart/60000'
  ]);
  if (failure.code !== 0) {
    console.warn(`[WARN] No se pudo configurar la recuperación ante fallos: ${failure.out.trim()}`);
  } else {
    console.log('       Recuperación ante fallos configurada.  [OK]');
  }
}

/**
 * Instala la tarea programada de arranque (boot-guard).
 * Nunca impide que el servicio quede instalado.
 */
async function installBootGuard() {
  try {
    const bootGuard = require('./install-boot-guard');
    const result = await bootGuard.install();
    if (result && result.ok) {
      console.log('[OK] Tarea de arranque (boot-guard) instalada.');
    } else {
      console.warn(`[WARN] No se pudo instalar la tarea de arranque: ${result && result.error ? result.error : 'error desconocido'}`);
    }
  } catch (err) {
    console.warn(`[WARN] No se pudo instalar la tarea de arranque: ${err.message}`);
  }
}

const svc = new Service({
  name:         SERVICE_NAME,
  id:           SERVICE_ID,
  description:  SERVICE_DESCRIPTION,
  script:       SERVICE_SCRIPT,
  execPath:     EXEC_PATH,

  // Política de recuperación ante fallos: reiniciar hasta 3 veces
  // (el SCM lo gestiona; no usamos procesos externos)
  maxRestarts:  3,
  wait:         2,     // segundos entre reinicios
  grow:         0.5,   // factor de crecimiento del tiempo de espera

  // El spooler debe estar disponible antes de arrancar el servicio.
  dependencies: ['Spooler'],

  // Directorio de trabajo y logs del wrapper (WinSW).
  workingdirectory: INSTALL_DIR,
  logpath: path.join(INSTALL_DIR, 'logs'),

  // Dar tiempo al apagado ordenado (drenaje de cola + cancelación).
  stopparentfirst: true,
  stoptimeout: 30,

  // Variables de entorno disponibles para el proceso del servicio
  env: [
    { name: 'NODE_ENV', value: 'production' }
  ]
});

// ── Eventos ─────────────────────────────────────────────────────────────────

svc.on('install', async () => {
  console.log(`\n[OK] Servicio "${SERVICE_NAME}" instalado correctamente.`);
  console.log('Esperando a que el SCM registre el servicio...');

  if (!(await waitRegistered(TIMEOUT_MS))) {
    console.error('[ERROR] El servicio no fue registrado en el SCM a tiempo.');
    finish(1);
    return;
  }

  await applyServiceHardening();

  if (await isRunning()) {
    console.log(`[OK] El servicio "${SERVICE_NAME}" ya está en ejecución.`);
    await installBootGuard();
    finish(0);
    return;
  }

  console.log('Iniciando servicio...');
  if (await startWithRetry()) {
    console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
    await installBootGuard();
    finish(0);
  } else {
    console.error(`[ERROR] No se pudo iniciar el servicio tras ${START_MAX_RETRIES} intentos.`);
    console.error('        Ejecute manualmente como Administrador:');
    console.error(`          net start ${SERVICE_KEY}`);
    finish(1);
  }
});

svc.on('start', () => {
  console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
  finish(0);
});

svc.on('alreadyinstalled', async () => {
  console.log(`[INFO] El servicio "${SERVICE_NAME}" ya estaba instalado.`);
  console.log('       (node-windows no regenera el XML en este caso; use update.bat para reinstalar).');

  await applyServiceHardening();

  if (await isRunning()) {
    console.log(`[OK] El servicio "${SERVICE_NAME}" está en ejecución.`);
    await installBootGuard();
    finish(0);
    return;
  }
  console.log('Iniciando servicio...');
  if (await startWithRetry()) {
    console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
    await installBootGuard();
    finish(0);
  } else {
    console.error('[ERROR] No se pudo iniciar el servicio. Ejecute como Administrador:');
    console.error(`          net start ${SERVICE_KEY}`);
    finish(1);
  }
});

svc.on('error', (err) => {
  console.error(`[ERROR] ${err}`);
  console.error('Asegúrese de ejecutar este script como Administrador.');
  finish(1);
});

svc.on('invalidinstallation', () => {
  console.error('[ERROR] Instalación inválida.');
  console.error(`       Intente ejecutar: sc delete ${SERVICE_KEY}`);
  finish(1);
});

// ── Instalar ─────────────────────────────────────────────────────────────────

console.log('='.repeat(60));
console.log(' CBS Print Service  –  Instalador de Servicio Windows');
console.log('='.repeat(60));
console.log(`\nScript del servicio : ${SERVICE_SCRIPT}`);
console.log(`Nombre visible      : ${SERVICE_NAME}`);
console.log(`Nombre interno      : ${SERVICE_KEY}`);
console.log('\nInstalando...\n');

try {
  fs.mkdirSync(path.join(INSTALL_DIR, 'logs'), { recursive: true });
} catch (err) {
  console.warn(`[WARN] No se pudo crear ${path.join(INSTALL_DIR, 'logs')}: ${err.message}`);
}

svc.install();
