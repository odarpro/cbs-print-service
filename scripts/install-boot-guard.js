'use strict';
// =============================================================================
// install-boot-guard.js  –  CBS Print Service
//
// Registra una tarea programada que se ejecuta al arrancar Windows (con 30 s
// de retardo) para:
//   - esperar a que el spooler y el disco de trabajo estén disponibles,
//   - limpiar trabajos CBS huérfanos y .txt pendientes,
//   - arrancar el servicio si no quedó RUNNING.
//
// Uso:
//   node scripts/install-boot-guard.js
//   node scripts/install-boot-guard.js /uninstall
// =============================================================================

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TASK_NAME = '\\CBS Print Service\\CBSBootGuard';
const INSTALL_DIR = path.join(__dirname, '..');
const BOOT_GUARD_SCRIPT = path.join(__dirname, 'boot-guard.js');

function getNodeExe() {
  const bundled = path.join(INSTALL_DIR, 'bin', 'node.exe');
  return fs.existsSync(bundled) ? bundled : 'node.exe';
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTaskXml() {
  const command = getNodeExe();
  const args = `"${BOOT_GUARD_SCRIPT}"`;

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>CBS Print Service - espera spooler/disco, limpia cola y arranca el servicio</Description>
    <URI>${xmlEscape(TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(command)}</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(INSTALL_DIR)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

function runSchtasks(args) {
  return new Promise(resolve => {
    execFile('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code || 1) : 0,
        output: `${stdout || ''}${stderr || ''}`.trim()
      });
    });
  });
}

async function install() {
  const xmlPath = path.join(os.tmpdir(), `cbs-boot-guard-${process.pid}.xml`);

  try {
    // Task Scheduler espera XML Unicode; incluir BOM mejora la compatibilidad.
    fs.writeFileSync(xmlPath, '\uFEFF' + buildTaskXml(), 'utf16le');
    const result = await runSchtasks(['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F']);
    if (result.code !== 0) {
      return { ok: false, error: result.output || `schtasks devolvió ${result.code}` };
    }
    return { ok: true, output: result.output };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { fs.unlinkSync(xmlPath); } catch {}
  }
}

async function uninstall() {
  await runSchtasks(['/End', '/TN', TASK_NAME]);
  const result = await runSchtasks(['/Delete', '/TN', TASK_NAME, '/F']);
  // 1 = tarea inexistente; no es un error para el desinstalador.
  return { ok: result.code === 0 || result.code === 1, output: result.output };
}

module.exports = { install, uninstall, buildTaskXml, TASK_NAME };

if (require.main === module) {
  const uninstallMode = process.argv.includes('/uninstall') || process.argv.includes('--uninstall');

  (uninstallMode ? uninstall() : install())
    .then(result => {
      if (result.ok) {
        console.log(uninstallMode
          ? `[OK] Tarea "${TASK_NAME}" eliminada.`
          : `[OK] Tarea "${TASK_NAME}" instalada.`);
        process.exit(0);
      }
      console.error(`[ERROR] ${result.error || result.output || 'error desconocido'}`);
      process.exit(1);
    })
    .catch(err => {
      console.error(`[ERROR] ${err.message}`);
      process.exit(1);
    });
}
