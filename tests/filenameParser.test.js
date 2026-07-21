'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const filenameParser = require(path.join(__dirname, '..', 'src', 'filenameParser'));

describe('filenameParser.parse()', () => {

  it('reconoce prefijo Rec como voucher', () => {
    const result = filenameParser.parse('Rec20260706_143022.txt');
    assert.equal(result.prefix, 'voucher');
  });

  it('reconoce prefijo Val como slip', () => {
    const result = filenameParser.parse('Val20260706_143022.txt');
    assert.equal(result.prefix, 'slip');
  });

  it('retorna null para archivo sin prefijo válido', () => {
    const result = filenameParser.parse('noticia.txt');
    assert.equal(result, null);
  });

  it('retorna hasParams=false para formato legacy sin parámetros', () => {
    const result = filenameParser.parse('Rec20260706_143022_001.txt');
    assert.equal(result.hasParams, false);
    assert.equal(result.prefix, 'voucher');
  });

  it('extrae todos los parámetros de un nombre completo', () => {
    const result = filenameParser.parse(
      'Rec~m0~t9~fCourier_New~bN~a1contenido.txt~p1EPSON_LX-350~w140~43A.txt'
    );
    assert.equal(result.prefix, 'voucher');
    assert.equal(result.hasParams, true);
    assert.equal(result.params.m, '0');
    assert.equal(result.params.t, '9');
    assert.equal(result.params.f, 'Courier_New');
    assert.equal(result.params.b, 'N');
    assert.equal(result.params.a1, 'contenido.txt');
    assert.equal(result.params.p1, 'EPSON_LX-350');
    assert.equal(result.params.w1, '40');
    assert.equal(result.params['43'], 'A');
  });

  it('extrae parámetros con modo GDI (43=I) y bold activo (b=S)', () => {
    const result = filenameParser.parse(
      'Val~m1~t12~fArial~bS~a1reporte.txt~p1Zebra_ZPL~w180~43I.txt'
    );
    assert.equal(result.prefix, 'slip');
    assert.equal(result.params.m, '1');
    assert.equal(result.params.t, '12');
    assert.equal(result.params.f, 'Arial');
    assert.equal(result.params.b, 'S');
    assert.equal(result.params.a1, 'reporte.txt');
    assert.equal(result.params.p1, 'Zebra_ZPL');
    assert.equal(result.params.w1, '80');
    assert.equal(result.params['43'], 'I');
  });

  it('extrae parámetro 44=A (notificación habilitada)', () => {
    const result = filenameParser.parse(
      'Rec~m0~t9~a1test.txt~p1Printer~w140~44A.txt'
    );
    assert.equal(result.prefix, 'voucher');
    assert.equal(result.params['44'], 'A');
  });

  it('extrae parámetro 44=I (notificación deshabilitada)', () => {
    const result = filenameParser.parse(
      'Rec~m0~t9~a1test.txt~p1Printer~w140~44I.txt'
    );
    assert.equal(result.prefix, 'voucher');
    assert.equal(result.params['44'], 'I');
  });

  it('extrae parámetros 43 y 44 juntos', () => {
    const result = filenameParser.parse(
      'Rec~m0~t9~a1test.txt~p1Printer~w140~43A~44I.txt'
    );
    assert.equal(result.params['43'], 'A');
    assert.equal(result.params['44'], 'I');
  });

  it('tolera mayúsculas/minúsculas en el prefijo', () => {
    const result = filenameParser.parse('REC~m0~t9.txt');
    assert.equal(result.prefix, 'voucher');
    assert.equal(result.params.m, '0');
    assert.equal(result.params.t, '9');
  });

  it('tolera ruta completa como entrada', () => {
    const result = filenameParser.parse('D:\\Impresiones\\Rec~m0.txt');
    assert.equal(result.prefix, 'voucher');
    assert.equal(result.params.m, '0');
  });

  it('extrae solo parámetros presentes (parcial)', () => {
    const result = filenameParser.parse('Rec~m1~w180.txt');
    assert.equal(result.prefix, 'voucher');
    assert.equal(result.params.m, '1');
    assert.equal(result.params.w1, '80');
    assert.equal(result.params.t, undefined);
  });

  it('maneja valor de parámetro con guiones y números', () => {
    const result = filenameParser.parse('Rec~p1EPSON-LX-350_01.txt');
    assert.equal(result.params.p1, 'EPSON-LX-350_01');
  });

  it('retorna hasParams=false para Rec seguido solo de números', () => {
    const result = filenameParser.parse('Rec12345678.txt');
    assert.equal(result.hasParams, false);
    assert.deepEqual(result.params, {});
  });

  it('no se confunde con la letra t dentro de palabras', () => {
    const result = filenameParser.parse('Rec~m0~t9~fCourier_New.txt');
    assert.equal(result.params.m, '0');
    assert.equal(result.params.t, '9');
    assert.equal(result.params.f, 'Courier_New');
  });
});

