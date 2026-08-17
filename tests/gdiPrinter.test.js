'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock logger
const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const { printGdi, wordWrap, layoutLines, getPrinterPort, isPortPromptPort } = require(path.join(__dirname, '..', 'src', 'gdiPrinter'));

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

describe('layoutLines (líneas a dibujar en modo GDI)', () => {
  it('convierte texto en arreglo de líneas con word-wrap', () => {
    const input = 'a'.repeat(50);
    const lines = layoutLines(input, 40);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].length, 40);
    assert.equal(lines[1].length, 10);
  });

  it('respeta saltos de línea existentes', () => {
    assert.deepEqual(layoutLines('hola\nmundo', 40), ['hola', 'mundo']);
  });

  it('usa 40 como ancho por defecto', () => {
    const input = 'x'.repeat(45);
    assert.equal(layoutLines(input).length, 2);
  });

  it('maneja ancho inválido o 0 sin romper', () => {
    assert.deepEqual(layoutLines('texto de prueba', 0), ['texto de prueba']);
    assert.deepEqual(layoutLines('texto de prueba', -5), ['texto de prueba']);
  });

  it('no deja líneas vacías por espacios finales', () => {
    const lines = layoutLines('a b c d e f', 3);
    assert.ok(lines.every(l => l.length > 0 && l.length <= 3));
  });
});

describe('isPortPromptPort (guard anti-bloqueo PORTPROMPT)', () => {
  it('detecta puertos PORTPROMPT', () => {
    assert.equal(isPortPromptPort('PORTPROMPT:'), true);
    assert.equal(isPortPromptPort('portprompt:'), true);
  });

  it('no marca puertos normales', () => {
    assert.equal(isPortPromptPort('LPT1:'), false);
    assert.equal(isPortPromptPort('USB001'), false);
    assert.equal(isPortPromptPort('C:\\Impresiones\\impresion.pdf'), false);
    assert.equal(isPortPromptPort(null), false);
    assert.equal(isPortPromptPort(undefined), false);
  });
});

describe('printGdi (integración worker thread)', () => {
  it('falla sin nombre de impresora', async () => {
    await assert.rejects(() => printGdi('hola', {}), /nombre de la impresora/);
  });

  it('rechaza con impresora inexistente sin colgar (worker devuelve error)', async () => {
    await assert.rejects(
      () => printGdi('hola', { printerName: 'ImpresoraInexistenteXYZ987', timeoutMs: 5000 }),
      /Modo GDI real/
    );
  });

  it('getPrinterPort no lanza con impresora inexistente', async () => {
    const port = await getPrinterPort('ImpresoraInexistenteXYZ987');
    assert.equal(port, null);
  });
});
