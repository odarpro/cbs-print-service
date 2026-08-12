'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const classicPrinter = require(path.join(__dirname, '..', 'src', 'classicPrinter'));

describe('classicPrinter.resolveCodePage', () => {
  it('mapea latin1 a 1252 (Windows-1252)', () => {
    assert.equal(classicPrinter.resolveCodePage('latin1'), 1252);
  });

  it('mapea windows-1252 a 1252', () => {
    assert.equal(classicPrinter.resolveCodePage('windows-1252'), 1252);
  });

  it('mapea utf8 a 65001', () => {
    assert.equal(classicPrinter.resolveCodePage('utf8'), 65001);
    assert.equal(classicPrinter.resolveCodePage('UTF-8'), 65001);
  });

  it('mapea 437 a 437', () => {
    assert.equal(classicPrinter.resolveCodePage('437'), 437);
  });

  it('usa 1252 como default (vacío o desconocido)', () => {
    assert.equal(classicPrinter.resolveCodePage(undefined), 1252);
    assert.equal(classicPrinter.resolveCodePage(''), 1252);
    assert.equal(classicPrinter.resolveCodePage('algo-extraño'), 1252);
  });
});

describe('classicPrinter.buildClassicArgs', () => {
  const script = 'C:\\CBS\\PrintService\\scripts\\print-classic.ps1';

  it('construye argumentos base con defaults', () => {
    const args = classicPrinter.buildClassicArgs({
      script,
      filePath: 'D:\\Impresiones\\rec.txt',
      printerName: 'EPSON TM-U950',
    });

    assert.ok(args.includes('-File'));
    assert.ok(args.includes(script));
    assert.ok(args.includes('-FilePath'));
    assert.ok(args.includes('D:\\Impresiones\\rec.txt'));
    assert.ok(args.includes('-PrinterName'));
    assert.ok(args.includes('EPSON TM-U950'));
    assert.ok(args.includes('-FontName'));
    assert.ok(args.includes('Courier New'));
    assert.ok(args.includes('-FontSize'));
    assert.ok(args.includes('9'));
    assert.ok(args.includes('-MaxChars'));
    assert.ok(args.includes('40'));
    assert.ok(args.includes('-Encoding'));
    assert.ok(args.includes('1252'));
    assert.ok(args.includes('-Copies'));
    assert.ok(args.includes('1'));
    assert.ok(!args.includes('-Bold'));
  });

  it('reemplaza guiones bajos por espacios en el nombre de fuente (VB)', () => {
    const args = classicPrinter.buildClassicArgs({
      script,
      filePath: 'f',
      printerName: 'p',
      fontName: 'Courier_New',
    });
    const idx = args.indexOf('-FontName');
    assert.equal(args[idx + 1], 'Courier New');
  });

  it('agrega -Bold cuando bold es true', () => {
    const args = classicPrinter.buildClassicArgs({
      script,
      filePath: 'f',
      printerName: 'p',
      bold: true,
    });
    assert.ok(args.includes('-Bold'));
  });

  it('usa maxCharsPerLine y copies pasados', () => {
    const args = classicPrinter.buildClassicArgs({
      script,
      filePath: 'f',
      printerName: 'p',
      maxCharsPerLine: 80,
      copies: 3,
    });
    assert.ok(args.includes('80'));
    assert.ok(args.includes('3'));
  });

  it('fuerza defaults cuando maxCharsPerLine/copies son inválidos', () => {
    const args = classicPrinter.buildClassicArgs({
      script,
      filePath: 'f',
      printerName: 'p',
      maxCharsPerLine: 0,
      copies: 0,
    });
    const maxIdx = args.indexOf('-MaxChars');
    assert.equal(args[maxIdx + 1], '40');
    const copIdx = args.indexOf('-Copies');
    assert.equal(args[copIdx + 1], '1');
  });
});

describe('classicPrinter.findPsScript', () => {
  it('localiza scripts/print-classic.ps1 del proyecto', () => {
    const script = classicPrinter.findPsScript();
    assert.ok(script, 'debe devolver la ruta del script');
    assert.ok(fs.existsSync(script), 'el script debe existir en disco');
    assert.ok(script.endsWith('print-classic.ps1'), 'debe apuntar a print-classic.ps1');
  });
});
