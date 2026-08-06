'use strict';
// =============================================================================
// printer.js  –  CBS Print Service
//
// Envía archivos de texto a impresoras matriciales.
//
// Método principal (nativo):
//   Usa @thiagoelg/node-printer para invocar WritePrinter (Winspool API)
//   directamente — sin cmd.exe, powershell ni procesos externos.
//
// Fallback:
//   Si el módulo nativo no está disponible (entornos sin Windows SDK),
//   usa PowerShell Out-Printer. Esto invoca un proceso externo (powershell.exe)
//   pero permite imprimir en equipos donde el módulo nativo no compila.
//
// Compatibilidad: Windows 10 / Windows 11, Node.js >= 18 LTS.
//
// Dependencia nativa:
//   npm install @thiagoelg/node-printer
// =============================================================================

const fs       = require('fs');
const path     = require('path');
const { execFile } = require('child_process');
const logger   = require('./logger');
const gdiPrint = require('./gdiPrinter');

// ---------------------------------------------------------------------------
// Carga del módulo nativo.
// Si no está instalado se usa el stub para entornos de desarrollo/CI Linux.
// ---------------------------------------------------------------------------
let nativePrinter;
try {
  nativePrinter = require('@tbalegas/node-printer');
} catch (e) {
  // En Linux/CI el módulo nativo no compila; usamos stub para pruebas unitarias.
  nativePrinter = null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Obtiene la información completa de una impresora por nombre parcial,
 * incluyendo su nombre real y estado. Una sola llamada a getPrinters().
 * @param {string} partialName
 * @returns {{ resolvedName: string|null, status: { ok: boolean, reason: string } }}
 */
function getPrinterInfo(partialName) {
  if (!nativePrinter) {
    return { resolvedName: null, status: { ok: false, reason: 'Módulo nativo de impresión no disponible.' } };
  }

  const installed = nativePrinter.getPrinters();
  const needle    = partialName.toUpperCase();

  for (const p of installed) {
    if (p.name.toUpperCase().includes(needle)) {
      const OFFLINE = 0x00000080;
      const ERROR   = 0x00000002;
      const PAPER   = 0x00000020;
      const st      = p.statusNumber || 0;

      let reason = 'OK';
      let ok     = true;

      if (st & OFFLINE) { ok = false; reason = 'Impresora offline.'; }
      else if (st & ERROR)   { ok = false; reason = 'Impresora en estado de error.'; }
      else if (st & PAPER)   { ok = false; reason = 'Impresora sin papel.'; }

      return { resolvedName: p.name, status: { ok, reason } };
    }
  }

  return { resolvedName: null, status: { ok: false, reason: `Impresora "${partialName}" no encontrada en el sistema.` } };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Imprime un archivo de texto en la impresora indicada usando Winspool (Win32).
 * No invoca ningún proceso externo.
 *
 * @param {object} opts
 *   opts.filePath      {string}  Ruta completa del archivo .txt
 *   opts.printerName   {string}  Nombre parcial o completo de la impresora
 *   opts.fileEncoding  {string}  Codificación del archivo (default 'latin1')
 *   opts.copies        {number}  Número de copias (default 1)
 *   opts.docTitle      {string}  Título del trabajo de impresión (opcional)
 *
 * @returns {Promise<void>}  Resuelve si éxito, rechaza con Error si fallo.
 */
async function printFile(opts) {
  const {
    filePath,
    printerName,
    fileEncoding = 'latin1',
    copies       = 1,
    docTitle     = path.basename(filePath),
    content: preloadedContent,
    printMethod  = 'DIRECT',
    bold         = false,
    maxCharsPerLine = 40,
    fontName,
    fontSize
  } = opts;

  const log = logger.get();

  // Usar contenido pre-cargado (desde fileProcessor) o leerlo directamente
  let content = preloadedContent || (() => {
    try {
      return fs.readFileSync(filePath, { encoding: fileEncoding });
    } catch (e) {
      throw new Error(`Archivo no encontrado o no legible: ${filePath} — ${e.message}`);
    }
  })();

  // 2. Aplicar modo según configuración
  if (printMethod === 'GDI') {
    content = gdiPrint.renderGdi(content, { maxCharsPerLine, bold, fontName, fontSize });
    log.debug('Modo GDI aplicado', { maxCharsPerLine, bold, fontName, fontSize });
  } else if (printMethod === 'PDF') {
    const pdfPrinter = require('./pdfPrinter');
    const { resolvedName, status } = getPrinterInfo(printerName);
    if (!resolvedName) {
      throw new Error(`Impresora "${printerName}" no está instalada en este equipo.`);
    }
    if (!status.ok) {
      throw new Error(`Impresora "${resolvedName}": ${status.reason}`);
    }
    const pdfBuffer = await pdfPrinter.renderPdfBuffer(content, {
      fontName, fontSize, bold, maxCharsPerLine
    });
    await pdfPrinter.printPdf(pdfBuffer, resolvedName, docTitle, { copies });
    return;
  } else {
    log.debug('Modo DIRECT aplicado');
  }

  // 3. Resolver nombre real de impresora y verificar estado (una sola llamada)
  const { resolvedName, status } = getPrinterInfo(printerName);
  if (!resolvedName) {
    throw new Error(`Impresora "${printerName}" no está instalada en este equipo.`);
  }
  if (!status.ok) {
    throw new Error(`Impresora "${resolvedName}": ${status.reason}`);
  }

  // Convertir a Buffer con la codificación correcta para Winspool
  const dataBuffer = Buffer.from(content, fileEncoding);

  log.debug('Iniciando impresión', { filePath, resolvedName, copies, printMethod });

  // 4. Enviar al spooler — copias secuenciales
  if (nativePrinter) {
    for (let i = 0; i < copies; i++) {
      await new Promise((resolve, reject) => {
        nativePrinter.printDirect({
          data:       dataBuffer,
          printer:    resolvedName,
          docname:    `${docTitle} (copia ${i + 1}/${copies})`,
          type:       'RAW',
          success:    () => {
            log.info('Copia enviada al spooler', { copia: i + 1, copies, resolvedName, printMethod });
            resolve();
          },
          error:      (err) => reject(new Error(`Error en copia ${i + 1}: ${err}`))
        });
      });
    }
  } else {
    log.warn('Módulo nativo no disponible, usando fallback PowerShell', { resolvedName });
    await printWithPowerShell(content, resolvedName, fileEncoding, copies);
  }

  log.info('Impresión completada', { filePath, resolvedName, copies, printMethod });
}

/**
 * Lista las impresoras instaladas en el equipo (para diagnóstico).
 * @returns {Array<{name: string, status: string}>}
 */
function listPrinters() {
  if (!nativePrinter) return [];
  return nativePrinter.getPrinters().map(p => ({
    name:   p.name,
    status: p.statusNumber === 0 ? 'OK' : `status=${p.statusNumber}`
  }));
}

/**
 * Fallback: imprime usando PowerShell Out-Printer.
 * Se usa cuando el módulo nativo @thiagoelg/node-printer no está disponible.
 */
async function printWithPowerShell(content, printerName, encoding, copies) {
  const tmpFile = path.join(
    process.env.TEMP || process.env.TMP || 'C:\\Temp',
    `cbs_print_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(tmpFile, content, encoding);
    for (let i = 0; i < copies; i++) {
      await new Promise((resolve, reject) => {
        const escapedPath = tmpFile.replace(/\\/g, '\\\\');
        const escapedName = printerName.replace(/'/g, "''");
        const ps = `
$$data = [System.IO.File]::ReadAllBytes('${escapedPath}')
$$p = Get-CimInstance -ClassName Win32_Printer -Filter "Name='${escapedName}'"
[void]($$p | Invoke-CimMethod -MethodName PrintDirect @{data=$$data})
`;
        const child = execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', ps],
          { timeout: 30000, windowsHide: true },
          (err) => {
            if (err) reject(new Error(`PowerShell fallback error (copia ${i + 1}): ${err.message}`));
            else resolve();
          }
        );
        child.on('error', reject);
      });
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { printFile, listPrinters, getPrinterInfo };
