const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const config = require('./qa-config.json');
const output = process.env.NEXUS_QA_OUTPUT;
const report = { platform: process.platform, architecture: process.arch, osRelease: os.release(), enrollmentCredentialsUsed: false,
  scope: 'Packaged Windows runtime and network. Not Windows 11/SAC, native Connect IPC, OS capture or SendInput verification.' };
let app;
async function main() {
  assert.equal(process.platform, 'win32', 'Windows required; do not run a Linux shim');
  assert.ok(output && process.env.NEXUS_QA_EXE, 'Missing test executable/output');
  await fs.mkdir(output, { recursive: true });
  const server = new URL(config.server);
  assert.equal(server.protocol, 'https:');
  assert.equal(server.username + server.password + server.search + server.hash, '');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-isolated-qa-'));
  app = await electron.launch({ executablePath: process.env.NEXUS_QA_EXE, timeout: 45000, args: [`--user-data-dir=${profile}`] });
  const native = await app.firstWindow();
  const state = await native.evaluate(() => window.nexus.state());
  assert.equal(state.configLoaded, false, 'Refusing to use an existing device pairing');
  assert.equal(state.version, config.version);
  report.native = { version: state.version, phase: state.phase, configLoaded: false };
  await native.screenshot({ path: path.join(output, 'native-startup.png') });
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node }));
  report.network = await app.evaluate(async ({ net }, origin) => {
    const results = {};
    const fake = JSON.stringify({ deviceId: '00000000-0000-4000-8000-000000000000', enrollmentKey: 'x'.repeat(64) });
    for (const mode of ['node-fetch', 'electron-fetch', 'electron-request']) {
      for (const method of ['GET', 'POST']) {
        const url = origin + (method === 'GET' ? '/api/healthz' : '/api/agents/ice-config');
        try {
          let status;
          if (mode === 'electron-request') {
            status = await new Promise((resolve, reject) => {
              let request, settled = false;
              const finish = (error, code) => {
                if (settled) return;
                settled = true; clearTimeout(timer);
                if (error) { reject(error); try { request?.abort(); } catch {} }
                else resolve(code);
              };
              const timer = setTimeout(() => finish(new Error('HTTPS timeout')), 12000);
              try {
                request = net.request({ url, method, credentials: 'omit', redirect: 'error' });
                request.on('error', error => finish(error));
                request.on('response', response => {
                  response.on('error', error => finish(error));
                  response.on('data', () => {});
                  response.on('end', () => finish(null, response.statusCode));
                });
                if (method === 'POST') { request.setHeader('Content-Type', 'application/json'); request.write(fake); }
                request.end();
              } catch (error) { finish(error); }
            });
          } else {
            const options = { method, redirect: 'error', signal: AbortSignal.timeout(12000),
              ...(mode === 'electron-fetch' ? { credentials: 'omit' } : {}),
              ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: fake } : {}) };
            const response = mode === 'node-fetch' ? await fetch(url, options) : await net.fetch(url, options);
            status = response.status; await response.body?.cancel();
          }
          results[`${mode}-${method}`] = { status, expected: method === 'GET' ? 200 : 401 };
        } catch (error) {
          // Public health/known fake credential only; never record response bodies or cookies.
          results[`${mode}-${method}`] = { error: { type: typeof error, name: error?.name ?? null,
            message: String(error?.message ?? error).slice(0, 500), code: typeof error?.code === 'string' ? error.code : null } };
        }
      }
    }
    return results;
  }, server.origin);
  const created = app.waitForEvent('window', { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }, url) => {
    const viewer = new BrowserWindow({ width: 1280, height: 850,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'nexus-isolated-cloud-console' } });
    void viewer.loadURL(url);
  }, server.origin + '/?remoteCode=123456789');
  const viewer = await created;
  await viewer.waitForLoadState('domcontentloaded', { timeout: 30000 });
  try { await viewer.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 20000 }); } catch {}
  report.console = { signInVisible: await viewer.locator('input[type="password"]').isVisible(),
    stillVerifyingSession: /verifying session|verificando sesi[oó]n/i.test(await viewer.locator('body').innerText()),
    scope: 'Fresh console equivalent only; no authentication or real remote device connection' };
  await viewer.screenshot({ path: path.join(output, 'console-startup.png') });
  report.passed = Object.values(report.network).every(r => r.status === r.expected) && report.console.signInVisible;
  if (!report.passed) process.exitCode = 1;
}
main().catch(error => { report.passed = false; report.fatal = String(error.message).slice(0, 1500); process.exitCode = 1; })
  .finally(async () => {
    try { await app?.close(); } catch {}
    if (output) { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
    console.log(JSON.stringify(report, null, 2));
  });
