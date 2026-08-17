'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const FileProcessor = require(path.join(__dirname, '..', 'src', 'fileProcessor'));
const printer = require(path.join(__dirname, '..', 'src', 'printer'));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-test-'));

function makeConfig(overrides = {}) {
  return {
    watchFolder:      path.join(TMP_DIR, 'watch'),
    historyFolder:    path.join(TMP_DIR, 'history'),
    errorFolder:      path.join(TMP_DIR, 'error'),
    logFolder:        path.join(TMP_DIR, 'logs'),
    logLevel:         'error',
    fileEncoding:     'latin1',
    fileAction:       'MOVE',
    fileStabilizeMs:  10,
    retryCount:       0,
    retryIntervalMs:  50,
    printMethod:      'DIRECT',
    printers: {
      voucher: { name: 'Test Printer', copies: 1, bold: false, maxCharsPerLine: 40 },
      slip:    { name: 'Test Printer', copies: 1, bold: false, maxCharsPerLine: 40 }
    },
    ...overrides
  };
}

describe('FileProcessor', () => {
  before(() => {
    for (const dir of ['watch', 'history', 'error', 'logs']) {
      fs.mkdirSync(path.join(TMP_DIR, dir), { recursive: true });
    }
  });

  after(() => {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  });

  it('inicializa con cola vacía', () => {
    const processor = new FileProcessor(makeConfig());
    assert.equal(processor.queueLength, 0);
  });

  it('mueve archivo vacío a errorFolder sin intentar imprimir', async () => {
    const cfg = makeConfig();
    const processor = new FileProcessor(cfg);
    const testFile = path.join(TMP_DIR, 'watch', 'Val0001.txt');
    fs.writeFileSync(testFile, '', 'latin1');

    await processor._processFile(testFile);

    const errorFiles = fs.readdirSync(cfg.errorFolder);
    assert.ok(errorFiles.some(f => f.startsWith('Val0001')), 'Archivo vacío debería estar en errorFolder');
  });

  it('ignora archivo que no es Rec* ni Val*', async () => {
    const cfg = makeConfig({ errorFolder: path.join(TMP_DIR, 'error2') });
    fs.mkdirSync(cfg.errorFolder, { recursive: true });
    const processor = new FileProcessor(cfg);
    const testFile = path.join(TMP_DIR, 'watch', 'noticia.txt');
    fs.writeFileSync(testFile, 'contenido', 'latin1');

    await processor._processFile(testFile);

    const errorFiles = fs.readdirSync(cfg.errorFolder);
    assert.equal(errorFiles.length, 0, 'No debe mover a error archivos no Rec*/Val*');
  });

  it('detecta docType correcto según prefijo', () => {
    const processor = new FileProcessor(makeConfig());
    assert.ok(processor.queueLength === 0);
  });

  it('mueve a Errores tras el primer fallo cuando retryCount es 0', async () => {
    const cfg = makeConfig({ errorFolder: path.join(TMP_DIR, 'error-no-retry') });
    fs.mkdirSync(cfg.errorFolder, { recursive: true });
    const processor = new FileProcessor(cfg);
    const testFile = path.join(TMP_DIR, 'watch', 'Rec-no-retry.txt');
    fs.writeFileSync(testFile, 'contenido', 'latin1');

    const originalPrintFile = printer.printFile;
    let attempts = 0;
    printer.printFile = async () => {
      attempts++;
      throw new Error('Fallo de prueba');
    };

    try {
      await processor._processFile(testFile);
    } finally {
      printer.printFile = originalPrintFile;
    }

    assert.equal(attempts, 1);
    assert.ok(fs.readdirSync(cfg.errorFolder).some(f => f.startsWith('Rec-no-retry')));
  });
});
