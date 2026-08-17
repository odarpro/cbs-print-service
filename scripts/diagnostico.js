'use strict';
// =============================================================================
// diagnostico.js  –  CBS Print Service
//
// Herramienta de diagnóstico. Lista las impresoras instaladas en el equipo
// y verifica la configuración del servicio.
//
//   node scripts/diagnostico.js
//
// Sin llamadas a cmd.exe ni powershell.
// =============================================================================

const fs   = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log(' CBS Print Service  –  Diagnóstico');
console.log('='.repeat(60));

// ── 1. Leer configuración ────────────────────────────────────────────────────
const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('\n[ERROR] No se encontró config.json');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
console.log('\n[CONFIG]');
console.log(`  Watch folder  : ${config.watchFolder}`);
console.log(`  History folder: ${config.historyFolder}`);
console.log(`  Error folder  : ${config.errorFolder}`);
console.log(`  Log folder    : ${config.logFolder}`);
console.log(`  Printer Voucher: ${config.printers?.voucher?.name || '(no configurada)'}`);
console.log(`  Printer Slip  : ${config.printers?.slip?.name || '(no configurada)'}`);
console.log(`  File action   : ${config.fileAction}`);
console.log(`  Retry count   : ${config.retryCount}`);

// ── 2. Verificar carpetas ────────────────────────────────────────────────────
console.log('\n[CARPETAS]');
const folders = ['watchFolder', 'historyFolder', 'errorFolder', 'logFolder'];
for (const key of folders) {
  const dir    = config[key];
  const exists = dir && fs.existsSync(dir);
  console.log(`  ${key.padEnd(16)}: ${dir}  ${exists ? '[OK]' : '[NO EXISTE - se creará al iniciar]'}`);
}

// ── 3. Listar impresoras instaladas ──────────────────────────────────────────
console.log('\n[IMPRESORAS INSTALADAS]');

let printerModule;
try {
  printerModule = require('@tbalegas/node-printer');
  const printers = printerModule.getPrinters();
  if (printers.length === 0) {
    console.log('  (ninguna impresora instalada)');
  } else {
    printers.forEach((p, i) => {
      const status = p.statusNumber === 0 ? 'OK' : `status=${p.statusNumber}`;
      const dflt   = p.isDefault ? ' [DEFAULT]' : '';
      console.log(`  ${String(i + 1).padStart(2)}. ${p.name}  [${status}]${dflt}`);
    });
  }
} catch {
  console.log('  (módulo nativo no disponible en este entorno — solo funciona en Windows)');
}

// ── 4. Verificar Node.js ─────────────────────────────────────────────────────
console.log('\n[NODE.JS]');
console.log(`  Versión: ${process.version}`);
console.log(`  Plataforma: ${process.platform}`);

// ── 5. Archivos pendientes en watch folder ───────────────────────────────────
console.log('\n[ARCHIVOS PENDIENTES EN WATCH FOLDER]');
const watchFolder = config.watchFolder;
if (fs.existsSync(watchFolder)) {
  const files = fs.readdirSync(watchFolder)
    .filter(f => f.toLowerCase().endsWith('.txt'))
    .filter(f => f.toLowerCase().startsWith('rec') || f.toLowerCase().startsWith('val'));
  if (files.length === 0) {
    console.log('  (ninguno)');
  } else {
    files.forEach(f => console.log(`  - ${f}`));
  }
} else {
  console.log(`  Carpeta no existe: ${watchFolder}`);
}

console.log('\n' + '='.repeat(60));
console.log(' Fin del diagnóstico.');
console.log('='.repeat(60) + '\n');
