'use strict';
// =============================================================================
// notifier.js  –  CBS Print Service
//
// Escribe archivos de alerta en la carpeta Alertas.
// El vigilante de alertas (alert-watcher.ps1) corre en la sesión del usuario
// y muestra un MessageBox por cada archivo nuevo.
//
// Controlado por configuración global (config.json) y parámetro 44 por archivo.
// =============================================================================

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('./logger');

let _config = null;

/**
 * Inicializa el módulo con la configuración del servicio.
 * @param {object} cfg  Contenido completo de config.json
 */
function init(cfg) {
  _config = cfg || {};
}

/**
 * Obtiene la ruta de la carpeta de alertas.
 * Deriva de logFolder: C:\Impresiones\Logs → C:\Impresiones\Alertas
 * @returns {string}
 */
function _getAlertDir() {
  if (_config && _config.logFolder) {
    return path.join(path.dirname(_config.logFolder), 'Alertas');
  }
  return path.join('C:', 'Impresiones', 'Alertas');
}

/**
 * Determina si las notificaciones están habilitadas.
 * Resolución: parámetro 44 del archivo > config.toastEnabled > default true
 *
 * @param {object|null} parsedParams  Parámetros parseados del nombre del archivo
 * @returns {boolean}
 */
function isEnabled(parsedParams) {
  if (parsedParams && parsedParams['44'] !== undefined) {
    return parsedParams['44'].toUpperCase() === 'A';
  }
  if (_config && _config.toastEnabled !== undefined) {
    return !!_config.toastEnabled;
  }
  return true;
}

function shouldNotifySuccess(parsedParams) {
  if (!isEnabled(parsedParams)) return false;
  if (_config && _config.toastOnSuccess !== undefined) {
    return !!_config.toastOnSuccess;
  }
  return true;
}

function shouldNotifyError(parsedParams) {
  if (!isEnabled(parsedParams)) return false;
  if (_config && _config.toastOnError !== undefined) {
    return !!_config.toastOnError;
  }
  return true;
}

/**
 * Garantiza que la carpeta de alertas sea modificable por el grupo Users,
 * para que el vigilante (que corre en la sesión del usuario) pueda
 * leer y borrar los archivos de alerta.
 * @param {string} dir
 */
function _ensureUsersModify(dir) {
  try {
    if (process.platform !== 'win32') return;
    // S-1-5-32-545 = grupo "Users" local (independiente del idioma)
    execFile('icacls.exe', [dir, '/grant', '*S-1-5-32-545:(OI)(CI)M'], { windowsHide: true }, () => {});
  } catch {
    // No romper el servicio por un error de ACL
  }
}

/**
 * Escribe un archivo de alerta que el vigilante mostrará como MessageBox.
 * @param {string} title   Título de la alerta
 * @param {string} message Mensaje de la alerta
 * @param {'info'|'warn'|'error'} level  Nivel del evento
 */
function _writeAlert(title, message, level) {
  try {
    const alertDir = _getAlertDir();
    if (!fs.existsSync(alertDir)) {
      fs.mkdirSync(alertDir, { recursive: true });
      _ensureUsersModify(alertDir);
    }

    const iconMap = { error: '[ERROR]', warn: '[AVISO]', info: '[INFO]' };
    const icon    = iconMap[level] || iconMap.info;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath  = path.join(alertDir, `alert_${timestamp}.txt`);

    const content = `${icon} CBS Print - ${title}\n\n${message}`;
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (err) {
    // No fallar el servicio por un error en la alerta
  }
}

/**
 * Registra una notificación (escribe archivo para el vigilante).
 *
 * @param {object} opts
 * @param {string} opts.title     Título de la notificación
 * @param {string} opts.message   Mensaje de la notificación
 * @param {'info'|'warn'|'error'} [opts.level='info']  Nivel del evento
 */
function notify({ title, message, level = 'info' }) {
  const log = logger.get();

  if (!_config || !_config.toastEnabled) {
    log.debug('Notificación deshabilitada, saltando', { title, message });
    return;
  }

  log.info('Notificación', { title, message, level });
  _writeAlert(title, message, level);
}

function notifyPrintSuccess(fileName, printer, parsedParams) {
  if (!shouldNotifySuccess(parsedParams)) return;
  notify({ title: 'Impresión exitosa', message: `${fileName} → ${printer}`, level: 'info' });
}

function notifyPrintError(fileName, reason, parsedParams) {
  if (!shouldNotifyError(parsedParams)) return;
  notify({ title: 'Error de impresión', message: `${fileName}: ${reason}`, level: 'error' });
}

function notifyInvalidFile(fileName, errors, parsedParams) {
  if (!shouldNotifyError(parsedParams)) return;
  notify({ title: 'Archivo inválido', message: `${fileName}: ${errors.join('; ')}`, level: 'warn' });
}

function notifyCritical(title, message) {
  notify({ title, message, level: 'error' });
}

module.exports = {
  init,
  isEnabled,
  shouldNotifySuccess,
  shouldNotifyError,
  notify,
  notifyPrintSuccess,
  notifyPrintError,
  notifyInvalidFile,
  notifyCritical
};
