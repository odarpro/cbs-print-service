'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('./logger');

const FONT_MAP = {
  'courier new':     'Courier',
  'courier':         'Courier',
  'lucida console':  'Courier',
  'consolas':        'Courier',
  'arial':           'Helvetica',
  'helvetica':       'Helvetica',
  'calibri':         'Helvetica',
  'verdana':         'Helvetica',
  'tahoma':          'Helvetica',
  'segoe ui':        'Helvetica',
  'times new roman': 'Times-Roman',
  'times':           'Times-Roman',
  'comic sans ms':   'Times-Roman',
};

function mapPdfFont(fontName) {
  const key = (fontName || '').toLowerCase().replace(/_/g, ' ');
  return FONT_MAP[key] || 'Courier';
}

function wordWrap(text, maxChars) {
  if (!maxChars || maxChars <= 0) return text;
  const lines = text.split('\n');
  const result = [];
  for (const line of lines) {
    if (line.length <= maxChars) {
      result.push(line);
      continue;
    }
    let remaining = line;
    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        result.push(remaining);
        break;
      }
      let cut = remaining.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      result.push(remaining.substring(0, cut));
      remaining = remaining.substring(cut).trimStart();
    }
  }
  return result.join('\n');
}

function renderPdfBuffer(text, options = {}) {
  const {
    fontName = 'Courier New',
    fontSize = 9,
    bold = false,
    maxCharsPerLine = 40,
  } = options;

  const log = logger.get();
  log.debug('Generando PDF para impresión híbrida', { fontName, fontSize, bold, maxCharsPerLine });

  return new Promise((resolve, reject) => {
    const pdfFont = mapPdfFont(fontName);
    const boldFont = pdfFont + '-Bold';

    const PAGE_W = 216;
    const PAGE_H = 792;
    const MARGIN = 14;

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: MARGIN,
      layout: 'portrait',
      bufferPages: false
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(bold ? boldFont : pdfFont);
    doc.fontSize(fontSize);

    const wrapped = wordWrap(text, maxCharsPerLine);
    doc.text(wrapped, {
      width: PAGE_W - (MARGIN * 2),
      align: 'left',
      lineGap: 0,
      paragraphGap: 0
    });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Estrategias de impresión del PDF
//
// El shell de Windows (Start-Process -Verb PrintTo/Print) depende de la
// asociación de aplicaciones para .pdf, que es POR-USUARIO (HKCU) y no existe
// en el contexto de un Windows Service (Session 0 / LocalSystem). Por eso la
// impresión PDF fallaba con "No hay ninguna aplicación asociada...".
//
// Orden de estrategias:
//   1. Ghostscript (mswinpr2): imprime el PDF vía el driver de la impresora
//      (correcto para matriciales/GDI) y funciona en Session 0.
//   2. RAW vía Winspool (WritePrinter): sin shell, Session 0-safe, para
//      impresoras compatibles con PDF/PCL directo.
//   3. Shell PrintTo/Print: último recurso (solo entornos con verbo registrado
//      a nivel máquina).
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Guarda una copia del PDF renderizado en la carpeta indicada (modo desarrollo/
 * validación). Devuelve la ruta del archivo creado o null si está deshabilitado
 * o falló. No depende de impresoras ni puertos (Session 0-safe).
 * @param {Buffer} pdfBuffer
 * @param {string} [docTitle]  Título del trabajo, usado para nombrar el archivo
 * @param {string} [folder]    Carpeta destino (vacío = deshabilitado)
 * @returns {string|null}
 */
function capturePdfTo(pdfBuffer, docTitle, folder) {
  if (!folder) return null;
  try {
    fs.mkdirSync(folder, { recursive: true });
    const base = (docTitle || 'impresion')
      .replace(/[^\w\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'impresion';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(folder, `${stamp}_${base}.pdf`);
    fs.writeFileSync(file, pdfBuffer);
    logger.get().info('PDF capturado para validación', { file });
    return file;
  } catch (e) {
    logger.get().warn('No se pudo guardar captura de PDF', { error: e.message });
    return null;
  }
}

/**
 * Guarda la captura usando config.json → pdfCaptureFolder (vacío = deshabilitado).
 */
function savePdfCapture(pdfBuffer, docTitle) {
  return capturePdfTo(pdfBuffer, docTitle, loadConfig().pdfCaptureFolder);
}

function loadNativePrinter() {
  try {
    return require('@tbalegas/node-printer');
  } catch {
    return null;
  }
}

function fileExists(p) {
  if (fs.existsSync(p)) return true;
  if (!path.extname(p)) return fs.existsSync(`${p}.exe`);
  return false;
}

const GS_DIRS = ['C:\\Program Files\\gs', 'C:\\Program Files (x86)\\gs'];

/**
 * Localiza Ghostscript (gswin64c/gswin32c) en config.json, PATH o directorios
 * estándar. Retorna la ruta completa o null si no está instalado.
 */
function findGhostscript() {
  const cfg = loadConfig();
  const cfgPath = cfg.ghostscriptPath;
  if (cfgPath && fileExists(cfgPath)) {
    return path.extname(cfgPath) ? cfgPath : `${cfgPath}.exe`;
  }
  const dirs = (process.env.PATH || '').split(';').filter(Boolean).concat(GS_DIRS);
  for (const dir of dirs) {
    for (const name of ['gswin64c', 'gswin32c']) {
      for (const full of [path.join(dir, name), path.join(dir, `${name}.exe`)]) {
        if (fs.existsSync(full)) return full;
      }
    }
  }
  return null;
}

function printWithGhostscript(gsPath, pdfFile, printerName, copies) {
  return new Promise((resolve, reject) => {
    let remaining = copies;
    const finish = (err) => {
      if (err) reject(err);
      else if (--remaining <= 0) resolve();
    };
    for (let i = 0; i < copies; i++) {
      const args = [
        '-dPrinted', '-dNOSAFER',
        '-sDEVICE=mswinpr2',
        `-sOutputFile=%printer%${printerName}`,
        '-o', pdfFile,
      ];
      execFile(gsPath, args, { timeout: 90000, windowsHide: true }, (err) => {
        if (err) finish(new Error(`Ghostscript (mswinpr2) falló: ${err.message}`));
        else finish();
      });
    }
  });
}

function printRaw(pdfBuffer, printerName, docTitle, copies) {
  const nativePrinter = loadNativePrinter();
  if (!nativePrinter) {
    return Promise.reject(new Error('Módulo nativo de impresión no disponible'));
  }
  return new Promise((resolve, reject) => {
    let remaining = copies;
    for (let i = 0; i < copies; i++) {
      nativePrinter.printDirect({
        data:       pdfBuffer,
        printer:    printerName,
        docname:    `${docTitle} (copia ${i + 1}/${copies})`,
        type:       'RAW',
        success:    () => { if (--remaining <= 0) resolve(); },
        error:      (err) => reject(new Error(`RAW falló en copia ${i + 1}: ${err}`)),
      });
    }
  });
}

function printWithShell(pdfFile, printerName, copies) {
  const log = logger.get();
  const escapedPath = pdfFile.replace(/\\/g, '\\\\');
  const escapedPrinter = printerName.replace(/'/g, "''");

  const psPrintTo = [
    `Start-Process -FilePath '${escapedPath}'`,
    `-Verb PrintTo`,
    `-ArgumentList '${escapedPrinter}'`,
    `-WindowStyle Hidden -Wait`,
  ].join(' ');

  const psPrint = [
    `Start-Process -FilePath '${escapedPath}'`,
    `-Verb Print`,
    `-WindowStyle Hidden -Wait`,
  ].join(' ');

  const run = (ps) => new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 60000, windowsHide: true },
      (err) => (err ? reject(err) : resolve()));
  });

  return (async () => {
    for (let i = 0; i < copies; i++) {
      try {
        await run(psPrintTo);
        continue;
      } catch (e) {
        log.warn('PrintTo falló, intentando Print directo', { error: e.message });
      }
      await run(psPrint);
    }
  })();
}

async function printPdf(pdfBuffer, printerName, docTitle, opts = {}) {
  const log = logger.get();
  const copies = opts.copies && opts.copies > 0 ? opts.copies : 1;
  const tmpDir = process.env.TEMP || process.env.TMP || 'C:\\Temp';
  const tmpFile = path.join(tmpDir, `cbs_hybrid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`);

  try {
    savePdfCapture(pdfBuffer, docTitle);
    fs.writeFileSync(tmpFile, pdfBuffer);

    // 1) Ghostscript (mswinpr2): vía driver, Session 0-safe
    const gs = findGhostscript();
    if (gs) {
      log.info('Imprimiendo PDF vía Ghostscript (mswinpr2)', { printerName, copies });
      try {
        await printWithGhostscript(gs, tmpFile, printerName, copies);
        log.info('PDF impreso correctamente (Ghostscript)', { printerName, docTitle });
        return;
      } catch (gsErr) {
        log.warn('Ghostscript falló, intentando RAW', { error: gsErr.message });
      }
    }

    // 2) RAW vía Winspool (WritePrinter): sin shell, Session 0-safe
    if (loadNativePrinter()) {
      log.info('Imprimiendo PDF vía RAW (Winspool)', { printerName, copies });
      try {
        await printRaw(pdfBuffer, printerName, docTitle, copies);
        log.info('PDF impreso correctamente (RAW)', { printerName, docTitle });
        return;
      } catch (rawErr) {
        log.warn('RAW falló, intentando shell', { error: rawErr.message });
      }
    }

    // 3) Fallback shell (legacy)
    log.warn('Usando fallback de shell (PrintTo/Print)', { printerName });
    await printWithShell(tmpFile, printerName, copies);
    log.info('PDF impreso correctamente (shell)', { printerName, docTitle });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { renderPdfBuffer, printPdf, wordWrap, findGhostscript, capturePdfTo, savePdfCapture };
