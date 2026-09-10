'use strict';

// =============================================================================
// uninstall-service.js  –  CBS Print Service
// =============================================================================

const { execFile } = require('child_process');

const SERVICE_ID = 'cbsprintservice';
const SERVICE_KEY = SERVICE_ID;
const TIMEOUT_MS = 30000;

function runSc(args) {
  return new Promise((resolve) => {
    execFile('sc.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        code: error ? (error.code || 1) : 0,
        output: `${stdout || ''}${stderr || ''}`
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killWrapper() {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/F', '/IM', 'cbsprintservice.exe'], { windowsHide: true }, () => resolve());
  });
}

async function serviceExists() {
  return (await runSc(['query', SERVICE_KEY])).code === 0;
}

async function waitForRemoval() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await serviceExists())) return true;
    await delay(1000);
  }
  return false;
}

async function uninstall() {
  console.log('='.repeat(60));
  console.log(' CBS Print Service  –  Desinstalador');
  console.log('='.repeat(60));

  if (!(await serviceExists())) {
    console.log(`[INFO] El servicio "${SERVICE_KEY}" ya no se encuentra instalado.`);
    return;
  }

  console.log(`\nDeteniendo servicio "${SERVICE_KEY}"...`);
  await runSc(['stop', SERVICE_KEY]);
  await killWrapper();

  console.log(`Eliminando servicio "${SERVICE_KEY}"...`);
  let deleted = await runSc(['delete', SERVICE_KEY]);
  if (deleted.code !== 0 && deleted.code !== 1072) {
    throw new Error(deleted.output.trim() || 'sc delete devolvió un error.');
  }

  if (!(await waitForRemoval())) {
    // Reintento agresivo por si el proceso wrapper bloquea la eliminación.
    await killWrapper();
    deleted = await runSc(['delete', SERVICE_KEY]);
    if (!(await waitForRemoval())) {
      throw new Error(`El servicio "${SERVICE_KEY}" sigue registrado tras ${TIMEOUT_MS / 1000}s.`);
    }
  }

  console.log(`[OK] Servicio "${SERVICE_KEY}" desinstalado correctamente.`);
}

uninstall().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  console.error(`        Ejecute como Administrador: sc delete ${SERVICE_KEY}`);
  process.exit(1);
});
