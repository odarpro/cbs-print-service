'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock logger
const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const { renderGdi, wordWrap, escFont, escSize } = require(path.join(__dirname, '..', 'src', 'gdiPrinter'));

describe('wordWrap', () => {
  it('envuelve línea larga sin espacios', () => {
    const input = 'a'.repeat(50);
    const result = wordWrap(input, 40);
    const lines = result.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0].length, 40);
    assert.equal(lines[1].length, 10);
  });

  it('envuelve línea larga con espacios', () => {
    const input = 'hola mundo esto es una prueba de word wrap';
    const result = wordWrap(input, 10);
    const lines = result.split('\n');
    assert.ok(lines.length >= 3);
    assert.ok(lines.every(l => l.length <= 10));
  });

  it('no modifica línea corta', () => {
    const input = 'línea corta';
    assert.equal(wordWrap(input, 40), input);
  });

  it('respeta saltos de línea existentes', () => {
    const input = 'línea 1\nlínea 2';
    assert.equal(wordWrap(input, 40), input);
  });

  it('retorna texto sin cambios si maxChars es 0', () => {
    const input = 'texto largo sin wrap';
    assert.equal(wordWrap(input, 0), input);
  });

  it('retorna texto sin cambios si maxChars es negativo', () => {
    const input = 'texto largo';
    assert.equal(wordWrap(input, -1), input);
  });
});

describe('renderGdi', () => {
  it('aplica word-wrap en modo GDI', () => {
    const input = 'a'.repeat(100) + '\n' + 'b'.repeat(100);
    const result = renderGdi(input, { maxCharsPerLine: 40, bold: false });
    const lines = result.split('\n');
    assert.equal(lines.length, 6);
    assert.ok(lines.every(l => l.length <= 40));
  });

  it('incluye códigos ESC/P cuando bold=true', () => {
    const input = 'texto';
    const result = renderGdi(input, { maxCharsPerLine: 40, bold: true });
    assert.ok(result.includes('\x1BE'));
    assert.ok(result.includes('\x1BF'));
  });

  it('no incluye códigos ESC/P cuando bold=false', () => {
    const input = 'texto';
    const result = renderGdi(input, { maxCharsPerLine: 40, bold: false });
    assert.ok(!result.includes('\x1BE'));
    assert.ok(!result.includes('\x1BF'));
  });
});

describe('escFont (TM-U950, ESC M n → Font A/B)', () => {
  it('mapea fuentes estándar a Font A', () => {
    assert.equal(escFont('Calibri'), '\x1BM\x00');
    assert.equal(escFont('Arial'), '\x1BM\x00');
    assert.equal(escFont('Times'), '\x1BM\x00');
    assert.equal(escFont('Sans'), '\x1BM\x00');
  });

  it('mapea fuentes angostas a Font B', () => {
    assert.equal(escFont('Courier'), '\x1BM\x01');
    assert.equal(escFont('Courier_New'), '\x1BM\x01');
    assert.equal(escFont('Draft'), '\x1BM\x01');
    assert.equal(escFont('Condensed'), '\x1BM\x01');
    assert.equal(escFont('OCR'), '\x1BM\x01');
  });

  it('no emite ESC k (no soportado por TM-U950)', () => {
    assert.ok(!escFont('Calibri').includes('\x1Bk'));
    assert.ok(!escFont('Courier').includes('\x1Bk'));
  });

  it('retorna vacío sin nombre de fuente', () => {
    assert.equal(escFont(undefined), '');
    assert.equal(escFont(null), '');
  });
});

describe('escSize (TM-U950, sin ESC g)', () => {
  it('t <= 8 → Font B', () => {
    assert.equal(escSize(6), '\x1BM\x01');
    assert.equal(escSize(8), '\x1BM\x01');
  });

  it('t 9-11 → sin comando (normal)', () => {
    assert.equal(escSize(9), '');
    assert.equal(escSize(10), '');
    assert.equal(escSize(11), '');
  });

  it('t 12-14 → doble altura (ESC ! 16)', () => {
    assert.equal(escSize(12), '\x1B!\x10');
    assert.equal(escSize(14), '\x1B!\x10');
  });

  it('t > 14 → doble altura + doble ancho (ESC ! 48)', () => {
    assert.equal(escSize(15), '\x1B!\x30');
    assert.equal(escSize(20), '\x1B!\x30');
  });

  it('no emite ESC g (solo 24/48 pines)', () => {
    assert.ok(!escSize(10).includes('\x1Bg'));
    assert.ok(!escSize(13).includes('\x1Bg'));
  });

  it('retorna vacío sin tamaño', () => {
    assert.equal(escSize(undefined), '');
    assert.equal(escSize('abc'), '');
  });
});

describe('renderGdi con f/t (TM-U950)', () => {
  it('emite ESC M n en el header y ESC @ al final', () => {
    const result = renderGdi('hola', { fontName: 'Calibri', fontSize: 10 });
    assert.ok(result.startsWith('\x1BM\x00'));
    assert.ok(result.endsWith('\x1B@'));
  });

  it('nunca emite ESC k ni ESC g ni ESC P', () => {
    const result = renderGdi('hola', { fontName: 'Courier_New', fontSize: 20 });
    assert.ok(!result.includes('\x1Bk'));
    assert.ok(!result.includes('\x1Bg'));
    assert.ok(!result.includes('\x1BP'));
  });

  it('sin f/t no agrega header ni footer', () => {
    const result = renderGdi('hola', { maxCharsPerLine: 40 });
    assert.equal(result, 'hola');
  });
});
