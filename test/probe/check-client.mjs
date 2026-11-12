// One-off: verify the plugin client bundle is actually served.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const DSH_ENTRY = process.env.DSH_ENTRY;
if (!DSH_ENTRY) throw new Error('Set DSH_ENTRY to the installed @deepseek-ai/dsh lib/bin.js path');
const child = spawn(process.execPath, [DSH_ENTRY, '--profile', 'web', '--patch', PROJECT_ROOT + '/test/probe/probe-patch.yml'], {
  env: { ...process.env, DSH_HOME: process.env.DSH_HOME ?? PROJECT_ROOT + '/.dsh-probe' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });
let url = null;
for (let i = 0; i < 120 && !url; i++) {
  await delay(1000);
  const m = log.match(/https?:\/\/[^\s"']+/);
  if (m) url = m[0].replace(/[)\].,]+$/, '');
}
const origin = new URL(url).origin;
const token = new URL(url).searchParams.get('token');
const connect = await fetch(origin + '/connect?token=' + encodeURIComponent(token) + '&interactions=none', { redirect: 'manual' });
const cookie = connect.headers.get('set-cookie').split(';')[0];
const paths = [
  '/plugins/dsh-vpn-assistant/client',
  '/plugins/vpn-assistant/client',
  '/plugins/??',
  '/plugins/dsh-vpn-assistant%2Fclient',
];
for (const p of paths) {
  const res = await fetch(origin + p, { headers: { cookie } });
  const text = await res.text();
  const hit = text.includes('vpn-assistant'); text.includes('__ModuleLoader__');
  console.log('GET', p, '->', res.status, 'len=' + text.length, hit ? 'CONTAINS-PLUGIN-CODE' : 'no match');
}
child.kill('SIGTERM');
process.exit(0);
