'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeRetentionDays, removeExpiredFiles } = require(path.join(__dirname, '..', 'src', 'retentionCleaner'));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-retention-test-'));

after(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

describe('retentionCleaner', () => {
  it('usa el valor configurado solo si es al menos un día', () => {
    assert.equal(normalizeRetentionDays(15, 30), 15);
    assert.equal(normalizeRetentionDays(0, 30), 30);
    assert.equal(normalizeRetentionDays('invalido', 30), 30);
  });

  it('elimina solo archivos vencidos y conserva los recientes', () => {
    const dir = path.join(TMP_DIR, 'files');
    fs.mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, 'old.txt');
    const recentFile = path.join(dir, 'recent.txt');
    const nestedDir = path.join(dir, 'nested');
    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(recentFile, 'recent');
    fs.mkdirSync(nestedDir);
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));

    const result = removeExpiredFiles(dir, 30, new Date('2026-02-15T00:00:00Z').getTime());

    assert.deepEqual(result, { deleted: 1, errors: 0 });
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(recentFile), true);
    assert.equal(fs.existsSync(nestedDir), true);
  });
});
