'use strict';
// =============================================================================
// install-service.js  –  CBS Print Service
//
// Registra la aplicación como Servicio de Windows usando node-windows.
// Ejecutar UNA SOLA VEZ con privilegios de administrador:
//
//   node scripts/install-service.js
//
// El servicio quedará registrado en el SCM con inicio automático.
// =============================================================================

const path    = require('path');
const fs      = require('fs');
const Service = require('node-windows').Service;

const SERVICE_NAME        = 'CBSPrintService';
const SERVICE_DESCRIPTION = 'CBS Servicio de Impresion Directa para Impresoras Matriciales';
const SERVICE_SCRIPT      = path.join(__dirname, '..', 'src', 'index.js');
const TIMEOUT_MS          = 60000;

// Detectar Node.js: primero system PATH, luego bundled portable
let EXEC_PATH = 'node';
const bundled = path.join(__dirname, '..', 'bin', 'node.exe');
if (fs.existsSync(bundled)) {
  EXEC_PATH = bundled;
}

const timeout = setTimeout(() => {
  console.error(`\n[ERROR] Tiempo de espera agotado (${TIMEOUT_MS / 1000}s) al instalar el servicio.`);
  console.error('       Intente ejecutar manualmente como Administrador:');
  console.error('         sc create CBSPrintService binPath= "node.exe src\\index.js" start= auto');
  process.exit(1);
}, TIMEOUT_MS);

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

svc.on('install', () => {
  console.log(`\n[OK] Servicio "${SERVICE_NAME}" instalado correctamente.`);
  console.log('Iniciando servicio...');
  svc.start();
});

svc.on('start', () => {
  console.log(`[OK] Servicio "${SERVICE_NAME}" iniciado correctamente.`);
  clearTimeout(timeout);
  process.exit(0);
});

svc.on('alreadyinstalled', () => {
  console.log(`[INFO] El servicio "${SERVICE_NAME}" ya estaba instalado.`);
  clearTimeout(timeout);
  process.exit(0);
});

svc.on('error', (err) => {
  console.error(`[ERROR] ${err}`);
  console.error('Asegúrese de ejecutar este script como Administrador.');
  clearTimeout(timeout);
  process.exit(1);
});

svc.on('invalidinstallation', () => {
  console.error(`[ERROR] Instalación inválida.`);
  console.error('       Intente ejecutar: sc delete CBSPrintService');
  clearTimeout(timeout);
  process.exit(1);
});

// ── Instalar ─────────────────────────────────────────────────────────────────

console.log('='.repeat(60));
console.log(' CBS Print Service  –  Instalador de Servicio Windows');
console.log('='.repeat(60));
console.log(`\nScript del servicio : ${SERVICE_SCRIPT}`);
console.log(`Nombre del servicio : ${SERVICE_NAME}`);
console.log('\nInstalando...\n');

svc.install();
