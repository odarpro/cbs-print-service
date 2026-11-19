'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  needsRecovery,
  configuredPrinterNames,
  clearWorkOfflineFlag,
  clearWorkOffline,
  recoverPrinters,
  ATTR_WORK_OFFLINE,
  STATUS_OFFLINE,
  STATUS_NOT_AVAILABLE,
  STATUS_PAUSED
} = require(path.join(__dirname, '..', 'src', 'printerRecovery'));

describe('needsRecovery (función pura)', () => {
  it('false para null/undefined/objetos vacíos', () => {
    assert.equal(needsRecovery(null), false);
    assert.equal(needsRecovery(undefined), false);
    assert.equal(needsRecovery({}), false);
    assert.equal(needsRecovery('string'), false);
  });

  it('false cuando statusNumber es 0 o solo tiene flags no relacionados', () => {
    assert.equal(needsRecovery({ statusNumber: 0 }), false);
    assert.equal(needsRecovery({ statusNumber: 0x00000800 }), false); // PRINTING
    assert.equal(needsRecovery({ statusNumber: 0x00000004 }), false); // ERROR (no en la lista)
  });

  it('true con bit Offline (0x100)', () => {
    assert.equal(needsRecovery({ statusNumber: STATUS_OFFLINE }), true);
    assert.equal(needsRecovery({ statusNumber: 0x00000100 | 0x00000800 }), true);
  });

  it('true con bit NotAvailable (0x2000)', () => {
    assert.equal(needsRecovery({ statusNumber: STATUS_NOT_AVAILABLE }), true);
  });

  it('true con bit Paused (0x02)', () => {
    assert.equal(needsRecovery({ statusNumber: STATUS_PAUSED }), true);
  });

  it('true con el estado combinado Offline+NotAvailable del reporte post-reboot', () => {
    // 0x20184 = registry Status tras reinicio (incluye OFFLINE 0x100)
    assert.equal(needsRecovery({ statusNumber: 0x20184 }), true);
  });

  it('true si el array status contiene Offline/NotAvailable/Paused', () => {
    assert.equal(needsRecovery({ statusNumber: 0, status: ['OFFLINE'] }), true);
    assert.equal(needsRecovery({ statusNumber: 0, status: ['NotAvailable'] }), true);
    assert.equal(needsRecovery({ statusNumber: 0, status: ['PAUSED'] }), true);
    assert.equal(needsRecovery({ statusNumber: 0, status: ['Busy', 'Offline'] }), true);
  });

  it('false si el array status solo tiene valores benignos', () => {
    assert.equal(needsRecovery({ statusNumber: 0, status: ['IDLE'] }), false);
    assert.equal(needsRecovery({ statusNumber: 0, status: [] }), false);
    assert.equal(needsRecovery({ statusNumber: 0, status: ['PRINTING'] }), false);
  });

  it('ignora status no-array (string legado)', () => {
    assert.equal(needsRecovery({ statusNumber: 0, status: 'OFFLINE' }), false);
  });
});

describe('configuredPrinterNames (función pura)', () => {
  it('devuelve [] para config nula o sin printers', () => {
    assert.deepEqual(configuredPrinterNames(null), []);
    assert.deepEqual(configuredPrinterNames({}), []);
    assert.deepEqual(configuredPrinterNames({ printers: {} }), []);
  });

  it('extrae names únicos de todas las claves', () => {
    const config = {
      printers: {
        voucher: { name: 'Recibos', copies: 1 },
        slip: { name: 'Cheques', copies: 2 },
        otro: { name: 'Recibos' } // duplicado
      }
    };
    assert.deepEqual(configuredPrinterNames(config), ['Recibos', 'Cheques']);
  });

  it('ignora entradas sin name', () => {
    const config = {
      printers: {
        a: { name: 'Recibos' },
        b: {},
        c: { name: '' }
      }
    };
    assert.deepEqual(configuredPrinterNames(config), ['Recibos']);
  });
});

describe('clearWorkOfflineFlag (función pura)', () => {
  it('0x400 es el bit correcto', () => {
    assert.equal(ATTR_WORK_OFFLINE, 0x400);
  });

  it('no cambia un valor sin el bit (Attributes=2624=0xA40 del reporte)', () => {
    assert.equal(clearWorkOfflineFlag(2624), 2624);
    assert.equal(clearWorkOfflineFlag(0), 0);
  });

  it('quita solo el bit WorkOffline', () => {
    // 0xE40 = 0xA40 | 0x400 → 0xA40
    assert.equal(clearWorkOfflineFlag(0xE40), 0xA40);
    assert.equal(clearWorkOfflineFlag(0x400), 0);
    // bit alto no afectado
    assert.equal(clearWorkOfflineFlag(0x80000 | 0x400), 0x80000);
  });

  it('devuelve siempre entero sin signo 32-bit', () => {
    const r = clearWorkOfflineFlag(0x400 | 0x80000000);
    assert.ok(r >= 0);
    assert.equal(r, 0x80000000);
  });

  it('valores no numéricos → 0', () => {
    assert.equal(clearWorkOfflineFlag(null), 0);
    assert.equal(clearWorkOfflineFlag('abc'), 0);
    assert.equal(clearWorkOfflineFlag(undefined), 0);
  });
});

