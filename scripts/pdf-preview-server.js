'use strict';

// Servidor local de pruebas para visualizar la salida de CapturaPDF.
const fs = require('fs');
const http = require('http');
const path = require('path');

const port = Number(process.argv[2]) || 8787;
const captureFolder = process.argv[3] || 'C:\\Impresiones\\PDF_Captura';

function latestPdf() {
  try {
    return fs.readdirSync(captureFolder)
      .filter(file => path.extname(file).toLowerCase() === '.pdf')
      .map(file => ({ file, stat: fs.statSync(path.join(captureFolder, file)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.file || null;
  } catch {
    return null;
  }
}

function send(res, status, contentType, body) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.url === '/latest.pdf') {
    const file = latestPdf();
    if (!file) return send(res, 404, 'text/plain; charset=utf-8', 'Aún no hay un PDF capturado.');
    const filePath = path.join(captureFolder, file);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' });
    return fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  }

  if (req.url !== '/') return send(res, 404, 'text/plain; charset=utf-8', 'No encontrado');
  const file = latestPdf();
  const title = file ? `Última captura: ${file}` : 'Esperando una captura PDF';
  return send(res, 200, 'text/html; charset=utf-8', `<!doctype html>
<html lang="es"><meta charset="utf-8"><title>CBS Print Preview</title>
<style>body{margin:0;background:#1e293b;color:#e2e8f0;font:14px system-ui}header{padding:14px 20px;background:#0f172a}iframe{border:0;width:100vw;height:calc(100vh - 53px)}</style>
<header>${title}. Actualización automática cada 2 segundos.</header>
<iframe id="pdf" src="/latest.pdf"></iframe>
<script>setInterval(()=>document.getElementById('pdf').src='/latest.pdf?'+Date.now(),2000)</script></html>`);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Visor PDF activo en http://127.0.0.1:${port}`);
  console.log(`Carpeta de captura: ${captureFolder}`);
});
