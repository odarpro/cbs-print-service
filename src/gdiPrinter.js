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

function renderGdi(text, options = {}) {
  const {
    maxCharsPerLine = 40,
    bold = false
  } = options;

  const log = logger.get();
  log.debug('Renderizando texto en modo GDI', {
    charCount: text.length,
    maxCharsPerLine,
    bold
  });

  return formatLines(text, maxCharsPerLine, bold);
}

module.exports = { renderGdi, wordWrap, formatLines };
