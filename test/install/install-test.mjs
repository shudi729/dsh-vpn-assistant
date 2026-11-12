import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
// Low-level install / uninstall lifecycle test for the vpn-assistant bundle
// using an INDEPENDENT DSH_HOME. Verifies that the packaged files load their
// routes, skills and resources, then fully clean them up. The release is also
// verified separately through the standard `dsh plugin add` command.
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = PROJECT_ROOT;
const DSH_HOME = PROJECT_ROOT + '/.dsh-install';
const DSH_ENTRY = process.env.DSH_ENTRY;
if (!DSH_ENTRY) throw new Error('Set DSH_ENTRY to the installed @deepseek-ai/dsh lib/bin.js path');
const PATCH = PROJECT_ROOT + '/test/probe/probe-patch.yml';
const PROFILE_SRC = PROJECT_ROOT + '/.dsh-probe/profiles/web';
const PROFILE_DST = path.join(DSH_HOME, 'profiles', 'web');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PACKAGE_NAME = packageJson.name;
const BUNDLE_DIR = path.join(PROFILE_DST, 'node_modules', ...PACKAGE_NAME.split('/'));
const PKGMAP = path.join(PROFILE_DST, 'node_modules', '.package-map.json');
const TGZ = PACKAGE_NAME.replace(/^@/, '').replaceAll('/', '-') + '-' + packageJson.version + '.tgz';
if (!TGZ) { console.error('no tgz found — run npm pack first'); process.exit(2); }

const testBoundary = path.resolve(ROOT) + path.sep;
for (const p of [DSH_HOME, BUNDLE_DIR, path.join(ROOT, '_extract')]) { if (!path.resolve(p).startsWith(testBoundary)) throw new Error('Unsafe test cleanup path'); }
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail: String(detail ?? '') });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
};

function readPkgMap() { return JSON.parse(fs.readFileSync(PKGMAP, 'utf8')); }
function writePkgMap(j) { fs.writeFileSync(PKGMAP, JSON.stringify(j, null, 2) + '\n', 'utf8'); }

// --- baseline: independent DSH_HOME with web profile but no vpn-assistant ---
function setupBaseline() {
  fs.rmSync(DSH_HOME, { recursive: true, force: true });
  fs.cpSync(PROFILE_SRC, PROFILE_DST, { recursive: true });
  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  const pm = readPkgMap();
  delete pm.packages['.'].dependencies[PACKAGE_NAME];
  writePkgMap(pm);
}

