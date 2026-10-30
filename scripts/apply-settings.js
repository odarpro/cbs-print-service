const fs = require('fs');
const path = require('path');
const { migrateConfig } = require('../src/configMigration');

const appDir = path.dirname(__dirname);
const settingsFile = path.join(appDir, '.install-settings.txt');
const configFile = path.join(appDir, 'config.json');

if (!fs.existsSync(settingsFile)) {
  console.log('settings file not found, skipping');
  process.exit(0);
}

const lines = fs.readFileSync(settingsFile, 'utf8').split(/\r?\n/);
const watchFolder = lines[0] || '';
const historyFolder = lines[1] || '';
const errorFolder = lines[2] || '';

fs.unlinkSync(settingsFile);
console.log('watchFolder:', watchFolder);

let cfg;
if (!fs.existsSync(configFile)) {
  console.log('config.json not found, creating default');
  cfg = {
    watchFolder, historyFolder, errorFolder,
    logFolder: path.join(watchFolder, 'Logs'),
    logLevel: 'info', logRetentionDays: 30,
    printMethod: 'DIRECT',
    printers: {
      voucher: { name: 'EPSON LX-350', fontName: 'Courier New', fontSize: 9,
        bold: false, maxCharsPerLine: 40, copies: 1 },
      slip: { name: 'EPSON LX-350', fontName: 'Courier New', fontSize: 9,
        bold: false, maxCharsPerLine: 40, copies: 1 }
    },
    fileEncoding: 'latin1', fileAction: 'MOVE',
    pollingIntervalMs: 1000, fileStabilizeMs: 500,
    retryCount: 3, retryIntervalMs: 5000
  };
} else {
  cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  cfg.watchFolder = watchFolder;
  cfg.historyFolder = historyFolder;
  cfg.errorFolder = errorFolder;
  cfg.logFolder = path.join(watchFolder, 'Logs');
}

const changes = migrateConfig(cfg);
fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');

if (changes.length > 0) {
  console.log('Migración aplicada:', changes.map(change => change.key).join(', '));
}

console.log('config.json updated');
