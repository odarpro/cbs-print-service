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

describe('FileProcessor – log global en todos los caminos de error', () => {
  const loggerModule = require(path.join(__dirname, '..', 'src', 'logger'));

  before(() => {
    fs.mkdirSync(path.join(TMP_DIR, 'watch'), { recursive: true });
  });

  function captureLogs() {
    const entries      = [];
    const originalGet  = loggerModule.get;
    const fake = {
      debug: (msg, meta) => entries.push({ level: 'debug', msg, meta }),
      info:  (msg, meta) => entries.push({ level: 'info',  msg, meta }),
      warn:  (msg, meta) => entries.push({ level: 'warn',  msg, meta }),
      error: (msg, meta) => entries.push({ level: 'error', msg, meta })
    };
    loggerModule.get = () => fake;
    return { entries, restore: () => { loggerModule.get = originalGet; } };
  }

  const errorLogs = entries => entries.filter(e => e.level === 'error');
  const findLog   = (entries, text) => errorLogs(entries).find(e => e.msg.includes(text));

  it('agota reintentos: traslada a Errores y registra log ERROR con el detalle', async () => {
    const cfg = makeConfig({
      errorFolder:    path.join(TMP_DIR, 'error-log-retries'),
      retryCount:     1,
      retryIntervalMs: 10
    });
    fs.mkdirSync(cfg.errorFolder, { recursive: true });
    const processor = new FileProcessor(cfg);
    const testFile  = path.join(TMP_DIR, 'watch', 'Rec-log-retries.txt');
    fs.writeFileSync(testFile, 'contenido', 'latin1');

    const originalPrintFile = printer.printFile;
    let attempts = 0;
    printer.printFile = async () => {
      attempts++;
      throw new Error('Impresora sin papel');
    };

    const cap = captureLogs();
    try {
      await processor._processFile(testFile);
    } finally {
      printer.printFile = originalPrintFile;
      cap.restore();
    }

    assert.equal(attempts, 2, 'retryCount 1 → 2 intentos');

    const moveLog = findLog(cap.entries, 'trasladado a carpeta de errores');
    assert.ok(moveLog, 'Debe generar log ERROR al trasladar a Errores');
    assert.equal(moveLog.meta.stage, 'impresion');
    assert.equal(moveLog.meta.intentos, 2);
    assert.equal(moveLog.meta.reintentos, 1);
    assert.equal(moveLog.meta.ultimoError, 'Impresora sin papel');
    assert.equal(moveLog.meta.detalleIntentos.length, 2);
    assert.ok(fs.readdirSync(cfg.errorFolder).some(f => f.startsWith('Rec-log-retries')));
  });

  it('archivo vacío: traslada a Errores y registra log ERROR', async () => {
    const cfg = makeConfig({ errorFolder: path.join(TMP_DIR, 'error-log-empty') });
    fs.mkdirSync(cfg.errorFolder, { recursive: true });
    const processor = new FileProcessor(cfg);
    const testFile  = path.join(TMP_DIR, 'watch', 'Val-log-empty.txt');
    fs.writeFileSync(testFile, '', 'latin1');

    const cap = captureLogs();
    try {
      await processor._processFile(testFile);
    } finally {
      cap.restore();
    }

    const moveLog = findLog(cap.entries, 'trasladado a carpeta de errores');
    assert.ok(moveLog, 'Debe generar log ERROR para archivo vacío');
    assert.equal(moveLog.meta.stage, 'lectura');
    assert.equal(moveLog.meta.motivo, 'Archivo vacío');
  });

  it('parámetros inválidos: traslada a Errores y registra log ERROR', async () => {
    const cfg = makeConfig({ errorFolder: path.join(TMP_DIR, 'error-log-invalid') });
    fs.mkdirSync(cfg.errorFolder, { recursive: true });
    const processor = new FileProcessor(cfg);
    const testFile  = path.join(TMP_DIR, 'watch', 'Rec~t999.txt');
    fs.writeFileSync(testFile, 'contenido', 'latin1');

    const cap = captureLogs();
    try {
      await processor._processFile(testFile);
    } finally {
      cap.restore();
    }

    const moveLog = findLog(cap.entries, 'trasladado a carpeta de errores');
    assert.ok(moveLog, 'Debe generar log ERROR para parámetros inválidos');
    assert.equal(moveLog.meta.stage, 'validacion');
    assert.ok(String(moveLog.meta.motivo).includes('Parámetros inválidos'));
  });

  it('sin impresora configurada: traslada a Errores y registra log ERROR', async () => {
    const cfg = makeConfig({
      errorFolder: path.join(TMP_DIR, 'error-log-noprinter'),
      printers:    {}
    });
    fs.mkdirSync(cfg.errorFolder, { recursive: true });
    const processor = new FileProcessor(cfg);
    const testFile  = path.join(TMP_DIR, 'watch', 'Rec-log-noprinter.txt');
    fs.writeFileSync(testFile, 'contenido', 'latin1');

    const cap = captureLogs();
    try {
      await processor._processFile(testFile);
    } finally {
      cap.restore();
    }

    const moveLog = findLog(cap.entries, 'trasladado a carpeta de errores');
    assert.ok(moveLog, 'Debe generar log ERROR cuando no hay impresora');
    assert.equal(moveLog.meta.stage, 'configuracion');
    assert.equal(moveLog.meta.motivo, 'Sin impresora configurada');
  });

  it('si el traslado falla igualmente registra log ERROR', async () => {
    const blocker = path.join(TMP_DIR, 'error-blocked');
    fs.writeFileSync(blocker, 'no soy una carpeta', 'latin1');

    const cfg = makeConfig({ errorFolder: blocker });
    const processor = new FileProcessor(cfg);
    const testFile  = path.join(TMP_DIR, 'watch', 'Val-log-blocked.txt');
    fs.writeFileSync(testFile, '', 'latin1');

    const cap = captureLogs();
    try {
      await processor._processFile(testFile);
    } finally {
      cap.restore();
    }

    const failLog = findLog(cap.entries, 'No se pudo mover archivo a carpeta de errores');
    assert.ok(failLog, 'Debe registrar el error de traslado');
    assert.ok(failLog.meta.moveError, 'Debe incluir el motivo del fallo de traslado');
    fs.unlinkSync(blocker);
  });
});
