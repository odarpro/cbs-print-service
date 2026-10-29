'use strict';
// =============================================================================
// diagnostico.js  –  CBS Print Service
//
// Herramienta de diagnóstico. Revisa configuración, carpetas, impresoras,
// cola del spooler, servicio, tarea de arranque, XML de WinSW y logs.
//
//   node scripts/diagnostico.js
// =============================================================================

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const jobTracker = require('../src/jobTracker');

const INSTALL_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(INSTALL_DIR, 'config.json');
const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const BOOTSTRAP_LOG = path.join(PROGRAM_DATA, 'CBSPrintService', 'startup.log');
const BOOT_GUARD_LOG = path.join(PROGRAM_DATA, 'CBSPrintService', 'boot-guard.log');
const SERVICE_KEY = 'cbsprintservice';
const TASK_NAME = '\\CBS Print Service\\CBSBootGuard';

function run(command, args) {
  return new Promise(resolve => {
    execFile(command, args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code || 1) : 0,
        output: `${stdout || ''}${stderr || ''}`.trim()
      });
    });
  });
}

function tail(filePath, lines = 15) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch (err) {
    return [`[no se pudo leer: ${err.message}]`];
  }
}

function printTail(title, filePath) {
  console.log(`\n[${title}]  ${filePath}`);
  const lines = tail(filePath);
  if (!lines) {
    console.log('  (no existe)');
    return;
  }
  lines.forEach(line => console.log(`  ${line}`));
}