describe('clearWorkOffline (con exec inyectado)', () => {
  function makeExec(attributesHex) {
    return async (cmd, args) => {
      if (cmd === 'reg.exe' && args[0] === 'query') {
        if (attributesHex === null) {
          return { code: 1, output: 'ERROR: no encontrado' };
        }
        return { code: 0, output: `HKEY_LOCAL_MACHINE\\...\r\n    Attributes    REG_DWORD    ${attributesHex}` };
      }
      if (cmd === 'reg.exe' && args[0] === 'add') {
        return { code: 0, output: 'La operación se completó correctamente.' };
      }
      return { code: 1, output: 'unexpected' };
    };
  }

  it('no hace nada si el bit no está activo', async () => {
    let wrote = false;
    const exec = async (cmd, args) => {
      if (args[0] === 'query') return { code: 0, output: 'Attributes    REG_DWORD    0xa40' };
      wrote = true;
      return { code: 0, output: '' };
    };
    const r = await clearWorkOffline('Recibos', exec);
    assert.equal(r.changed, false);
    assert.equal(r.from, 0xa40);
    assert.equal(wrote, false);
  });

  it('quita el bit y escribe el valor nuevo', async () => {
    let written = null;
    const exec = async (cmd, args) => {
      if (args[0] === 'query') return { code: 0, output: 'Attributes    REG_DWORD    0xe40' };
      if (args[0] === 'add') {
        written = Number(args[args.indexOf('/d') + 1]);
        return { code: 0, output: 'ok' };
      }
      return { code: 1, output: '' };
    };
    const r = await clearWorkOffline('Recibos', exec);
    assert.equal(r.changed, true);
    assert.equal(r.from, 0xe40);
    assert.equal(r.to, 0xa40);
    assert.equal(written, 0xa40);
  });

  it('no lanza si reg query falla', async () => {
    const exec = async () => ({ code: 1, output: 'ERROR' });
    const r = await clearWorkOffline('Recibos', exec);
    assert.equal(r.changed, false);
    assert.equal(r.error, 'Attributes no legible');
  });

  it('no lanza si exec lanza excepción', async () => {
    const exec = async () => { throw new Error('boom'); };
    const r = await clearWorkOffline('Recibos', exec);
    assert.equal(r.changed, false);
    assert.equal(r.error, 'boom');
  });
});

