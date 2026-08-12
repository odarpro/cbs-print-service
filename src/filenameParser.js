'use strict';

const path = require('path');

const PARAM_DEFS = [
  { code: '43', key: 'cImpresionDirecta', desc: 'Tipo de impresión (A=Activo/Directa, I=Inactivo/GDI, H=Híbrido/PDF, C=Clásica/GDI+ VB)', defaultValue: 'A' },
  { code: '44', key: 'cNotificacion',    desc: 'Notificación toast (A=Activo/Habilitado, I=Inactivo/Deshabilitado)', defaultValue: null },
  { code: 'p',  key: 'cPrinterName',      desc: 'Nombre de la impresora destino',              defaultValue: null },
  { code: 'w',  key: 'cAnchoMaximo',      desc: 'Ancho máximo de caracteres por línea',        defaultValue: '40' },
  { code: 't',  key: 'cTamañoLetra',      desc: 'Tamaño de la fuente',                         defaultValue: '9' },
  { code: 'f',  key: 'cNombreFont',       desc: 'Nombre de la fuente',                         defaultValue: 'Courier_New' },
  { code: 'b',  key: 'cBold',             desc: 'Negrita (S=Negrita, N=No negrita)',              defaultValue: 'N' }
];

const CODE_MAP = {};
for (const def of PARAM_DEFS) {
  CODE_MAP[def.code] = def;
}

const SEPARATOR = '~';

function extractBaseName(filePath) {
  const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return lastSep !== -1 ? filePath.slice(lastSep + 1) : filePath;
}

function parse(fileName) {
  const base = extractBaseName(fileName);
  const dotIdx = base.lastIndexOf('.');
  const nameWithoutExt = dotIdx !== -1 ? base.slice(0, dotIdx) : base;

  let prefix = null;
  let rest = '';

  if (/^Rec/i.test(nameWithoutExt)) {
    prefix = 'voucher';
    rest = nameWithoutExt.slice(3);
  } else if (/^Val/i.test(nameWithoutExt)) {
    prefix = 'slip';
    rest = nameWithoutExt.slice(3);
  } else {
    return null;
  }

  const params = {};

  // Formato legacy: Rec<timestamp>.txt (sin parámetros)
  if (!rest.includes(SEPARATOR)) {
    return { prefix, params, hasParams: false };
  }

  // Formato con parámetros: Rec~m0~t9~...~43S.txt
  // El primer carácter debe ser el separador
  if (rest[0] !== SEPARATOR) {
    return { prefix, params, hasParams: false };
  }

  const segments = rest.slice(1).split(SEPARATOR);

  for (const segment of segments) {
    if (segment.length === 0) continue;
    const def = CODE_MAP[segment.slice(0, 1)] ||
                CODE_MAP[segment.slice(0, 2)] ||
                null;
    if (def && segment.startsWith(def.code)) {
      params[def.code] = segment.slice(def.code.length);
    }
  }

  return { prefix, params, hasParams: Object.keys(params).length > 0 };
}

function validate(parsed) {
  const errors = [];

  if (!parsed) {
    return { valid: true, errors: [] };
  }

  const p = parsed.params;

  if (p.t !== undefined) {
    const size = parseInt(p.t, 10);
    if (isNaN(size) || size < 1 || size > 72) {
      errors.push(`cTamañoLetra (t) inválido: "${p.t}". Debe ser un número entre 1 y 72.`);
    }
  }

  if (p.w !== undefined) {
    const width = parseInt(p.w, 10);
    if (isNaN(width) || width < 10 || width > 255) {
      errors.push(`cAnchoMaximo (w) inválido: "${p.w}". Debe ser un número entre 10 y 255.`);
    }
  }

  if (p.b !== undefined) {
    if (!['S', 'N'].includes(p.b.toUpperCase())) {
      errors.push(`cBold (b) inválido: "${p.b}". Debe ser S (Negrita) o N (No negrita).`);
    }
  }

  if (p['43'] !== undefined) {
    if (!['A', 'I', 'H', 'C'].includes(p['43'].toUpperCase())) {
      errors.push(`cImpresionDirecta (43) inválido: "${p['43']}". Debe ser A, I, H o C.`);
    }
  }

  if (p['44'] !== undefined) {
    if (!['A', 'I'].includes(p['44'].toUpperCase())) {
      errors.push(`cNotificacion (44) inválido: "${p['44']}". Debe ser A (Activo/Habilitado) o I (Inactivo/Deshabilitado).`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function buildExample() {
  return 'Rec~t9~fCourier_New~bN~pMTU-950~w40~43A.txt';
}

function describeFormat() {
  const lines = [
    '=== Formato de nombre de archivo para CBS Print Service ===',
    '',
    'Formato:',
    '  <Prefijo>~<param1>~<param2>~...~<paramN>.txt',
    '',
    '  <Prefijo>:  "Rec" para Voucher, "Val" para Slip/Validación',
    '  <param>:    <Código><Valor> (sin separador entre código y valor)',
    '',
    '  El separador entre parámetros es "~" (tilde).',
    '',
    'Códigos de parámetros:',
  ];
  for (const def of PARAM_DEFS) {
    lines.push(`  ${def.code.padEnd(4)} ${def.desc.padEnd(60)} Valor por defecto: ${def.defaultValue}`);
  }
  lines.push('');
  lines.push('Ejemplo completo:');
  lines.push(`  ${buildExample()}`);
  lines.push('');
  lines.push('Equivalente a:');
  lines.push('  /t9  /fCourier_New  /bN  /MTU-950  /w40  /43A');
  lines.push('');
  lines.push('Notas:');
  lines.push('  • El carácter "~" está reservado como separador y no puede');
  lines.push('    usarse dentro de los valores de los parámetros.');
  lines.push('  • Los caracteres \\ y / están prohibidos en nombres de archivo');
  lines.push('    de Windows y no pueden usarse dentro de ningún valor.');
  lines.push('');
  lines.push('Compatibilidad hacia atrás:');
  lines.push('  Los nombres sin el separador "~" (ej: Rec20260706_143022.txt)');
  lines.push('  continúan funcionando usando la configuración de config.json.');
  return lines.join('\n');
}

module.exports = { parse, validate, PARAM_DEFS, buildExample, describeFormat };
