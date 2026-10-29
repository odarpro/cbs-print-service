'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const logger = require(path.join(__dirname, '..', 'src', 'logger'));
logger.init({ logLevel: 'error', logFolder: process.env.TEMP || '.' });

const jobTracker = require(path.join(__dirname, '..', 'src', 'jobTracker'));

describe('jobTracker.makeDocumentName', () => {
  it('genera un nombre con prefijo CBSPrint| y único', () => {
    const a = jobTracker.makeDocumentName('Rec123.txt');
    const b = jobTracker.makeDocumentName('Rec123.txt');

    assert.ok(a.startsWith(jobTracker.PREFIX));
    assert.ok(b.startsWith(jobTracker.PREFIX));
    assert.notEqual(a, b);
    assert.ok(a.includes('Rec123.txt'));
  });

  it('reemplaza separadores internos y limita el largo', () => {
    const name = jobTracker.makeDocumentName('Rec|malo\n' + 'x'.repeat(200));
    assert.ok(name.startsWith(jobTracker.PREFIX));
    assert.ok(!name.slice(jobTracker.PREFIX.length).includes('|malo'));
    assert.ok(name.length <= 200);
  });

  it('makeJobKey devuelve una clave corta que coincide con el nombre completo', () => {
    const name = jobTracker.makeDocumentName('Rec123.txt');
    const key = jobTracker.makeJobKey(name);

    assert.ok(key.startsWith(jobTracker.PREFIX));
    assert.ok(name.startsWith(key));
    assert.ok(key.length < name.length);
    assert.ok(`${name} (copia 1/2)`.startsWith(key));
  });

  it('makeJobKey no altera nombres ajenos', () => {
    assert.equal(jobTracker.makeJobKey('Recibo'), 'Recibo');
    assert.equal(jobTracker.makeJobKey(''), '');
  });
});

describe('jobTracker.isCbsDocument', () => {
  it('reconoce solo documentos con el prefijo propio', () => {
    assert.equal(jobTracker.isCbsDocument('CBSPrint|Rec1.txt|2026'), true);
    assert.equal(jobTracker.isCbsDocument('Rec1.txt'), false);
    assert.equal(jobTracker.isCbsDocument(''), false);
    assert.equal(jobTracker.isCbsDocument(null), false);
  });
});

describe('jobTracker.matchesLegacyCbsDocument', () => {
  it('detecta nombres de versiones anteriores', () => {
    assert.equal(jobTracker.matchesLegacyCbsDocument('Recibo'), true);
    assert.equal(jobTracker.matchesLegacyCbsDocument('Rec123.txt'), true);
    assert.equal(jobTracker.matchesLegacyCbsDocument('Val123.txt'), true);
    assert.equal(jobTracker.matchesLegacyCbsDocument('Rec123.txt (copia 1/2)'), true);
  });

  it('no marca documentos ajenos', () => {
    assert.equal(jobTracker.matchesLegacyCbsDocument('Factura.pdf'), false);
    assert.equal(jobTracker.matchesLegacyCbsDocument('documento.txt'), false);
    assert.equal(jobTracker.matchesLegacyCbsDocument(''), false);
  });
});

describe('jobTracker estados de job', () => {
  it('normaliza status a mayúsculas', () => {
    assert.deepEqual(jobTracker.jobStatuses({ status: ['printing', 'Spooling'] }), ['PRINTING', 'SPOOLING']);
    assert.deepEqual(jobTracker.jobStatuses({ status: 'Printed' }), ['PRINTED']);
    assert.deepEqual(jobTracker.jobStatuses({}), []);
    assert.deepEqual(jobTracker.jobStatuses(null), []);
  });

  it('detecta trabajos finalizados', () => {
    assert.equal(jobTracker.isJobFinished({ status: ['PRINTED'] }), true);
    assert.equal(jobTracker.isJobFinished({ status: ['COMPLETE'] }), true);
    assert.equal(jobTracker.isJobFinished({ status: ['DELETED'] }), true);
    assert.equal(jobTracker.isJobFinished({ status: ['PRINTING'] }), false);
    assert.equal(jobTracker.isJobFinished({ statusNumber: 0x00000080 }), true);
    assert.equal(jobTracker.isJobFinished({ statusNumber: 0 }), false);
  });

  it('detecta trabajos bloqueados', () => {
    assert.equal(jobTracker.isJobBlocked({ status: ['ERROR'] }), true);
    assert.equal(jobTracker.isJobBlocked({ status: ['OFFLINE'] }), true);
    assert.equal(jobTracker.isJobBlocked({ status: ['BLOCKED-DEVQ'] }), true);
    assert.equal(jobTracker.isJobBlocked({ status: ['PRINTING'] }), false);
  });

  it('describeJobs resume id, documento y estado', () => {
    const result = jobTracker.describeJobs([
      { id: 7, document: 'CBSPrint|x', status: ['PRINTING'], statusNumber: 1 }
    ]);
    assert.deepEqual(result, [{ id: 7, document: 'CBSPrint|x', status: 'PRINTING' }]);
  });
});

describe('jobTracker.waitForJobsToClear', () => {
  it('devuelve not-seen si el trabajo nunca aparece en la cola', async () => {
    const result = await jobTracker.waitForJobsToClear(
      'ImpresoraInexistenteXYZ987',
      'CBSPrint|',
      { appearGraceMs: 20, timeoutMs: 1000, pollMs: 10 }
    );
    assert.equal(result.outcome, 'not-seen');
  });

  it('lanza JobAbortedError si la señal ya está abortada', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => jobTracker.waitForJobsToClear(
        'ImpresoraInexistenteXYZ987',
        'CBSPrint|',
        { appearGraceMs: 20, timeoutMs: 1000, pollMs: 10, signal: controller.signal }
      ),
      err => err.code === 'CBS_JOB_ABORTED'
    );
  });
});

describe('jobTracker limpieza', () => {
  it('resolvePrinterName devuelve null para nombre vacío', () => {
    assert.equal(jobTracker.resolvePrinterName(''), null);
    assert.equal(jobTracker.resolvePrinterName(null), null);
  });

  it('cleanupCbsJobs no falla con impresora inexistente', () => {
    const result = jobTracker.cleanupCbsJobs('ImpresoraInexistenteXYZ987');
    assert.equal(result.found, 0);
    assert.equal(result.deleted, 0);
    assert.deepEqual(result.jobs, []);
  });

  it('expone disponibilidad del módulo nativo como booleano', () => {
    assert.equal(typeof jobTracker.isAvailable(), 'boolean');
  });
});
