'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock logger
const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const { layoutLines } = require(path.join(__dirname, '..', 'src', 'gdiPrinter'));

describe('Integración GDI → Printer', () => {
  it('layoutLines produce word-wrap para modo GDI', () => {
    const input = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';
    const lines = layoutLines(input, 30);
    assert.ok(lines.length > 1);
    assert.ok(lines.every(l => l.length <= 30));
  });

  it('layoutLines preserva líneas existentes más cortas que maxCharsPerLine', () => {
    const input = 'hola\nmundo\ncorto';
    assert.deepEqual(layoutLines(input, 40), ['hola', 'mundo', 'corto']);
  });

  it('layoutLines mantiene una sola línea cuando el texto cabe', () => {
    assert.deepEqual(layoutLines('test line', 40), ['test line']);
  });
});
