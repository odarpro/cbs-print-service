'use strict';
// =============================================================================
// logger.js  –  CBS Print Service
// Logging centralizado con rotación diaria (winston + winston-daily-rotate-file)
// Sin llamadas a cmd/powershell/shell externo.
// =============================================================================

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

let _logger = null;

const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';
const FALLBACK_LOG_FOLDER = path.join(PROGRAM_DATA, 'CBSPrintService', 'logs');

/**
 * Devuelve una carpeta de logs escribible, con fallback a ProgramData.
 * Evita que un disco ausente (p. ej. D:\) impida arrancar el servicio.
 */
function resolveLogFolder(configured) {
  const candidates = [configured, FALLBACK_LOG_FOLDER].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return { dir, fallback: dir !== configured };
    } catch {
      // probar el siguiente candidato
    }
  }

  const tmp = path.join(os.tmpdir(), 'CBSPrintService', 'logs');
  fs.mkdirSync(tmp, { recursive: true });
  return { dir: tmp, fallback: true };
}

/**
 * Detecta si el proceso corre como Windows Service (sin consola interactiva).
 */
function isRunningAsService() {
  try {
    return !process.stdout.isTTY;
  } catch {
    return true;
  }
}

/**
 * Inicializa el logger.
 * @param {object} cfg  Sección relevante de config.json
 *   cfg.logFolder         – ruta de la carpeta de logs
 *   cfg.logLevel          – 'info' | 'warn' | 'error' | 'debug'
 *   cfg.logRetentionDays  – días de retención (default 30)
 */
function init(cfg) {
  const requestedFolder = cfg.logFolder || 'D:\\Impresiones\\Logs';
  const { dir: logFolder, fallback } = resolveLogFolder(requestedFolder);

  const allowedLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
  const requestedLevel = String(cfg.logLevel || 'info').toLowerCase();
  const logLevel = allowedLevels.includes(requestedLevel) ? requestedLevel : 'info';

  const requestedDays = Number(cfg.logRetentionDays);
  const retentionDays = Number.isFinite(requestedDays) && requestedDays > 0
    ? Math.floor(requestedDays)
    : 30;

  const fmt = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' | ' + JSON.stringify(meta) : '';
      return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`;
    })
  );

  const transports = [
    // Archivo rotativo diario con límite de tamaño por archivo (50 MB)
    new winston.transports.DailyRotateFile({
      dirname:        logFolder,
      filename:       'cbsprint-%DATE%.log',
      datePattern:    'YYYY-MM-DD',
      maxFiles:       `${retentionDays}d`,
      maxSize:        '50m',
      zippedArchive:  false
    })
  ];

  // Consola solo si hay TTY (útil en desarrollo, se omite al correr como servicio)
  if (!isRunningAsService()) {
    transports.push(new winston.transports.Console({ format: fmt }));
  }

  _logger = winston.createLogger({
    level: logLevel,
    format: fmt,
    transports,
    // Nunca terminar el proceso por un fallo de escritura del log.
    exitOnError: false
  });

  _logger.info('Logger inicializado', { logFolder, logLevel, retentionDays, fallback });
  if (fallback) {
    _logger.warn('La carpeta de logs configurada no es escribible; usando carpeta de respaldo', {
      requestedFolder,
      logFolder
    });
  }
  return _logger;
}

/**
 * Devuelve la instancia activa del logger.
 * Si no se llamó init() primero, crea uno básico en consola.
 */
function get() {
  if (!_logger) {
    let dir = FALLBACK_LOG_FOLDER;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      dir = path.join(os.tmpdir(), 'CBSPrintService', 'logs');
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }

    const transports = [
      new winston.transports.DailyRotateFile({
        dirname:     dir,
        filename:    'cbsprint-fallback-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles:    '7d',
        maxSize:     '10m',
        zippedArchive: false
      })
    ];

    try {
      if (process.stdout && process.stdout.isTTY) {
        transports.push(new winston.transports.Console());
      }
    } catch {}

    _logger = winston.createLogger({
      level: 'debug',
      format: winston.format.simple(),
      transports,
      exitOnError: false
    });
  }
  return _logger;
}

module.exports = { init, get };
