'use strict';
// =============================================================================
// limpiar-cola.js  –  CBS Print Service
//
// Inspecciona y limpia la cola del spooler de Windows.
//
// Uso:
//   node scripts/limpiar-cola.js
//   node scripts/limpiar-cola.js --printer Recibos
//   node scripts/limpiar-cola.js --delete-cbs
//   node scripts/limpiar-cola.js --delete-cbs --delete-legacy
//   node scripts/limpiar-cola.js --delete-all --yes
//
// Opciones:
//   --printer <nombre>  Limitar a una impresora (nombre parcial o completo)
//   --delete-cbs        Eliminar solo trabajos del CBS Print Service (CBSPrint|)
//   --delete-legacy     Incluir nombres de versiones anteriores (Recibo / Rec*.txt)
//   --delete-all        Eliminar TODOS los trabajos de la cola (requiere --yes)
//   --yes               Confirma operaciones destructivas
// =============================================================================

const fs   = require('fs');
const path = require('path');
const jobTracker = require('../src/jobTracker');

const args = process.argv.slice(2);
const hasFlag = flag => args.includes(flag);
const getOption = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const onlyPrinter = getOption('--printer');
const deleteCbs = hasFlag('--delete-cbs');
const includeLegacy = hasFlag('--delete-legacy');
const deleteAll = hasFlag('--delete-all');
const confirmed = hasFlag('--yes');

function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function configuredPrinterNames(config) {
  const names = [];
  for (const value of Object.values(config.printers || {})) {
    if (value && value.name && !names.includes(value.name)) names.push(value.name);
  }
  return names;
}

function resolvePrinters(config) {
  if (onlyPrinter) {
    const resolved = jobTracker.resolvePrinterName(onlyPrinter);
    return resolved ? [resolved] : [];
  }

  const result = [];
  for (const name of configuredPrinterNames(config)) {
    const resolved = jobTracker.resolvePrinterName(name);
    if (resolved && !result.includes(resolved)) result.push(resolved);
  }
  return result;
}

function formatJob(job) {
  const status = jobTracker.jobStatuses(job).join(',') || String(job.statusNumber || 0);
  return `  #${String(job.id).padEnd(6)} ${String(job.document || '(sin nombre)').padEnd(55)} [${status}]`;
}

function main() {
  console.log('='.repeat(78));
  console.log(' CBS Print Service  -  Limpieza de cola del spooler');
  console.log('='.repeat(78));

  if (!jobTracker.isAvailable()) {
    console.error('\n[ERROR] El módulo nativo @tbalegas/node-printer no está disponible.');
    console.error('        Esta herramienta solo funciona en Windows con las dependencias instaladas.');
    process.exit(1);
  }

  if (deleteAll && !confirmed) {
    console.error('\n[ERROR] --delete-all elimina TODOS los trabajos (incluidos los de otras aplicaciones).');
    console.error('        Vuelva a ejecutar agregando --yes si está seguro.');
    process.exit(1);
  }

  const config = loadConfig();
  const printers = resolvePrinters(config);

  if (printers.length === 0) {
    console.error(`\n[ERROR] No se encontró la impresora${onlyPrinter ? ` "${onlyPrinter}"` : ' configurada'}.`);
    process.exit(1);
  }

  let totalFound = 0;
  let totalDeleted = 0;

  for (const printerName of printers) {
    const jobs = jobTracker.listJobs(printerName);
    console.log(`\n[${printerName}]  trabajos en cola: ${jobs.length}`);

    if (jobs.length === 0) {
      console.log('  (cola vacía)');
      continue;
    }

    jobs.forEach(job => console.log(formatJob(job)));
    totalFound += jobs.length;

    if (deleteAll) {
      let deleted = 0;
      for (const job of jobs) {
        if (jobTracker.deleteJob(printerName, job.id)) deleted++;
      }
      totalDeleted += deleted;
      console.log(`  -> Eliminados ${deleted}/${jobs.length} trabajos.`);
      continue;
    }

    if (deleteCbs) {
      const matcher = includeLegacy
        ? document => jobTracker.isCbsDocument(document) || jobTracker.matchesLegacyCbsDocument(document)
        : jobTracker.isCbsDocument;

      const targets = jobTracker.findMatchingJobs(printerName, matcher);
      if (targets.length === 0) {
        console.log('  -> No hay trabajos CBS que eliminar.');
        continue;
      }

      let deleted = 0;
      for (const job of targets) {
        if (jobTracker.deleteJob(printerName, job.id)) deleted++;
      }
      totalDeleted += deleted;
      console.log(`  -> Trabajos CBS eliminados: ${deleted}/${targets.length}.`);
    }
  }

  console.log('\n' + '-'.repeat(78));
  console.log(`Total en cola: ${totalFound} | Eliminados: ${totalDeleted}`);
  if (!deleteAll && !deleteCbs) {
    console.log('Modo solo lectura. Use --delete-cbs o --delete-all --yes para limpiar.');
  }
  console.log('-'.repeat(78) + '\n');
}

main();
