"use strict";
// =============================================================================
// populate-printers.js  –  Detecta impresoras instaladas y actualiza config.json
//
// Uso:
//   node scripts/populate-printers.js
//
// Intenta cargar el módulo nativo @tbalegas/node-printer. Si no está
// disponible no realiza cambios (evita fallos en entornos no-Windows).
// =============================================================================

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function backupConfig() {
  try {
    const ts = Date.now();
    const bak = `${CONFIG_PATH}.${ts}.bak`;
    fs.copyFileSync(CONFIG_PATH, bak);
    console.log(`  Copia de seguridad creada: ${bak}`);
  } catch (e) {
    console.log('  WARNING: No se pudo crear copia de seguridad de config.json:', e.message);
  }
}

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('[ERROR] config.json no encontrado. Ejecute desde el directorio del proyecto.');
  process.exit(1);
}

let printerModule;
try {
  printerModule = require('@tbalegas/node-printer');
} catch (e) {
  console.log('Módulo nativo @tbalegas/node-printer no disponible en este entorno. No se modificará config.json.');
  process.exit(0);
}

const printers = printerModule.getPrinters();
if (!printers || printers.length === 0) {
  console.log('No se detectaron impresoras instaladas. No se modificará config.json.');
  process.exit(0);
}

console.log('Impresoras detectadas:');
printers.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}${p.isDefault ? ' [DEFAULT]' : ''}`));

// Elegir impresora por defecto: la marcada como isDefault o la primera
const defaultPrinter = printers.find(p => p.isDefault) || printers[0];
console.log(`
Seleccionada para configuración automática: ${defaultPrinter.name}`);

// Cargar config, crear backup y actualizar
const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
const cfg = JSON.parse(raw);

// Sólo sobrescribimos si no hay nombre configurado o está vacío
let changed = false;
if (!cfg.printers) cfg.printers = {};
if (!cfg.printers.voucher) cfg.printers.voucher = {};
if (!cfg.printers.slip) cfg.printers.slip = {};

if (!cfg.printers.voucher.name || cfg.printers.voucher.name.trim() === "") {
  cfg.printers.voucher.name = defaultPrinter.name;
  changed = true;
}
if (!cfg.printers.slip.name || cfg.printers.slip.name.trim() === "") {
  cfg.printers.slip.name = defaultPrinter.name;
  changed = true;
}

if (changed) {
  backupConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  console.log('config.json actualizado con el nombre de la impresora detectada.');
} else {
  console.log('config.json ya contiene nombres de impresora. No se realizaron cambios.');
}

process.exit(0);
