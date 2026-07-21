'use strict';
// =============================================================================
// logger.js  –  CBS Print Service
// Logging centralizado con rotación diaria (winston + winston-daily-rotate-file)
// Sin llamadas a cmd/powershell/shell externo.
// =============================================================================

const path    = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

let _logger = null;

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
  const logFolder      = cfg.logFolder      || 'D:\\Impresiones\\Logs';
  const logLevel       = cfg.logLevel       || 'info';
  const retentionDays  = cfg.logRetentionDays || 30;

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
      zippedArchive:  false,
      handleExceptions: true
    })
  ];

  // Consola solo si hay TTY (útil en desarrollo, se omite al correr como servicio)
  if (!isRunningAsService()) {
    transports.push(new winston.transports.Console({
      format: fmt,
      handleExceptions: true
    }));
  }

  _logger = winston.createLogger({
    level: logLevel,
    format: fmt,
    transports
  });

  _logger.info('Logger inicializado', { logFolder, logLevel, retentionDays });
  return _logger;
}

/**
 * Devuelve la instancia activa del logger.
 * Si no se llamó init() primero, crea uno básico en consola.
 */
function get() {
  if (!_logger) {
    _logger = winston.createLogger({
      level: 'debug',
      format: winston.format.simple(),
      transports: [new winston.transports.Console()]
    });
  }
  return _logger;
}

module.exports = { init, get };
