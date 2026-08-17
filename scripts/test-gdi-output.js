'use strict';
// =============================================================================
// test-gdi-output.js  –  Herramienta de validación del modo GDI real (43I)
//
// Imprime cada escenario de parámetros con GDI nativo de Windows
// (koffi → gdi32.dll → driver de la impresora) en la impresora indicada.
//
// Uso:
//   node scripts/test-gdi-output.js "<Nombre o fragmento de impresora>"
//   Ej.: node scripts/test-gdi-output.js "Recibos"
// =============================================================================
const logger = require('../src/logger');
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const gdiPrint = require('../src/gdiPrinter');
const { getPrinterInfo } = require('../src/printer');

const printerArg = process.argv[2];
if (!printerArg) {
  console.error('Uso: node scripts/test-gdi-output.js "<Nombre o fragmento de impresora>"');
  process.exit(1);
}

const testText = [
  'FACTURA ELECTRONICA',
  'Cliente: EMPRESA ABC S.A.',
  'Fecha: 30/07/2026',
  'Cant  Descripcion            Precio  Total',
  '1     Producto A             150.00  150.00',
  '2     Producto B              75.50  151.00',
  '-------------------------------------------',
  'TOTAL A PAGAR:                      301.00'
].join('\n');

const scenarios = [
  { label: 'GDI - Courier New 9 bold',  opts: { maxCharsPerLine: 40, bold: true,  fontName: 'Courier New', fontSize: 9 } },
  { label: 'GDI - Calibri 10 normal',   opts: { maxCharsPerLine: 40, bold: false, fontName: 'Calibri', fontSize: 10 } },
  { label: 'GDI - Arial 12 bold',       opts: { maxCharsPerLine: 50, bold: true,  fontName: 'Arial', fontSize: 12 } },
  { label: 'GDI - Times 11 normal',      opts: { maxCharsPerLine: 40, bold: false, fontName: 'Times New Roman', fontSize: 11 } },
  { label: 'GDI - Courier 8 normal',     opts: { maxCharsPerLine: 40, bold: false, fontName: 'Courier', fontSize: 8 } },
  { label: 'GDI - Courier 15 bold',      opts: { maxCharsPerLine: 35, bold: true,  fontName: 'Courier', fontSize: 15 } }
];

async function main() {
  const { resolvedName } = getPrinterInfo(printerArg);
  if (!resolvedName) {
    console.error(`ERROR: no se encontró una impresora que coincida con "${printerArg}".`);
    console.error('Impresoras instaladas:');
    for (const p of require('../src/printer').listPrinters()) {
      console.error(`  - ${p.name} (${p.status})`);
    }
    process.exit(1);
  }

  console.log(`Imprimiendo en: ${resolvedName}\n`);

  for (const scenario of scenarios) {
    console.log(`=== ${scenario.label} ===`);
    try {
      await gdiPrint.printGdi(testText, {
        printerName: resolvedName,
        ...scenario.opts,
        copies: 1,
        docTitle: `GDI test - ${scenario.label}`
      });
      console.log('  OK: trabajo enviado al spooler.\n');
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
      process.exitCode = 1;
    }
  }

  console.log('Validación GDI real completada.');
}

main();
