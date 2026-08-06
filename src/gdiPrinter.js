'use strict';

const logger = require('./logger');

const ESC = '\x1B';

function escBoldOn()  { return ESC + 'E'; }
function escBoldOff() { return ESC + 'F'; }

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

function applyBold(text, bold) {
  if (!bold) return text;
  return escBoldOn() + text + escBoldOff();
}

function formatLines(text, maxCharsPerLine, bold) {
  const wrapped = wordWrap(text, maxCharsPerLine);
  const lines = wrapped.split('\n');

  const formatted = lines.map(line => {
    const padded = line.padEnd(Math.min(line.length, maxCharsPerLine || 80));
    return applyBold(padded, bold);
  });

  return formatted.join('\n');
}

// Mapeo para impresoras ESC/POS matriciales (TM-U950, 9 pines).
// La TM-U950 NO soporta ESC k (fuentes ESC/P clásico) ni ESC g (15 cpi,
// solo 24/48 pines). Sus comandos válidos son:
//   - ESC M n  : seleccionar fuente (n=0 Font A, n=1 Font B)
//   - ESC ! n  : modo de impresión (bit4=16 doble altura, bit5=32 doble ancho)
//   - ESC E/F  : negrita on/off
// "f" mapea a Font A/B según el nombre; "t" a Font B / normal / doble altura.
function escFont(fontName) {
  if (!fontName) return '';
  const name = fontName.replace(/_/g, ' ').toLowerCase();
  const fontB = /courier|draft|prestige|condensed|compact|narrow|small|ocr/.test(name);
  return ESC + 'M' + String.fromCharCode(fontB ? 1 : 0);
}

function escSize(fontSize) {
  if (fontSize === undefined || fontSize === null) return '';
  const size = parseInt(fontSize, 10);
  if (isNaN(size)) return '';
  if (size <= 8)  return ESC + 'M' + '\x01';          // pequeña → Font B
  if (size <= 11) return '';                          // normal → mantiene la fuente
  if (size <= 14) return ESC + '!' + '\x10';          // grande → doble altura
  return ESC + '!' + '\x30';                          // máxima → doble altura + doble ancho
}

function renderGdi(text, options = {}) {
  const {
    maxCharsPerLine = 40,
    bold = false,
    fontName,
    fontSize
  } = options;

  const log = logger.get();
  log.debug('Renderizando texto en modo GDI', {
    charCount: text.length,
    maxCharsPerLine,
    bold,
    fontName,
    fontSize
  });

  const hasFontSettings = fontName !== undefined || fontSize !== undefined;
  const header = hasFontSettings ? escFont(fontName) + escSize(fontSize) : '';
  const footer = hasFontSettings ? ESC + '@' : '';
  const body = formatLines(text, maxCharsPerLine, bold);

  return header + body + footer;
}

module.exports = { renderGdi, wordWrap, formatLines, escFont, escSize };
