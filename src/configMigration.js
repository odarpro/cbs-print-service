'use strict';

const DEFAULTS = {
  historyRetentionDays: 3,
  errorRetentionDays: 15,
  alertRetentionDays: 1,
  gdiTimeoutMs: 60000,
  classicTimeoutMs: 60000,
  directTimeoutMs: 60000,
  deletePendingOnStartup: true,
  cleanupLegacyCbsJobs: true,
  // false = tolerancia legacy (solo offline/error/papelería bloquean);
  // true  = lista estricta de 14 flags PRINTER_STATUS_*.
  strictStatusCheck: false
};

const LEGACY_TIMEOUT_MS = 5000;
const TIMEOUT_KEYS = ['gdiTimeoutMs', 'classicTimeoutMs'];

function migrateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config.json debe ser un objeto JSON.');
  }

  const changes = [];

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (config[key] === undefined) {
      config[key] = value;
      changes.push({ key, from: undefined, to: value });
    }
  }

  for (const key of TIMEOUT_KEYS) {
    if (config[key] === LEGACY_TIMEOUT_MS) {
      config[key] = DEFAULTS[key];
      changes.push({ key, from: LEGACY_TIMEOUT_MS, to: DEFAULTS[key] });
    }
  }

  return changes;
}

module.exports = { DEFAULTS, LEGACY_TIMEOUT_MS, migrateConfig };
