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

async function printPdf(pdfBuffer, printerName, docTitle) {
  const log = logger.get();
  const tmpDir = process.env.TEMP || process.env.TMP || 'C:\\Temp';
  const tmpFile = path.join(tmpDir, `cbs_hybrid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`);

  try {
    fs.writeFileSync(tmpFile, pdfBuffer);

    const escapedPath = tmpFile.replace(/\\/g, '\\\\');
    const escapedPrinter = printerName.replace(/'/g, "''");

    const ps = [
      `Start-Process -FilePath '${escapedPath}'`,
      `-Verb PrintTo`,
      `-ArgumentList '${escapedPrinter}'`,
      `-WindowStyle Hidden -Wait`
    ].join(' ');

    log.debug('Enviando PDF a impresora vía PrintTo', { printerName, tmpFile });

    await new Promise((resolve, reject) => {
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', ps
      ], { timeout: 60000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          log.warn('PrintTo falló, intentando Print directo', { error: err.message });
          const psFallback = [
            `Start-Process -FilePath '${escapedPath}'`,
            `-Verb Print`,
            `-WindowStyle Hidden -Wait`
          ].join(' ');
          execFile('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', psFallback
          ], { timeout: 60000, windowsHide: true }, (err2) => {
            if (err2) reject(new Error(`Error al imprimir PDF: ${err2.message}`));
            else resolve();
          });
        } else {
          resolve();
        }
      });
    });

    log.info('PDF impreso correctamente', { printerName, docTitle });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { renderPdfBuffer, printPdf, wordWrap };
