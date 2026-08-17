'use strict';
// =============================================================================
// gdiWorker.js  –  CBS Print Service  (modo 43I / GDI real)
//
// Ejecuta la secuencia GDI completa en un WORKER THREAD, para que un driver
// que se cuelgue (p. ej. puerto PORTPROMPT que pide nombre de archivo, o una
// impresora lenta) NUNCA bloquee el hilo principal del servicio ni la cola FIFO.
//
// Recibe el trabajo por workerData y responde por parentPort:
//   { ok: true,  lines }                    → éxito
//   { ok: false, error: "<mensaje>" }       → error
//
// La secuencia (idéntica a la anterior, pero aislada):
//   CreateDCW("WINSPOOL") → CreateFontW → SelectObject → GetTextMetricsW
//   → StartDocW/StartPage → TextOutW por línea → EndPage → EndDoc
// =============================================================================

const { parentPort, workerData } = require('worker_threads');
const koffi = require('koffi');

const WINSPOOL_DRIVER = 'WINSPOOL';
const LOGPIXELSY      = 90;   // índice de GetDeviceCaps: píxeles por pulgada vertical
const DEFAULT_CHARSET = 1;    // DEFAULT_CHARSET
const FW_NORMAL       = 400;
const FW_BOLD         = 700;

function declareApi() {
  koffi.struct('CBS_DOCINFOW', {
    cbSize: 'int',
    lpszDocName: 'char16_t *',
    lpszOutput: 'char16_t *',
    lpszDatatype: 'char16_t *',
    fwType: 'uint32'
  });

  koffi.struct('CBS_TEXTMETRICW', {
    tmHeight: 'int32',
    tmAscent: 'int32',
    tmDescent: 'int32',
    tmInternalLeading: 'int32',
    tmExternalLeading: 'int32',
    tmAveCharWidth: 'int32',
    tmMaxCharWidth: 'int32',
    tmWeight: 'int32',
    tmOverhang: 'int32',
    tmDigitizedAspectX: 'int32',
    tmDigitizedAspectY: 'int32',
    tmFirstChar: 'char16_t',
    tmLastChar: 'char16_t',
    tmDefaultChar: 'char16_t',
    tmBreakChar: 'char16_t',
    tmItalic: 'uint8',
    tmUnderlined: 'uint8',
    tmStruckOut: 'uint8',
    tmPitchAndFamily: 'uint8',
    tmCharSet: 'uint8'
  });

  const gdi32 = koffi.load('gdi32.dll');

  const api = {
    CreateDCW:      gdi32.func('CreateDCW', 'void *', ['char16_t *', 'char16_t *', 'char16_t *', 'void *']),
    CreateFontW:    gdi32.func('CreateFontW', 'void *', ['int', 'int', 'int', 'int', 'int', 'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'uint32', 'char16_t *']),
    DeleteDC:       gdi32.func('DeleteDC', 'int', ['void *']),
    DeleteObject:   gdi32.func('DeleteObject', 'int', ['void *']),
    EndDoc:         gdi32.func('EndDoc', 'int', ['void *']),
    EndPage:        gdi32.func('EndPage', 'int', ['void *']),
    GetDeviceCaps:  gdi32.func('GetDeviceCaps', 'int', ['void *', 'int']),
    GetTextMetricsW: gdi32.func('GetTextMetricsW', 'int', ['void *', koffi.out('CBS_TEXTMETRICW *')]),
    SelectObject:   gdi32.func('SelectObject', 'void *', ['void *', 'void *']),
    StartDocW:      gdi32.func('StartDocW', 'int', ['void *', 'CBS_DOCINFOW *']),
    StartPage:      gdi32.func('StartPage', 'int', ['void *']),
    TextOutW:       gdi32.func('TextOutW', 'int', ['void *', 'int', 'int', 'char16_t *', 'int'])
  };

  return { koffi, api };
}

/**
 * Dibuja las líneas en el DC de la impresora usando GDI (síncrono, dentro del worker).
 */
function printGdiText({ api, koffi, printerName, lines, fontName, fontSize, bold, copies, docTitle }) {
  const hdc = api.CreateDCW(WINSPOOL_DRIVER, printerName, null, null);
  if (!hdc) {
    throw new Error(`no se pudo abrir la impresora "${printerName}" (CreateDCW).`);
  }

  let font = null;
  let previousObject = null;

  try {
    // Tamaño en puntos → altura en píxeles del dispositivo (negativo = altura de carácter)
    const logPixelsY  = api.GetDeviceCaps(hdc, LOGPIXELSY) || 96;
    const fontHeightPx = -Math.round((fontSize * logPixelsY) / 72);

    font = api.CreateFontW(
      fontHeightPx,
      0,                        // ancho: automático
      0,                        // escapement
      0,                        // orientación
      bold ? FW_BOLD : FW_NORMAL,
      0,                        // italic
      0,                        // underline
      0,                        // strikeout
      DEFAULT_CHARSET,
      0, 0, 0, 0,               // precisión de salida/clip, calidad, pitch
      fontName
    );
    if (!font) {
      throw new Error(`no se pudo crear la fuente "${fontName}" (CreateFontW).`);
    }

    previousObject = api.SelectObject(hdc, font);

    // Altura de línea real de la fuente (equivalente a font.GetHeight() de .NET)
    let lineHeight = Math.round(Math.abs(fontHeightPx) * 1.2);
    const metrics = {};
    if (api.GetTextMetricsW(hdc, metrics) && metrics.tmHeight > 0) {
      lineHeight = metrics.tmHeight + (metrics.tmExternalLeading || 0);
    }

    for (let c = 1; c <= copies; c++) {
      const docInfo = {
        cbSize: koffi.sizeof('CBS_DOCINFOW'),
        lpszDocName: `${docTitle} (copia ${c}/${copies})`,
        lpszOutput: null,
        lpszDatatype: null,
        fwType: 0
      };

      if (api.StartDocW(hdc, docInfo) <= 0) {
        throw new Error(`StartDoc falló para "${printerName}".`);
      }
      try {
        if (api.StartPage(hdc) <= 0) {
          throw new Error('StartPage falló.');
        }

        let y = 0;
        for (const line of lines) {
          if (line.length > 0 && !api.TextOutW(hdc, 0, y, line, line.length)) {
            throw new Error('TextOutW falló.');
          }
          y += lineHeight;
        }

        if (api.EndPage(hdc) <= 0) {
          throw new Error('EndPage falló.');
        }
      } finally {
        api.EndDoc(hdc);
      }
    }
  } finally {
    if (previousObject) api.SelectObject(hdc, previousObject);
    if (font) api.DeleteObject(font);
    api.DeleteDC(hdc);
  }

  return lines.length;
}

function run() {
  try {
    const { koffi: k, api } = declareApi();
    const {
      printerName,
      lines,
      fontName,
      fontSize,
      bold,
      copies,
      docTitle
    } = workerData;

    const drawn = printGdiText({ api, koffi: k, printerName, lines, fontName, fontSize, bold, copies, docTitle });
    parentPort.postMessage({ ok: true, lines: drawn });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: `Modo GDI real: ${err.message}` });
  }
}

run();
