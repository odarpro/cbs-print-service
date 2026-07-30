'use strict';
const fs = require('fs');
const path = require('path');
const logger = require('../src/logger');
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const gdiPrint = require('../src/gdiPrinter');

const ESC = '\x1B';

function visualize(raw) {
  return raw
    .replace(new RegExp(ESC, 'g'), '␛')
    .replace(/\x0F/g, '␏')
    .replace(/\n/g, '¶\n')
    .replace(/\r/g, '␍');
}

function hexDump(raw) {
  const lines = [];
  for (let i = 0; i < raw.length; i += 16) {
    const chunk = raw.slice(i, i + 16);
    const hex = Array.from(chunk, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '.').join('');
    lines.push(`${i.toString(16).padStart(4, '0')}: ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
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
  { label: 'GDI - Courier 15 bold',      opts: { maxCharsPerLine: 35, bold: true,  fontName: 'Courier', fontSize: 15 } },
  { label: 'DIRECT (sin GDI)',           opts: null }
];

const outDir = path.join(__dirname, '..', 'test-output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const scenario of scenarios) {
  let output;
  let filename;
  let ext;

  if (scenario.opts === null) {
    output = testText;
    filename = `test_direct.txt`;
    ext = '.txt';
  } else {
    output = gdiPrint.renderGdi(testText, scenario.opts);
    const safeLabel = scenario.label.replace(/[^a-zA-Z0-9_-]/g, '_');
    filename = `test_${safeLabel}.bin`;
    ext = '.bin';
  }

  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, output, 'latin1');

  console.log('');
  console.log('='.repeat(70));
  console.log(`  ${scenario.label}`);
  console.log(`  Guardado: ${filePath}`);
  console.log('='.repeat(70));

  if (scenario.opts !== null) {
    console.log('\n--- VISUALIZACION (␛=ESC, ␏=SO, ¶=LF) ---');
    console.log(visualize(output));

    console.log('\n--- HEX DUMP (primeros 32 bytes + ultimos 16) ---');
    const lines = hexDump(output).split('\n');
    lines.slice(0, 2).forEach(l => console.log(l));
    if (lines.length > 5) {
      console.log('  ...');
      lines.slice(-1).forEach(l => console.log(l));
    }
    console.log(`  Total: ${output.length} bytes`);

    const headerEnd = output.indexOf('\n');
    if (headerEnd > 0) {
      const header = output.slice(0, headerEnd);
      const codes = [];
      if (header.includes(ESC + 'k')) codes.push(`Font ESC k ${header.includes(ESC + 'k') ? header.split(ESC + 'k')[1].charCodeAt(0) : '?'}`);
      if (header.includes('\x0F')) codes.push('Condensed (SO)');
      if (header.includes(ESC + 'g')) codes.push('Elite');
      if (header.includes(ESC + 'M')) codes.push('Pica');
      if (header.includes(ESC + 'P')) codes.push('Proportional');
      if (header.includes(ESC + 'E')) codes.push('Bold ON');
      if (header.includes(ESC + 'F')) codes.push('Bold OFF');
      if (output.includes(ESC + '@')) codes.push('Reset (ESC @)');
      console.log(`  Codigos detectados: ${codes.join(', ')}`);
    }
  } else {
    console.log('\n--- CONTENIDO TEXTO ---');
    console.log(output);
  }
  console.log('');
}

console.log('Todos los archivos guardados en: ' + outDir);
console.log('\nPara examinar los ESC/P codes usa un hex editor o:');
console.log('  certutil -encodehex test-output\\test_GDI_-_Courier_New_9_bold.bin output.txt');
