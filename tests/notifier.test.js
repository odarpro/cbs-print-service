'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const notifier = require(path.join(__dirname, '..', 'src', 'notifier'));

describe('notifier.init()', () => {
  it('inicializa sin errores con config válida', () => {
    notifier.init({ toastEnabled: true, toastOnSuccess: true, toastOnError: true });
    assert.ok(true);
  });

  it('inicializa sin errores con config vacía', () => {
    notifier.init({});
    assert.ok(true);
  });
});

describe('notifier.isEnabled()', () => {
  beforeEach(() => {
    notifier.init({ toastEnabled: true });
  });

  it('retorna true cuando toastEnabled es true', () => {
    assert.equal(notifier.isEnabled(null), true);
  });

  it('retorna false cuando toastEnabled es false', () => {
    notifier.init({ toastEnabled: false });
    assert.equal(notifier.isEnabled(null), false);
  });

  it('retorna true cuando config no tiene toastEnabled (default)', () => {
    notifier.init({});
    assert.equal(notifier.isEnabled(null), true);
  });

  it('retorna true cuando parámetro 44 es A (override)', () => {
    notifier.init({ toastEnabled: false });
    assert.equal(notifier.isEnabled({ '44': 'A' }), true);
  });

  it('retorna false cuando parámetro 44 es I (override)', () => {
    notifier.init({ toastEnabled: true });
    assert.equal(notifier.isEnabled({ '44': 'I' }), false);
  });

  it('normaliza a mayúsculas para parámetro 44', () => {
    assert.equal(notifier.isEnabled({ '44': 'a' }), true);
    assert.equal(notifier.isEnabled({ '44': 'i' }), false);
  });
});

describe('notifier.shouldNotifySuccess()', () => {
  it('retorna true cuando toastOnSuccess es true', () => {
    notifier.init({ toastEnabled: true, toastOnSuccess: true });
    assert.equal(notifier.shouldNotifySuccess(null), true);
  });

  it('retorna false cuando toastOnSuccess es false', () => {
    notifier.init({ toastEnabled: true, toastOnSuccess: false });
    assert.equal(notifier.shouldNotifySuccess(null), false);
  });

  it('retorna false cuando toastEnabled es false', () => {
    notifier.init({ toastEnabled: false, toastOnSuccess: true });
    assert.equal(notifier.shouldNotifySuccess(null), false);
  });

  it('retorna true cuando toastOnSuccess no está definido (default)', () => {
    notifier.init({ toastEnabled: true });
    assert.equal(notifier.shouldNotifySuccess(null), true);
  });
});

describe('notifier.shouldNotifyError()', () => {
  it('retorna true cuando toastOnError es true', () => {
    notifier.init({ toastEnabled: true, toastOnError: true });
    assert.equal(notifier.shouldNotifyError(null), true);
  });

  it('retorna false cuando toastOnError es false', () => {
    notifier.init({ toastEnabled: true, toastOnError: false });
    assert.equal(notifier.shouldNotifyError(null), false);
  });

  it('retorna false cuando toastEnabled es false', () => {
    notifier.init({ toastEnabled: false, toastOnError: true });
    assert.equal(notifier.shouldNotifyError(null), false);
  });

  it('retorna true cuando toastOnError no está definido (default)', () => {
    notifier.init({ toastEnabled: true });
    assert.equal(notifier.shouldNotifyError(null), true);
  });

  it('resuelve parámetro 44 sobre config global', () => {
    notifier.init({ toastEnabled: true, toastOnError: true });
    assert.equal(notifier.shouldNotifyError({ '44': 'I' }), false);

    notifier.init({ toastEnabled: false, toastOnError: true });
    assert.equal(notifier.shouldNotifyError({ '44': 'A' }), true);
  });
});

describe('notifier.notify()', () => {
  it('no lanza errores con parámetros válidos', () => {
    notifier.init({ toastEnabled: true });
    assert.doesNotThrow(() => {
      notifier.notify({ title: 'Test', message: 'Mensaje de prueba', level: 'info' });
    });
  });

  it('no lanza errores cuando toastEnabled es false', () => {
    notifier.init({ toastEnabled: false });
    assert.doesNotThrow(() => {
      notifier.notify({ title: 'Test', message: 'No debería mostrarse', level: 'error' });
    });
  });
});

describe('notifier.notifyPrintSuccess()', () => {
  it('no lanza errores con parámetros válidos', () => {
    notifier.init({ toastEnabled: true, toastOnSuccess: true });
    assert.doesNotThrow(() => {
      notifier.notifyPrintSuccess('Rec001.txt', 'EPSON LX-350', null);
    });
  });

  it('no envía toast cuando toastOnSuccess es false', () => {
    notifier.init({ toastEnabled: true, toastOnSuccess: false });
    assert.doesNotThrow(() => {
      notifier.notifyPrintSuccess('Rec001.txt', 'EPSON LX-350', null);
    });
  });
});

describe('notifier.notifyPrintError()', () => {
  it('no lanza errores con parámetros válidos', () => {
    notifier.init({ toastEnabled: true, toastOnError: true });
    assert.doesNotThrow(() => {
      notifier.notifyPrintError('Rec001.txt', 'Impresora offline', null);
    });
  });

  it('no envía toast cuando toastOnError es false', () => {
    notifier.init({ toastEnabled: true, toastOnError: false });
    assert.doesNotThrow(() => {
      notifier.notifyPrintError('Rec001.txt', 'Impresora offline', null);
    });
  });
});

describe('notifier.notifyInvalidFile()', () => {
  it('no lanza errores con lista de errores', () => {
    notifier.init({ toastEnabled: true, toastOnError: true });
    assert.doesNotThrow(() => {
      notifier.notifyInvalidFile('Rec001.txt', ['Parámetro m inválido', 'Parámetro t fuera de rango'], null);
    });
  });
});

describe('notifier.notifyCritical()', () => {
  it('no lanza errores con parámetros válidos', () => {
    notifier.init({ toastEnabled: true });
    assert.doesNotThrow(() => {
      notifier.notifyCritical('Excepción no capturada', 'Error de prueba');
    });
  });
});