function install() {
  const tmp = path.join(ROOT, '_extract');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync('tar.exe', ['-xf', path.join(ROOT, TGZ), '-C', tmp]);
  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  fs.cpSync(path.join(tmp, 'package'), BUNDLE_DIR, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  const pm = readPkgMap();
  pm.packages['.'].dependencies[PACKAGE_NAME] = '../../../..';
  writePkgMap(pm);
}

function uninstall() {
  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  const pm = readPkgMap();
  delete pm.packages['.'].dependencies[PACKAGE_NAME];
  writePkgMap(pm);
}

async function boot() {
  const child = spawn(process.execPath, [DSH_ENTRY, '--profile', 'web', '--patch', PATCH], {
    env: { ...process.env, DSH_HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  let baseUrl = null;
  for (let i = 0; i < 120 && !baseUrl; i++) {
    await delay(1000);
    const m = log.match(/https?:\/\/[^\s"']+/);
    if (m) baseUrl = m[0].replace(/[)\].,]+$/, '');
    if (child.exitCode !== null) break;
  }
  if (!baseUrl) { child.kill('SIGKILL'); throw new Error('no boot URL; tail ' + log.slice(-200)); }
  const origin = new URL(baseUrl).origin;
  const token = new URL(baseUrl).searchParams.get('token');
  let cookie = null;
  if (token) {
    const c = await fetch(origin + '/connect?token=' + encodeURIComponent(token) + '&interactions=none', { redirect: 'manual' });
    const sc = c.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
  }
  const get = (route) => fetch(origin + route, { headers: cookie ? { cookie } : {} });
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { cookie: cookie || '', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { child, baseUrl, get, post };
}
async function shutdown(child) {
  child.kill('SIGTERM');
  await delay(1500);
  try { child.kill('SIGKILL'); } catch { /* gone */ }
}

try {
  setupBaseline();
  record('A0 independent DSH_HOME baseline created', true, 'profile copied, vpn-assistant stripped');

  // A: baseline must NOT serve the plugin
  let r = await boot();
  const baseStatus = await r.get('/vpn-assistant/api/status');
  record('A1 baseline has no plugin route (404)', baseStatus.status === 404, 'http ' + baseStatus.status);
  const baseProviders = await r.get('/vpn-assistant/api/providers');
  record('A2 baseline providers route gone (404)', baseProviders.status === 404, 'http ' + baseProviders.status);
  await shutdown(r.child);

  // B: real install from the tgz artifact
  install();
  record('B0 tgz extracted into profile node_modules', fs.existsSync(path.join(BUNDLE_DIR, 'package.json')), BUNDLE_DIR);
  let pm = readPkgMap();
  record('B0b package-map registers ' + PACKAGE_NAME, !!pm.packages['.'].dependencies[PACKAGE_NAME], JSON.stringify(pm.packages['.'].dependencies));

  r = await boot();
  const statusRes = await r.get('/vpn-assistant/api/status');
  const statusBody = await statusRes.json().catch(() => null);
  record('B1 GET /api/status 200 after install', statusRes.status === 200 && statusBody?.ok === true, 'http ' + statusRes.status);
  const skills = statusBody?.result?.skills ?? {};
  record('B2 skills registered after install', skills.registered === 9 && (skills.failures ?? []).length === 0,
    'registered=' + skills.registered + '/' + skills.expected + ' failures=' + JSON.stringify(skills.failures));
  const provRes = await r.get('/vpn-assistant/api/providers');
  const provBody = await provRes.json().catch(() => null);
  record('B3 GET /api/providers 200 (6 items)', provRes.status === 200 && provBody?.result?.length === 6, 'http ' + provRes.status + ' n=' + provBody?.result?.length);
  const metaRes = await r.get('/vpn-assistant/api/meta');
  record('B4 GET /api/meta 200 (static resource)', metaRes.status === 200, 'http ' + metaRes.status);
  const image = await r.get('/vpn-assistant/api/illustrations/windows-install.svg');
  record('B5 installed package contains original SVG', image.status === 200 && /<svg/.test(await image.text()));
  const grant = await r.post('/vpn-assistant/api/helper', { action: 'grant', scopes: ['device'] });
  const scan = await r.post('/vpn-assistant/api/helper', { action: 'device' });
  const scanBody = await scan.json();
  record('B6 installed helper authenticates and reads real OS', grant.status === 200 && scan.status === 200 && scanBody.result?.system?.platform === process.platform);
  await r.post('/vpn-assistant/api/helper', { action: 'revoke' });
  await shutdown(r.child);

  // C: uninstall + verify full cleanup
  uninstall();
  record('C0 bundle dir removed', !fs.existsSync(BUNDLE_DIR), BUNDLE_DIR);
  pm = readPkgMap();
  record('C0b package-map entry removed', !pm.packages['.'].dependencies[PACKAGE_NAME], JSON.stringify(pm.packages['.'].dependencies));

  r = await boot();
  const offStatus = await r.get('/vpn-assistant/api/status');
  record('C1 route cleaned after uninstall (404)', offStatus.status === 404, 'http ' + offStatus.status);
  const offProv = await r.get('/vpn-assistant/api/providers');
  record('C2 providers route cleaned (404)', offProv.status === 404, 'http ' + offProv.status);
  const offMeta = await r.get('/vpn-assistant/api/meta');
  record('C3 static resource route cleaned (404)', offMeta.status === 404, 'http ' + offMeta.status);
  const offHelper = await r.post('/vpn-assistant/api/helper', { action: 'device' });
  const offHelperGet = await r.get('/vpn-assistant/api/helper');
  record('C4 helper route removed after uninstall', offHelperGet.status === 404 && offHelper.status !== 200, 'GET=' + offHelperGet.status + ' POST=' + offHelper.status + ' (host fallback)');
  await shutdown(r.child);
} catch (error) {
  record('INSTALL/UNINSTALL flow', false, error?.message ?? String(error));
} finally {
  try { fs.rmSync(path.join(ROOT, '_extract'), { recursive: true, force: true }); } catch { /* */ }
}
const passed = results.filter((r) => r.ok).length;
console.log('SUMMARY ' + passed + '/' + results.length + ' passed');
fs.writeFileSync(PROJECT_ROOT + '/docs/install-results.json', JSON.stringify(results, null, 2), 'utf8');
process.exit(passed === results.length ? 0 : 1);
