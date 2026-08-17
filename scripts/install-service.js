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
const SERVICE_DESCRIPTION = 'CBS Servicio de Impresion Directa para Impresoras Matriciales';
const SERVICE_SCRIPT      = path.join(__dirname, '..', 'src', 'index.js');
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
  console.error(`         net start ${SERVICE_NAME}`);
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
    const res = await runSc(['query', SERVICE_NAME]);
    // "sc query" devuelve 0 solo si el servicio existe; el código de salida
    // no depende del idioma del sistema (la etiqueta sí: SERVICE_NAME /
    // NOMBRE_SERVICIO). El nombre del servicio tampoco se localiza.
    if (res.code === 0 && res.out.includes(SERVICE_NAME)) return true;
    await delay(1000);
  }
  return false;
}

async function isRunning() {
  const res = await runSc(['query', SERVICE_NAME]);
  // sc.exe solo traduce las etiquetas (STATE/ESTADO), pero el estado
  // (RUNNING/STOPPED/...) y el código numérico son universales.
  return /(?:STATE|ESTADO)\s*:\s*\d+\s*RUNNING/i.test(res.out) ||
         /\bRUNNING\b/.test(res.out);
}

async function startWithRetry() {
  for (let attempt = 1; attempt <= START_MAX_RETRIES; attempt++) {
    console.log(`       Intento ${attempt}/${START_MAX_RETRIES}...`);
    await runSc(['start', SERVICE_NAME]);
    if (await isRunning()) return true;
    if (attempt < START_MAX_RETRIES) await delay(START_RETRY_MS);
  }
  return false;
}

const svc = new Service({
  name:         SERVICE_NAME,
  id:           SERVICE_NAME,
  description:  SERVICE_DESCRIPTION,
  script:       SERVICE_SCRIPT,
  execPath:     EXEC_PATH,

  // Política de recuperación ante fallos: reiniciar hasta 3 veces
  // (el SCM lo gestiona; no usamos procesos externos)
  maxRestarts:  3,
  wait:         2,     // segundos entre reinicios
  grow:         0.5,   // factor de crecimiento del tiempo de espera

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

  if (await isRunning()) {
    console.log(`[OK] El servicio "${SERVICE_NAME}" ya está en ejecución.`);
    finish(0);
    return;
  }

  console.log('Iniciando servicio...');
  if (await startWithRetry()) {
    console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
    finish(0);
  } else {
    console.error(`[ERROR] No se pudo iniciar el servicio tras ${START_MAX_RETRIES} intentos.`);
    console.error('        Ejecute manualmente como Administrador:');
    console.error(`          net start ${SERVICE_NAME}`);
    finish(1);
  }
});

svc.on('start', () => {
  console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
  finish(0);
});

svc.on('alreadyinstalled', async () => {
  console.log(`[INFO] El servicio "${SERVICE_NAME}" ya estaba instalado.`);
  if (await isRunning()) {
    console.log(`[OK] El servicio "${SERVICE_NAME}" está en ejecución.`);
    finish(0);
    return;
  }
  console.log('Iniciando servicio...');
  if (await startWithRetry()) {
    console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
    finish(0);
  } else {
    console.error('[ERROR] No se pudo iniciar el servicio. Ejecute como Administrador:');
    console.error(`          net start ${SERVICE_NAME}`);
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
  console.error('       Intente ejecutar: sc delete CBSPrintService');
  finish(1);
});

// ── Instalar ─────────────────────────────────────────────────────────────────

console.log('='.repeat(60));
console.log(' CBS Print Service  –  Instalador de Servicio Windows');
console.log('='.repeat(60));
console.log(`\nScript del servicio : ${SERVICE_SCRIPT}`);
console.log(`Nombre del servicio : ${SERVICE_NAME}`);
console.log('\nInstalando...\n');

svc.install();
