// One-off: fetch index via token query, find plugin combo URL, fetch it.
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
const res = await fetch(url);
const html = await res.text();
console.log('index status:', res.status, 'len=' + html.length, 'mentions vpn-assistant:', html.includes('vpn-assistant'));
const urls = [...html.matchAll(/(?:src|href)="([^"]*plugins[^"]*)"/g)].map((m) => m[1]);
console.log('plugin combo refs:', urls.length);
const origin = new URL(url).origin;
for (const u of urls.slice(0, 8)) {
  const abs = u.startsWith('http') ? u : origin + u;
  const res2 = await fetch(abs);
  const body = await res2.text();
  const ok = [body.includes('__ModuleLoader__'), body.includes('vpn-assistant')].every(Boolean);
  console.log('GET', u.slice(0, 90), '->', res2.status, 'len=' + body.length, ok ? 'CLIENT-BUNDLE-OK' : '');
}
child.kill('SIGTERM');
process.exit(0);
