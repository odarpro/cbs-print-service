'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock logger
const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const { renderGdi } = require(path.join(__dirname, '..', 'src', 'gdiPrinter'));

describe('Integración GDI → Printer', () => {
  it('renderGdi produce texto con word-wrap para modo GDI', () => {
    const input = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';
    const result = renderGdi(input, { maxCharsPerLine: 30, bold: false });
    const lines = result.split('\n');
    assert.ok(lines.length > 1);
    assert.ok(lines.every(l => l.length <= 30));
  });

  it('renderGdi preserva líneas existentes más cortas que maxCharsPerLine', () => {
    const input = 'hola\nmundo\ncorto';
    const result = renderGdi(input, { maxCharsPerLine: 40, bold: false });
    assert.equal(result, input);
  });

  it('renderGdi con bold agrega ESC/P codes por línea', () => {
    const input = 'test line';
    const result = renderGdi(input, { maxCharsPerLine: 40, bold: true });
    assert.ok(result.startsWith('\x1BE'));
    assert.ok(result.endsWith('\x1BF'));
  });
});
