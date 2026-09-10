'use strict';

// =============================================================================
// uninstall-service.js  –  CBS Print Service
// =============================================================================

const path = require('path');
const Service = require('node-windows').Service;

const SERVICE_NAME = 'CBSPrintService';
const SERVICE_ID = 'cbsprintservice';
const SERVICE_KEY = SERVICE_ID;
const SERVICE_SCRIPT = path.join(__dirname, '..', 'src', 'index.js');
const TIMEOUT_MS = 30000;

let uninstallDone = false;

const timeout = setTimeout(() => {
  if (!uninstallDone) {
    console.error(`\n[ERROR] Tiempo de espera agotado (${TIMEOUT_MS / 1000}s) al desinstalar el servicio.`);
    console.error(`       Ejecute como Administrador: sc delete ${SERVICE_KEY}`);
    process.exit(1);
  }
}, TIMEOUT_MS);

const svc = new Service({
    name: SERVICE_NAME,
    id: SERVICE_ID,
    script: SERVICE_SCRIPT
});

// -----------------------------------------------------------------------------
// Eventos
// -----------------------------------------------------------------------------

svc.on('uninstall', () => {
    uninstallDone = true;
    console.log(`\n[OK] Servicio "${SERVICE_NAME}" desinstalado correctamente.`);
    clearTimeout(timeout);
    setTimeout(() => process.exit(0), 500);
});

svc.on('alreadyuninstalled', () => {
    uninstallDone = true;
    console.log(`[INFO] El servicio "${SERVICE_NAME}" ya no se encuentra instalado.`);
    clearTimeout(timeout);
    setTimeout(() => process.exit(0), 500);
});

svc.on('error', (err) => {
    console.error('[ERROR]');
    console.error(err);
    clearTimeout(timeout);
    setTimeout(() => process.exit(1), 500);
});

// -----------------------------------------------------------------------------
// Desinstalar
// -----------------------------------------------------------------------------

console.log('='.repeat(60));
console.log(' CBS Print Service  –  Desinstalador');
console.log('='.repeat(60));

console.log(`\nDesinstalando servicio "${SERVICE_NAME}" (${SERVICE_KEY})...\n`);

svc.uninstall();
