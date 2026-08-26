'use strict';

const fs = require('fs');
const path = require('path');

function normalizeRetentionDays(value, fallback) {
  const days = Number(value);
  return Number.isFinite(days) && days >= 1 ? days : fallback;
}

function removeExpiredFiles(dir, retentionDays, now = Date.now()) {
  const result = { deleted: 0, errors: 0 };
  if (!dir || !fs.existsSync(dir)) return result;

  const cutoff = now - (retentionDays * 24 * 60 * 60 * 1000);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const filePath = path.join(dir, entry.name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        result.deleted++;
      }
    } catch {
      result.errors++;
    }
  }

  return result;
}

module.exports = { normalizeRetentionDays, removeExpiredFiles };
