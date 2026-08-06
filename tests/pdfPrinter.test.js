'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pdfPrinter = require('../src/pdfPrinter');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('capturePdfTo: guarda el buffer como .pdf en la carpeta indicada', () => {
  const dir = makeTmpDir('cbs-capture-');
  const buffer = Buffer.from('%PDF-1.4 test content');

  const file = pdfPrinter.capturePdfTo(buffer, 'MiRecibo', dir);

  assert.ok(file, 'debe devolver la ruta del archivo');
  assert.ok(fs.existsSync(file), 'el archivo debe existir');
  assert.ok(file.endsWith('.pdf'), 'la extensión debe ser .pdf');
  assert.deepEqual(fs.readFileSync(file), buffer, 'el contenido debe ser el buffer original');
  assert.ok(path.basename(file).includes('MiRecibo'), 'el nombre debe contener el título');
});

test('capturePdfTo: devuelve null si no hay carpeta configurada (deshabilitado)', () => {
  assert.equal(pdfPrinter.capturePdfTo(Buffer.from('abc'), 'T', ''), null);
  assert.equal(pdfPrinter.capturePdfTo(Buffer.from('abc'), 'T', undefined), null);
  assert.equal(pdfPrinter.capturePdfTo(Buffer.from('abc'), 'T', null), null);
});

test('capturePdfTo: sanea caracteres inválidos del título y crea la carpeta', () => {
  const dir = path.join(makeTmpDir('cbs-capture-'), 'sub', 'nested');
  const file = pdfPrinter.capturePdfTo(Buffer.from('abc'), 'Rec~43H~pCapturaPDF~Trx-322.txt', dir);

  assert.ok(file, 'debe crear las subcarpetas y devolver la ruta');
  assert.ok(fs.existsSync(file), 'el archivo debe existir');
  const name = path.basename(file);
  assert.ok(!/[\s~()]/.test(name), 'el nombre no debe contener caracteres inválidos');
  assert.ok(name.includes('Trx-322'), 'debe conservar caracteres válidos');
});

test('capturePdfTo: usa nombre por defecto si el título queda vacío', () => {
  const dir = makeTmpDir('cbs-capture-');
  const file = pdfPrinter.capturePdfTo(Buffer.from('abc'), '   ~~~   ', dir);
  assert.ok(file, 'debe devolver una ruta');
  assert.ok(path.basename(file).includes('impresion'), 'debe usar "impresion" como nombre');
});
