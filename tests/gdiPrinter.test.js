'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock logger
const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const { renderGdi, wordWrap } = require(path.join(__dirname, '..', 'src', 'gdiPrinter'));

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
