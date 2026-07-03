'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findNode() {
  // 1. Try system PATH
  try {
    const result = execSync('node --version', { encoding: 'utf8', timeout: 5000 });
    if (result.startsWith('v')) {
      return { exe: 'node', version: result.trim(), source: 'system' };
    }
  } catch {}

  // 2. Fallback: bundled portable node.exe
  const bundled = path.join(__dirname, '..', 'bin', 'node.exe');
  if (fs.existsSync(bundled)) {
    try {
      const result = execSync(`"${bundled}" --version`, { encoding: 'utf8', timeout: 5000 });
      if (result.startsWith('v')) {
        return { exe: bundled, version: result.trim(), source: 'bundled' };
      }
    } catch {}
  }

  console.error('Node.js no encontrado. Instale Node.js 18+ o asegúrese de que bin\\node.exe exista.');
  process.exit(1);
}

const info = findNode();
console.log(info.exe);
