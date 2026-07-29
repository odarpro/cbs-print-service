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

function escFont(fontName) {
  if (!fontName) return '';
  const name = fontName.replace(/_/g, ' ').toLowerCase();
  let code;
  if (name.includes('draft')) code = 0;
  else if (name.includes('roman') || name.includes('times')) code = 1;
  else if (name.includes('sans') || name.includes('arial') || name.includes('helvetica') || name.includes('calibri')) code = 2;
  else if (name.includes('courier')) code = 3;
  else if (name.includes('prestige')) code = 4;
  else if (name.includes('script')) code = 5;
  else if (name.includes('ocr')) code = 6;
  else code = 0;
  return ESC + 'k' + String.fromCharCode(code);
}

function escSize(fontSize) {
  if (fontSize === undefined || fontSize === null) return '';
  const size = parseInt(fontSize, 10);
  if (isNaN(size)) return '';
  if (size <= 8) return '\x0F';
  if (size <= 11) return ESC + 'g';
  if (size <= 14) return ESC + 'M';
  return ESC + 'P';
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