describe('filenameParser.validate()', () => {

  it('acepta parámetros válidos', () => {
    const parsed = filenameParser.parse('Rec~m0~t9~fCourier_New~bN~a1test.txt~p1Printer~w140~43A.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('rechaza cMetodo (m) inválido', () => {
    const parsed = filenameParser.parse('Rec~m2.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cMetodo'));
  });

  it('rechaza cTamañoLetra (t) no numérico', () => {
    const parsed = filenameParser.parse('Rec~m0~tXX.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cTamañoLetra'));
  });

  it('rechaza cTamañoLetra (t) fuera de rango', () => {
    const parsed = filenameParser.parse('Rec~m0~t100.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cTamañoLetra'));
  });

  it('rechaza cAnchoMaximo (w1) fuera de rango', () => {
    const parsed = filenameParser.parse('Rec~w15.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cAnchoMaximo'));
  });

  it('rechaza cBold (b) inválido', () => {
    const parsed = filenameParser.parse('Rec~bX.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cBold'));
  });

  it('rechaza cImpresionDirecta (43) inválido', () => {
    const parsed = filenameParser.parse('Rec~43X.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cImpresionDirecta'));
  });

  it('acepta cNotificacion (44) válido con A', () => {
    const parsed = filenameParser.parse('Rec~44A.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, true);
  });

  it('acepta cNotificacion (44) válido con I', () => {
    const parsed = filenameParser.parse('Rec~44I.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, true);
  });

  it('rechaza cNotificacion (44) inválido', () => {
    const parsed = filenameParser.parse('Rec~44X.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('cNotificacion'));
  });

  it('retorna múltiples errores cuando varios parámetros son inválidos', () => {
    const parsed = filenameParser.parse('Rec~mX~tY~bZ~w15.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });

  it('acepta formato legacy sin parámetros', () => {
    const parsed = filenameParser.parse('Rec1234.txt');
    const result = filenameParser.validate(parsed);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('acepta null (archivo no reconocido)', () => {
    const result = filenameParser.validate(null);
    assert.equal(result.valid, true);
  });
});

describe('filenameParser.describeFormat()', () => {
  it('retorna documentación del formato', () => {
    const docs = filenameParser.describeFormat();
    assert.ok(docs.includes('Formato'));
    assert.ok(docs.includes('Rec'));
    assert.ok(docs.includes('Val'));
    assert.ok(docs.includes('~'));
  });
});

describe('filenameParser.buildExample()', () => {
  it('retorna un nombre de archivo de ejemplo', () => {
    const example = filenameParser.buildExample();
    assert.ok(example.startsWith('Rec'));
    assert.ok(example.endsWith('.txt'));
    assert.ok(example.includes('~m0'));
    assert.ok(example.includes('~43A'));
    assert.ok(example.includes('contenido.txt'));
  });
});