async function main() {
  console.log('='.repeat(70));
  console.log(' CBS Print Service  –  Diagnóstico');
  console.log('='.repeat(70));
  console.log(`\nDirectorio de instalación: ${INSTALL_DIR}`);

  // ── 1. Configuración ────────────────────────────────────────────────────────
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`\n[ERROR] No se encontró config.json en ${CONFIG_PATH}`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`\n[ERROR] config.json inválido: ${err.message}`);
    process.exit(1);
  }

  console.log('\n[CONFIG]');
  console.log(`  Watch folder   : ${config.watchFolder}`);
  console.log(`  History folder : ${config.historyFolder}`);
  console.log(`  Error folder   : ${config.errorFolder}`);
  console.log(`  Log folder     : ${config.logFolder}`);
  console.log(`  Printer Voucher: ${config.printers?.voucher?.name || '(no configurada)'}`);
  console.log(`  Printer Slip   : ${config.printers?.slip?.name || '(no configurada)'}`);
  console.log(`  File action    : ${config.fileAction}`);
  console.log(`  Retry count    : ${config.retryCount}`);
  console.log(`  Timeouts (ms)  : GDI=${config.gdiTimeoutMs}, CLASSIC=${config.classicTimeoutMs}, DIRECT=${config.directTimeoutMs}`);
  console.log(`  Limpiar pendientes al arrancar : ${config.deletePendingOnStartup !== false}`);
  console.log(`  Limpiar jobs legacy            : ${config.cleanupLegacyCbsJobs === true}`);

  // ── 2. Carpetas ─────────────────────────────────────────────────────────────
  console.log('\n[CARPETAS]');
  for (const key of ['watchFolder', 'historyFolder', 'errorFolder', 'logFolder']) {
    const dir = config[key];
    const exists = dir && fs.existsSync(dir);
    console.log(`  ${key.padEnd(16)}: ${dir}  ${exists ? '[OK]' : '[NO EXISTE - se creará al iniciar]'}`);
  }

  // ── 3. Impresoras instaladas ────────────────────────────────────────────────
  console.log('\n[IMPRESORAS INSTALADAS]');
  const printers = jobTracker.getPrinters();
  if (printers.length === 0) {
    console.log('  (ninguna impresora o módulo nativo no disponible)');
  } else {
    printers.forEach((p, i) => {
      const status = p.statusNumber === 0 ? 'OK' : `status=${p.statusNumber}`;
      const dflt = p.isDefault ? ' [DEFAULT]' : '';
      console.log(`  ${String(i + 1).padStart(2)}. ${p.name}  [${status}]${dflt}`);
    });
  }

  // ── 4. Cola del spooler ─────────────────────────────────────────────────────
  console.log('\n[COLA DEL SPOOLER]');
  if (!jobTracker.isAvailable()) {
    console.log('  (módulo nativo no disponible)');
  } else {
    for (const [type, value] of Object.entries(config.printers || {})) {
      if (!value || !value.name) continue;
      const resolved = jobTracker.resolvePrinterName(value.name);
      console.log(`\n  ${type}: ${value.name}  ->  ${resolved || 'NO ENCONTRADA'}`);
      if (!resolved) continue;

      const jobs = jobTracker.listJobs(resolved);
      if (jobs.length === 0) {
        console.log('    (cola vacía)');
        continue;
      }

      for (const job of jobs) {
        const statuses = jobTracker.jobStatuses(job).join(',') || String(job.statusNumber || 0);
        const owner = jobTracker.isCbsDocument(job.document)
          ? 'CBS'
          : (jobTracker.matchesLegacyCbsDocument(job.document) ? 'LEGACY?' : 'OTRO');
        console.log(`    #${String(job.id).padEnd(6)} [${owner.padEnd(7)}] ${job.document}  [${statuses}]`);
      }
    }
  }

  // ── 5. Servicio y spooler ───────────────────────────────────────────────────
  console.log('\n[SERVICIO]');
  const svc = await run('sc.exe', ['query', SERVICE_KEY]);
  if (svc.code !== 0) {
    console.log(`  ${SERVICE_KEY}: NO INSTALADO`);
  } else {
    const state = (svc.output.match(/(?:STATE|ESTADO)\s*:\s*\d+\s+(\S+)/i) || [])[1] || 'desconocido';
    console.log(`  ${SERVICE_KEY}: ${state}`);
  }

  const spooler = await run('sc.exe', ['query', 'Spooler']);
  const spoolerState = (spooler.output.match(/(?:STATE|ESTADO)\s*:\s*\d+\s+(\S+)/i) || [])[1] || 'desconocido';
  console.log(`  Spooler: ${spoolerState}`);

  // ── 6. Tarea de arranque ────────────────────────────────────────────────────
  console.log('\n[TAREA DE ARRANQUE]');
  const task = await run('schtasks.exe', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST']);
  if (task.code !== 0) {
    console.log(`  ${TASK_NAME}: NO REGISTRADA`);
  } else {
    console.log(`  ${TASK_NAME}: REGISTRADA`);
    task.output.split(/\r?\n/).slice(0, 8).forEach(line => console.log(`    ${line}`));
  }

  // ── 7. XML de WinSW y logs del wrapper ──────────────────────────────────────
  console.log('\n[WINSW]');
  const candidates = [
    path.join(INSTALL_DIR, 'daemon', `${SERVICE_KEY}.xml`),
    path.join(INSTALL_DIR, 'daemon', 'cbsprintservice.xml'),
    path.join(INSTALL_DIR, `${SERVICE_KEY}.xml`)
  ];
  for (const candidate of candidates) {
    console.log(`  ${candidate}: ${fs.existsSync(candidate) ? '[OK]' : '[NO EXISTE]'}`);
  }

  const wrapperLogs = [
    path.join(INSTALL_DIR, 'logs', `${SERVICE_KEY}.out.log`),
    path.join(INSTALL_DIR, 'logs', `${SERVICE_KEY}.err.log`),
    path.join(INSTALL_DIR, 'logs', `${SERVICE_KEY}.wrapper.log`),
    path.join(INSTALL_DIR, 'daemon', `${SERVICE_KEY}.out.log`),
    path.join(INSTALL_DIR, 'daemon', `${SERVICE_KEY}.err.log`)
  ];
  for (const logPath of wrapperLogs) {
    console.log(`  ${logPath}: ${fs.existsSync(logPath) ? '[OK]' : '[NO EXISTE]'}`);
  }

  // ── 8. Archivos pendientes en watch folder ──────────────────────────────────
  console.log('\n[ARCHIVOS PENDIENTES EN WATCH FOLDER]');
  const watchFolder = config.watchFolder;
  if (watchFolder && fs.existsSync(watchFolder)) {
    const files = fs.readdirSync(watchFolder)
      .filter(f => f.toLowerCase().endsWith('.txt'))
      .filter(f => f.toLowerCase().startsWith('rec') || f.toLowerCase().startsWith('val'));
    if (files.length === 0) console.log('  (ninguno)');
    else files.forEach(f => console.log(`  - ${f}`));
  } else {
    console.log(`  Carpeta no existe o no accesible: ${watchFolder}`);
  }

  // ── 9. Logs de arranque ─────────────────────────────────────────────────────
  printTail('LOG DE ARRANQUE', BOOTSTRAP_LOG);
  printTail('LOG BOOT-GUARD', BOOT_GUARD_LOG);

  // ── 10. Node.js ─────────────────────────────────────────────────────────────
  console.log('\n[NODE.JS]');
  console.log(`  Versión: ${process.version}`);
  console.log(`  Plataforma: ${process.platform}`);
  console.log(`  Ejecutable: ${process.execPath}`);

  console.log('\n' + '='.repeat(70));
  console.log(' Fin del diagnóstico.');
  console.log('='.repeat(70) + '\n');
}

main().catch(err => {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
});
