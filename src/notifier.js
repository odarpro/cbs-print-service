'use strict';
// =============================================================================
// notifier.js  –  CBS Print Service
//
// Envía notificaciones toast de Windows 10/11 usando node-notifier.
// Controlado por configuración global (config.json) y parámetro 44 por archivo.
// =============================================================================

const notifier = require('node-notifier');
const path     = require('path');
const logger   = require('./logger');

let _config = null;

/**
 * Inicializa el módulo con la configuración del servicio.
 * @param {object} cfg  Contenido completo de config.json
 */
function init(cfg) {
  _config = cfg || {};
}

/**
 * Determina si las notificaciones toast están habilitadas.
 * Resolución: parámetro 44 del archivo > config.toastEnabled > default true
 *
 * @param {object|null} parsedParams  Parámetros parseados del nombre del archivo
 * @returns {boolean}
 */
function isEnabled(parsedParams) {
  if (parsedParams && parsedParams['44'] !== undefined) {
    return parsedParams['44'].toUpperCase() === 'S';
  }
  if (_config && _config.toastEnabled !== undefined) {
    return !!_config.toastEnabled;
  }
  return true;
}

/**
 * Determina si se debe notificar un evento de éxito.
 * @param {object|null} parsedParams  Parámetros parseados del nombre del archivo
 * @returns {boolean}
 */
function shouldNotifySuccess(parsedParams) {
  if (!isEnabled(parsedParams)) return false;
  if (_config && _config.toastOnSuccess !== undefined) {
    return !!_config.toastOnSuccess;
  }
  return true;
}

/**
 * Determina si se debe notificar un evento de error.
 * @param {object|null} parsedParams  Parámetros parseados del nombre del archivo
 * @returns {boolean}
 */
function shouldNotifyError(parsedParams) {
  if (!isEnabled(parsedParams)) return false;
  if (_config && _config.toastOnError !== undefined) {
    return !!_config.toastOnError;
  }
  return true;
}

/**
 * Envía una notificación toast de Windows.
 *
 * @param {object} opts
 * @param {string} opts.title     Título de la notificación
 * @param {string} opts.message   Mensaje de la notificación
 * @param {'info'|'warn'|'error'} [opts.level='info']  Nivel del evento
 */
function notify({ title, message, level = 'info' }) {
  const log = logger.get();

  if (!_config || !_config.toastEnabled) {
    log.debug('Notificación toast deshabilitada, saltando', { title, message });
    return;
  }

  const iconMap = {
    info:  path.join(__dirname, '..', 'assets', 'icon-info.ico'),
    warn:  path.join(__dirname, '..', 'assets', 'icon-warn.ico'),
    error: path.join(__dirname, '..', 'assets', 'icon-error.ico')
  };

  const toastOpts = {
    title:   `CBS Print - ${title}`,
    message,
    appID:   'CBS Print Service',
    wait:    false
  };

  // Solo incluir ícono si existe el archivo (node-notifier funciona sin ícono)
  try {
    const fs = require('fs');
    const iconPath = iconMap[level] || iconMap.info;
    if (fs.existsSync(iconPath)) {
      toastOpts.icon = iconPath;
    }
  } catch {}

  log.debug('Enviando notificación toast', { title: toastOpts.title, message, level });

  notifier.notify(toastOpts, (err) => {
    if (err) {
      log.warn('Error al enviar notificación toast', { error: err.message });
    }
  });
}

/**
 * Notificación de impresión exitosa.
 * @param {string} fileName   Nombre del archivo
 * @param {string} printer    Nombre de la impresora
 * @param {object|null} parsedParams  Parámetros del nombre del archivo
 */
function notifyPrintSuccess(fileName, printer, parsedParams) {
  if (!shouldNotifySuccess(parsedParams)) return;

  notify({
    title:   'Impresión exitosa',
    message: `${fileName} → ${printer}`,
    level:   'info'
  });
}

/**
 * Notificación de error de impresión (tras agotar reintentos).
 * @param {string} fileName   Nombre del archivo
 * @param {string} reason     Razón del error
 * @param {object|null} parsedParams  Parámetros del nombre del archivo
 */
function notifyPrintError(fileName, reason, parsedParams) {
  if (!shouldNotifyError(parsedParams)) return;

  notify({
    title:   'Error de impresión',
    message: `${fileName}: ${reason}`,
    level:   'error'
  });
}

/**
 * Notificación de archivo con parámetros inválidos.
 * @param {string} fileName   Nombre del archivo
 * @param {Array<string>} errors  Lista de errores de validación
 * @param {object|null} parsedParams  Parámetros del nombre del archivo
 */
function notifyInvalidFile(fileName, errors, parsedParams) {
  if (!shouldNotifyError(parsedParams)) return;

  notify({
    title:   'Archivo inválido',
    message: `${fileName}: ${errors.join('; ')}`,
    level:   'warn'
  });
}

/**
 * Notificación de error crítico del servicio (siempre se muestra).
 * @param {string} title   Título del error
 * @param {string} message Detalle del error
 */
function notifyCritical(title, message) {
  notify({
    title:   title,
    message: message,
    level:   'error'
  });
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
