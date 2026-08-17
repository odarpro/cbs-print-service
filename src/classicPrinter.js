'use strict';
// =============================================================================
// classicPrinter.js  –  CBS Print Service  (modo 43C / CLASSIC)
//
// Replica el comportamiento de impresión del CBSprint.exe original (VB.NET):
// render GDI+ vía PrintDocument + DrawString con fuente TrueType, enviado a
// través del driver de Windows mediante un pequeño helper PowerShell
// (scripts/print-classic.ps1).
//
// La lógica de dibujo es idéntica a la clase clsPrintManagement del proyecto VB:
//   - PageUnit en milímetros
//   - margen superior 3 mm, margen izquierdo 0
//   - corte de línea duro a MaxChars (sin word-wrap)
//   - una línea en blanco al final
// =============================================================================

const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { execFile }   = require('child_process');
const logger         = require('./logger');

const PS_SCRIPT_REL  = path.join('scripts', 'print-classic.ps1');

/**
 * Localiza el script helper de impresión clásica.
 * @returns {string|null}
 */
function findPsScript() {
  const candidates = [
    path.join(__dirname, '..', PS_SCRIPT_REL),
    path.join(__dirname, PS_SCRIPT_REL),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

/**
 * Mapea el nombre de codificación del servicio al número de página de códigos
 * usada por Encoding.GetEncoding() en .NET.
 * @param {string} fileEncoding  'latin1', 'utf8', etc.
 * @returns {number}
 */
function resolveCodePage(fileEncoding) {
  const key = String(fileEncoding || '').toLowerCase().replace(/[_-]/g, '');
  if (key.includes('utf') || key.includes('65001')) return 65001;
  if (key.includes('1252') || key.includes('latin') || key.includes('ansi')) return 1252;
  if (key.includes('437')) return 437;
  if (key.includes('850')) return 850;
  return 1252;
}

/**
 * Construye los argumentos para powershell.exe -File print-classic.ps1.
 * @param {object} opts
 * @returns {string[]}
 */
function buildClassicArgs(opts) {
  const {
    script,
    filePath,
    printerName,
    fontName      = 'Courier New',
    fontSize      = 9,
    bold          = false,
    maxCharsPerLine = 40,
    fileEncoding  = 'latin1',
    copies        = 1,
  } = opts;

  const cleanFont = String(fontName || 'Courier New').replace(/_/g, ' ') || 'Courier New';

  const args = [
    '-File', script,
    '-FilePath', filePath,
    '-PrinterName', printerName,
    '-FontName', cleanFont,
    '-FontSize', String(fontSize),
    '-MaxChars', String(maxCharsPerLine && maxCharsPerLine > 0 ? maxCharsPerLine : 40),
    '-Encoding', String(resolveCodePage(fileEncoding)),
    '-Copies', String(copies && copies > 0 ? copies : 1),
  ];

  if (bold) args.push('-Bold');

  return args;
}

/**
 * Ejecuta powershell.exe con los argumentos dados.
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function runPowerShell(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'].concat(args),
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) {
          const detail = String(stderr || stdout || err.message).trim();
          reject(new Error(`Modo 43C (GDI+ VB): ${detail || err.message}`));
        } else {
          resolve(stdout);
        }
      }
    );

    // PrintDocument puede quedar bloqueado dentro de un driver. Finalizamos el
    // árbol completo y liberamos la cola sin depender de que PowerShell cierre.
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (child.pid) {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      }
      reject(new Error(`Modo 43C (GDI+ VB): tiempo máximo de ${timeoutMs} ms excedido.`));
    }, timeoutMs);
  });
}

/**
 * Imprime el contenido usando el motor GDI+ de Windows (idéntico al VB.NET).
 *
 * @param {string} content  Contenido ya decodificado (fileEncoding)
 * @param {object} opts
 *   opts.printerName       {string}  Nombre real de la impresora
 *   opts.fontName          {string}  Nombre de fuente (con o sin _)
 *   opts.fontSize          {number}
 *   opts.bold              {boolean}
 *   opts.maxCharsPerLine   {number}
 *   opts.fileEncoding      {string}  Codificación usada al escribir el temporal
 *   opts.copies            {number}
 *   opts.docTitle          {string}  Título del trabajo
 * @returns {Promise<void>}
 */
async function printClassic(content, opts) {
  const log = logger.get();
  const {
    printerName,
    docTitle = 'Recibo',
    fileEncoding = 'latin1',
    timeoutMs = 60000,
  } = opts;

  const script = findPsScript();
  if (!script) {
    throw new Error('No se encontró scripts/print-classic.ps1 (requerido para el modo 43C).');
  }

  const tmpDir  = process.env.TEMP || process.env.TMP || os.tmpdir();
  const tmpFile = path.join(tmpDir, `cbs_classic_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.txt`);

  try {
    fs.writeFileSync(tmpFile, content, { encoding: fileEncoding });

    const args = buildClassicArgs({ script, filePath: tmpFile, ...opts });

    log.debug('Iniciando impresión modo CLASSIC (GDI+ VB)', {
      printerName,
      fontName:  opts.fontName,
      fontSize:  opts.fontSize,
      bold:      opts.bold,
      maxCharsPerLine: opts.maxCharsPerLine,
      copies:    opts.copies,
    });

    await runPowerShell(args, timeoutMs);

    log.info('Impresión CLASSIC completada', { printerName, docTitle });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { printClassic, buildClassicArgs, resolveCodePage, findPsScript };
