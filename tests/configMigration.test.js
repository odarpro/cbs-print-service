'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { migrateConfig } = require(path.join(__dirname, '..', 'src', 'configMigration'));

describe('configMigration', () => {
  it('agrega defaults 3/15/1 y flags anti-bloqueo', () => {
    const cfg = { watchFolder: 'D:\\Impresiones' };
    const changes = migrateConfig(cfg);

    assert.equal(cfg.historyRetentionDays, 3);
    assert.equal(cfg.errorRetentionDays, 15);
    assert.equal(cfg.alertRetentionDays, 1);
    assert.equal(cfg.gdiTimeoutMs, 60000);
    assert.equal(cfg.classicTimeoutMs, 60000);
    assert.equal(cfg.directTimeoutMs, 60000);
    assert.equal(cfg.deletePendingOnStartup, true);
    assert.equal(cfg.cleanupLegacyCbsJobs, true);
    assert.ok(changes.some(change => change.key === 'gdiTimeoutMs'));
  });

  it('migra timeouts legacy de 5000 a 60000', () => {
    const cfg = { gdiTimeoutMs: 5000, classicTimeoutMs: 5000 };
    const changes = migrateConfig(cfg);

    assert.equal(cfg.gdiTimeoutMs, 60000);
    assert.equal(cfg.classicTimeoutMs, 60000);
    assert.equal(changes.filter(change => change.from === 5000).length, 2);
  });

  it('respeta timeouts personalizados y flags false', () => {
    const cfg = {
      gdiTimeoutMs: 15000,
      classicTimeoutMs: 45000,
      deletePendingOnStartup: false,
      cleanupLegacyCbsJobs: false
    };
    migrateConfig(cfg);

    assert.equal(cfg.gdiTimeoutMs, 15000);
    assert.equal(cfg.classicTimeoutMs, 45000);
    assert.equal(cfg.deletePendingOnStartup, false);
    assert.equal(cfg.cleanupLegacyCbsJobs, false);
  });

  it('no pisa retenciones existentes', () => {
    const cfg = {
      historyRetentionDays: 30,
      errorRetentionDays: 90,
      alertRetentionDays: 7
    };
    migrateConfig(cfg);

    assert.equal(cfg.historyRetentionDays, 30);
    assert.equal(cfg.errorRetentionDays, 90);
    assert.equal(cfg.alertRetentionDays, 7);
  });
});