describe('recoverPrinters (nunca lanza)', () => {
  const offlinePrinter = {
    name: 'Recibos',
    statusNumber: STATUS_OFFLINE,
    status: ['OFFLINE']
  };
  const healthyPrinter = {
    name: 'Recibos',
    statusNumber: 0,
    status: []
  };

  function makeJobTracker(printers) {
    return {
      isAvailable: () => true,
      resolvePrinterName: (n) => (printers.some(p => p.name === n) ? n : null),
      getPrinters: () => printers.map(p => ({ ...p }))
    };
  }

  const silentExec = async () => ({ code: 1, output: '' });

  it('skipped si recoverPrintersOnBoot === false', async () => {
    const r = await recoverPrinters({ recoverPrintersOnBoot: false, printers: { a: { name: 'X' } } }, {
      jobTracker: makeJobTracker([offlinePrinter]),
      exec: silentExec,
      log: () => {}
    });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'deshabilitado en config');
  });

  it('skipped si no hay impresoras configuradas', async () => {
    const r = await recoverPrinters({ printers: {} }, {
      jobTracker: makeJobTracker([]),
      exec: silentExec
    });
    assert.equal(r.skipped, true);
  });

  it('skipped si jobTracker no está disponible', async () => {
    const r = await recoverPrinters({ printers: { a: { name: 'Recibos' } } }, {
      jobTracker: { isAvailable: () => false },
      exec: silentExec
    });
    assert.equal(r.skipped, true);
    assert.match(r.reason, /no disponible/);
  });

  it('skipped si ninguna impresora resuelve', async () => {
    const r = await recoverPrinters({ printers: { a: { name: 'NoExiste' } } }, {
      jobTracker: makeJobTracker([]),
      exec: silentExec
    });
    assert.equal(r.skipped, true);
    assert.ok(r.errors.length >= 1);
  });

  it('recupera cuando la impresora pasa a Normal en el primer re-check', async () => {
    // Offline en la primera lectura (resolve/re-check inicial); sano en el re-check
    let call = 0;
    const jt = {
      isAvailable: () => true,
      resolvePrinterName: (n) => (n === 'Recibos' ? 'Recibos' : null),
      getPrinters: () => {
        call++;
        return call === 1
          ? [{ ...offlinePrinter }]
          : [{ ...healthyPrinter }];
      }
    };

    const sleepCalls = [];
    const r = await recoverPrinters(
      {
        printers: { slip: { name: 'Recibos' } },
        printerRecoveryAttempts: 3,
        printerRecoveryIntervalMs: 10,
        restartSpoolerIfOffline: false
      },
      {
        jobTracker: jt,
        exec: silentExec,
        log: () => {},
        sleep: async (ms) => { sleepCalls.push(ms); },
        restartSpoolerFn: async () => { throw new Error('no debe reiniciar Spooler'); }
      }
    );

    assert.equal(r.skipped, false);
    assert.equal(r.recovered, 1);
    assert.equal(r.stillOffline, 0);
    assert.equal(r.spoolerRestarted, false);
    assert.ok(Array.isArray(r.errors));
  });

  it('marca recovered cuando el estado se vuelve sano', async () => {
    let call = 0;
    const jt = {
      isAvailable: () => true,
      resolvePrinterName: () => 'Recibos',
      getPrinters: () => {
        call++;
        // Primera lectura (re-check): offline; siguientes: sano
        return call === 1
          ? [{ ...offlinePrinter }]
          : [{ ...healthyPrinter }];
      }
    };

    const r = await recoverPrinters(
      {
        printers: { slip: { name: 'Recibos' } },
        printerRecoveryAttempts: 4,
        printerRecoveryIntervalMs: 1
      },
      {
        jobTracker: jt,
        exec: silentExec,
        log: () => {},
        sleep: async () => {}
      }
    );

    assert.equal(r.recovered, 1);
    assert.equal(r.stillOffline, 0);
    assert.equal(r.skipped, false);
  });

  it('no relanza excepción si jobTracker.getPrinters lanza', async () => {
    const jt = {
      isAvailable: () => true,
      resolvePrinterName: () => 'Recibos',
      getPrinters: () => { throw new Error('native crash'); }
    };
    const logs = [];
    const r = await recoverPrinters(
      { printers: { slip: { name: 'Recibos' } } },
      { jobTracker: jt, exec: silentExec, log: (m, meta) => logs.push(m + JSON.stringify(meta || {})) }
    );
    assert.equal(r.skipped, false);
    assert.ok(r.errors.some(e => /native crash/.test(e)));
    assert.ok(logs.some(l => /no bloquea el arranque/.test(l)));
  });

  it('intenta restartSpooler tras agotar intentos cuando restartSpoolerIfOffline=true', async () => {
    const jt = {
      isAvailable: () => true,
      resolvePrinterName: () => 'Recibos',
      getPrinters: () => [{ ...offlinePrinter }]
    };
    let restarted = false;
    const r = await recoverPrinters(
      {
        printers: { slip: { name: 'Recibos' } },
        printerRecoveryAttempts: 2,
        printerRecoveryIntervalMs: 1,
        restartSpoolerIfOffline: true
      },
      {
        jobTracker: jt,
        exec: silentExec,
        log: () => {},
        sleep: async () => {},
        restartSpoolerFn: async () => { restarted = true; return true; }
      }
    );
    assert.equal(restarted, true);
    assert.equal(r.spoolerRestarted, true);
    assert.equal(r.stillOffline, 1);
    assert.equal(r.skipped, false);
  });

  it('no reinicia Spooler si restartSpoolerIfOffline=false', async () => {
    const jt = {
      isAvailable: () => true,
      resolvePrinterName: () => 'Recibos',
      getPrinters: () => [{ ...offlinePrinter }]
    };
    let restarted = false;
    const r = await recoverPrinters(
      {
        printers: { slip: { name: 'Recibos' } },
        printerRecoveryAttempts: 2,
        printerRecoveryIntervalMs: 1,
        restartSpoolerIfOffline: false
      },
      {
        jobTracker: jt,
        exec: silentExec,
        log: () => {},
        sleep: async () => {},
        restartSpoolerFn: async () => { restarted = true; return true; }
      }
    );
    assert.equal(restarted, false);
    assert.equal(r.spoolerRestarted, false);
    assert.equal(r.stillOffline, 1);
  });

  it('siempre devuelve objeto con forma conocida aunque todo falle', async () => {
    const r = await recoverPrinters(
      { printers: { a: { name: 'X' } } },
      {
        jobTracker: { isAvailable: () => { throw new Error('fail'); } },
        exec: silentExec,
        log: () => {}
      }
    );
    assert.equal(typeof r.skipped, 'boolean');
    assert.equal(typeof r.checked, 'number');
    assert.equal(typeof r.recovered, 'number');
    assert.equal(typeof r.stillOffline, 'number');
    assert.equal(typeof r.spoolerRestarted, 'boolean');
    assert.equal(typeof r.attempts, 'number');
    assert.ok(Array.isArray(r.errors));
  });
});
