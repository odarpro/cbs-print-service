'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock logger
const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const { layoutLines } = require(path.join(__dirname, '..', 'src', 'gdiPrinter'));
const { evaluateStatus } = require(path.join(__dirname, '..', 'src', 'printer'));

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

describe('evaluateStatus (flags bloqueantes)', () => {
  it('estado 0 está OK en ambos modos', () => {
    assert.equal(evaluateStatus(0, false).ok, true);
    assert.equal(evaluateStatus(0, true).ok, true);
  });

  it('0x80 (offline) bloquea en modo tolerante y estricto', () => {
    const legacy = evaluateStatus(0x00000080, false);
    assert.equal(legacy.ok, false);
    assert.equal(legacy.reason, 'Impresora offline.');

    const strict = evaluateStatus(0x00000080, true);
    assert.equal(strict.ok, false);
  });

  it('0x02 (error) y 0x20 (sin papel) bloquean en modo tolerante', () => {
    assert.equal(evaluateStatus(0x00000002, false).ok, false);
    assert.equal(evaluateStatus(0x00000020, false).ok, false);
  });

  it('0x1000 (no disponible) NO bloquea en modo tolerante (comportamiento v3.2.2)', () => {
    const result = evaluateStatus(0x00001000, false);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'OK');
  });

  it('0x1000 (no disponible) SÍ bloquea en modo estricto', () => {
    const result = evaluateStatus(0x00001000, true);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'Impresora no disponible.');
    assert.equal(result.flag, 0x00001000);
  });

  it('flags que solo bloquean en estricto: 0x1, 0x4, 0x8, 0x10, 0x800, 0x100000', () => {
    const soloEstrictos = [0x00000001, 0x00000004, 0x00000008, 0x00000010, 0x00000800, 0x00100000];
    for (const flag of soloEstrictos) {
      assert.equal(evaluateStatus(flag, false).ok, true, `flag 0x${flag.toString(16)} no debe bloquear en tolerante`);
      assert.equal(evaluateStatus(flag, true).ok, false, `flag 0x${flag.toString(16)} debe bloquear en estricto`);
    }
  });

  it('un estado combinado bloquea si algún flag de la lista coincide', () => {
    // 0x1000 (solo estricto) + 0x80 (ambos) → bloquea en ambos modos
    const combinado = 0x00001000 | 0x00000080;
    assert.equal(evaluateStatus(combinado, false).ok, false);
    assert.equal(evaluateStatus(combinado, true).ok, false);
    // 0x1000 + 0x400 (PRINTING, no bloqueante) → solo bloquea en estricto
    const conImpresion = 0x00001000 | 0x00000400;
    assert.equal(evaluateStatus(conImpresion, false).ok, true);
    assert.equal(evaluateStatus(conImpresion, true).ok, false);
  });

  it('entradas no numéricas o null se tratan como 0', () => {
    assert.equal(evaluateStatus(null, true).ok, true);
    assert.equal(evaluateStatus(undefined, false).ok, true);
    assert.equal(evaluateStatus('garbage', false).ok, true);
  });
});
