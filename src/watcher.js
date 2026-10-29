'use strict';
// =============================================================================
// watcher.js  –  CBS Print Service
//
// Monitorea la carpeta de impresión usando chokidar (fs.watch estable).
// Detecta únicamente archivos nuevos con extensión .txt.
// Delega el procesamiento a FileProcessor.
// =============================================================================

const fs            = require('fs');
const path          = require('path');
const chokidar      = require('chokidar');
const logger        = require('./logger');
const FileProcessor = require('./fileProcessor');
const { normalizeRetentionDays, removeExpiredFiles } = require('./retentionCleaner');

const RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

class FolderWatcher {
  /**
   * @param {object} config  Contenido de config.json
   */
  constructor(config) {
    this.config    = config;
    this.processor = new FileProcessor(config);
    this._watcher  = null;
    this._retentionTimer = null;
  }

  /**
   * Inicia el monitoreo de la carpeta configurada.
   * Crea la carpeta si no existe (con reintentos para discos que tardan en
   * montarse al arrancar Windows).
   */
  async start() {
    const log        = logger.get();
    const watchFolder = this.config.watchFolder;

    // Crear carpetas necesarias si no existen
    await this._ensureFoldersWithRetry();
    this._cleanExpiredFiles();
    this._deletePendingFiles();
    this._retentionTimer = setInterval(() => this._cleanExpiredFiles(), RETENTION_CHECK_INTERVAL_MS);

    log.info('Iniciando monitoreo de carpeta', { watchFolder });

    const pollInterval = this.config.pollingIntervalMs || 1000;

    this._watcher = chokidar.watch(watchFolder, {
      ignored:        /(^|[/\\])\..|(Historico|Errores|Logs)/i,
      persistent:     true,
      // Los archivos previos ya se resolvieron en _deletePendingFiles();
      // no se deben reprocesar al arrancar.
      ignoreInitial:  true,
      depth:          0,
      interval:       pollInterval,
      awaitWriteFinish: {
        stabilityThreshold: this.config.fileStabilizeMs || 500,
        pollInterval:       100
      }
    });

    this._watcher
      .on('add',    filePath => this._onNewFile(filePath))
      .on('error',  error    => log.error('Error en watcher', { error: error.message }))
      .on('ready',  ()       => log.info('Watcher listo y escuchando', { watchFolder }));
  }

  /**
   * Detiene el monitoreo (llamado al detener el servicio).
   */
  async stop() {
    // No aceptar archivos nuevos; los encolados los gestiona index.js.
    this.processor.stopAccepting();

    if (this._retentionTimer) {
      clearInterval(this._retentionTimer);
      this._retentionTimer = null;
    }
    if (this._watcher) {
      await this._watcher.close();
      this._watcher = null;
      logger.get().info('Watcher detenido.');
    }
  }

  // ── Handlers privados ────────────────────────────────────────────────────

  _onNewFile(filePath) {
    const log  = logger.get();
    const ext  = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();

    // Solo procesar archivos .txt con prefijo Rec o Val
    if (ext !== '.txt') return;
    if (!base.startsWith('rec') && !base.startsWith('val')) return;

    log.info('Nuevo archivo detectado', { filePath });
    this.processor.enqueue(filePath);
  }

  async _ensureFoldersWithRetry(attempts = 10, delayMs = 3000) {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        this._ensureFolders();
        return;
      } catch (err) {
        lastError = err;
        logger.get().warn('No se pudieron preparar las carpetas; reintentando', {
          intento: attempt,
          intentos: attempts,
          error: err.message
        });
        if (attempt < attempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(
      `No se pudieron crear/acceder las carpetas de trabajo tras ${attempts} intentos: ` +
      `${lastError ? lastError.message : 'error desconocido'}`
    );
  }

  _ensureFolders() {
    const cfg = this.config;
    for (const folderKey of ['watchFolder', 'historyFolder', 'errorFolder', 'logFolder']) {
      const dir = cfg[folderKey];
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.get().info(`Carpeta creada: ${dir}`);
      }
    }

    // Crear carpeta de alertas (fallback para notificaciones)
    if (cfg.logFolder) {
      const alertDir = path.join(path.dirname(cfg.logFolder), 'Alertas');
      if (!fs.existsSync(alertDir)) {
        fs.mkdirSync(alertDir, { recursive: true });
        logger.get().info(`Carpeta creada: ${alertDir}`);
      }
    }
  }

  /**
   * Elimina los .txt pendientes (prefijos Rec y Val) de watchFolder al arrancar.
   * Evita reimprimir documentos viejos o dejar trabajos huérfanos en el spooler.
   * No toca Histórico, Errores ni Logs (depth 0).
   */
  _deletePendingFiles() {
    const log = logger.get();
    const cfg = this.config;
    const watchFolder = cfg.watchFolder;

    if (cfg.deletePendingOnStartup === false) {
      log.info('Limpieza de pendientes al arrancar deshabilitada por configuración');
      return;
    }

    if (!watchFolder || !fs.existsSync(watchFolder)) {
      log.warn('No se pueden eliminar pendientes: carpeta de monitoreo inexistente', { watchFolder });
      return;
    }

    let deleted = 0;
    const failed = [];
    const names = [];

    let entries;
    try {
      entries = fs.readdirSync(watchFolder, { withFileTypes: true });
    } catch (err) {
      log.warn('No se pudo leer watchFolder para eliminar pendientes', {
        watchFolder,
        error: err.message
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const base = entry.name.toLowerCase();
      if (!base.endsWith('.txt')) continue;
      if (!base.startsWith('rec') && !base.startsWith('val')) continue;

      const filePath = path.join(watchFolder, entry.name);
      try {
        fs.unlinkSync(filePath);
        deleted++;
        names.push(entry.name);
      } catch (err) {
        failed.push({ file: entry.name, error: err.message });
      }
    }

    if (deleted > 0) {
      log.warn('Archivos pendientes eliminados al arrancar', {
        watchFolder,
        deleted,
        archivos: names.slice(0, 50)
      });
    } else {
      log.info('No había archivos pendientes al arrancar', { watchFolder });
    }

    if (failed.length > 0) {
      log.warn('Algunos archivos pendientes no se pudieron eliminar', { failed });
    }
  }

  _cleanExpiredFiles() {
    const log = logger.get();
    const cfg = this.config;
    const folders = [
      { name: 'Histórico', dir: cfg.historyFolder, days: normalizeRetentionDays(cfg.historyRetentionDays, 30) },
      { name: 'Errores', dir: cfg.errorFolder, days: normalizeRetentionDays(cfg.errorRetentionDays, 90) },
      {
        name: 'Alertas',
        dir: cfg.logFolder ? path.join(path.dirname(cfg.logFolder), 'Alertas') : null,
        days: normalizeRetentionDays(cfg.alertRetentionDays, 7)
      }
    ];

    for (const folder of folders) {
      const result = removeExpiredFiles(folder.dir, folder.days);
      if (result.deleted || result.errors) {
        log.info('Limpieza de retención completada', {
          folder: folder.name,
          retentionDays: folder.days,
          deleted: result.deleted,
          errors: result.errors
        });
      }
    }
  }

  /** Cantidad de archivos pendientes en cola. */
  get queueLength() {
    return this.processor.queueLength;
  }
}

module.exports = FolderWatcher;
