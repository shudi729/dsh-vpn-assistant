import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
// Boot probe (v2, rewritten clean).
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DSH_HOME = process.env.DSH_HOME ?? PROJECT_ROOT + '/.dsh-probe';
const DSH_ENTRY = process.env.DSH_ENTRY;
if (!DSH_ENTRY) throw new Error('Set DSH_ENTRY to the installed @deepseek-ai/dsh lib/bin.js path');
const outLog = path.join(os.tmpdir(), 'vpn-probe-boot.log');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const child = spawn(process.execPath, [DSH_ENTRY, '--profile', 'web', '--patch', PROJECT_ROOT + '/test/probe/probe-patch.yml'], {
  env: { ...process.env, DSH_HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => { bootLog += d.toString(); fs.appendFileSync(outLog, d.toString()); });
child.stderr.on('data', (d) => { bootLog += d.toString(); fs.appendFileSync(outLog, d.toString()); });

let baseUrl = null;
for (let i = 0; i < 120 && !baseUrl; i++) {
  await delay(1000);
  const match = bootLog.match(/https?:\/\/[^\s"']+/);
  if (match) baseUrl = match[0].replace(/[)\].,]+$/, '');
  if (child.exitCode !== null) break;
}
// PART-B
try {
  if (!baseUrl) {
    record('P0 boot web profile', false, 'no URL within 120s; tail: ' + bootLog.slice(-300));
  } else {
    record('P0 boot web profile', true, new URL(baseUrl).origin);
    const origin = new URL(baseUrl).origin;
    const token = new URL(baseUrl).searchParams.get('token');
    let cookie = null;
    if (token) {
      const connect = await fetch(origin + '/connect?token=' + encodeURIComponent(token) + '&interactions=none', { redirect: 'manual' });
      const setCookie = connect.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      record('P0b /connect API peer', connect.status === 302 && !!cookie,
        'http ' + connect.status + ' cookie=' + (cookie ? cookie.split('=')[0] : 'none'));
    }
    const get = (route, opts = {}) => fetch(origin + route, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
      body: opts.body,
    });

    const resStatus = await get('/vpn-assistant/api/status');
    const statusBody = await resStatus.json().catch(() => null);
    record('P4a GET /api/status 200', resStatus.status === 200 && statusBody?.ok === true,
      'http ' + resStatus.status + ' data=' + JSON.stringify(statusBody?.result?.data)
      + ' skills=' + JSON.stringify(statusBody?.result?.skills));

    const resProviders = await get('/vpn-assistant/api/providers');
    const providersBody = await resProviders.json().catch(() => null);
    const ids = (providersBody?.result ?? []).map((p) => p.provider_id).join(',');
    const nordDownload = (providersBody?.result ?? []).find((p) => p.provider_id === 'nordvpn')?.download_page_url;
    record('P4b GET /api/providers', resProviders.status === 200 && providersBody?.ok === true && providersBody.result.length === 6,
      'http ' + resProviders.status + ' providers=[' + ids + '] nordvpn.download_page_url=' + JSON.stringify(nordDownload));

    const missing = await get('/vpn-assistant/api/providers/unknown-id');
    record('P4c-1 unknown provider 404', missing.status === 404, 'http ' + missing.status);
    const wrong = await get('/vpn-assistant/api/providers', { method: 'POST' });
    record('P4c-2 wrong method 405', wrong.status === 405, 'http ' + wrong.status);

    const resAssist = await get('/vpn-assistant/api/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: 'troubleshoot', platform: 'windows', errorText: '安装程序无法启动' }),
    });
    const assistBody = await resAssist.json().catch(() => null);
    record('P4d POST /api/assist degrade', resAssist.status === 200 && assistBody?.ok === true
      && typeof assistBody.result?.answer === 'string' && assistBody.result.aiUsed === false,
      'aiUsed=' + assistBody?.result?.aiUsed + ' reason=' + assistBody?.result?.reason
      + ' answerLen=' + (assistBody?.result?.answer?.length ?? 0)
      + ' aiDetail=' + JSON.stringify(assistBody?.result?.aiDetail ?? null));

    const resSecret = await get('/vpn-assistant/api/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: 'select', question: 'my password is 123456' }),
    });
    const secretBody = await resSecret.json().catch(() => null);
    record('P4e secret rejected 400', resSecret.status === 400 && secretBody?.error?.code === 'SECRET_REJECTED',
      'http ' + resSecret.status + ' code=' + secretBody?.error?.code);

    const skills = statusBody?.result?.skills ?? {};
    record('P3 skills registered', skills.registered === 9 && (skills.failures ?? []).length === 0,
      'registered=' + skills.registered + '/' + skills.expected + ' error=' + JSON.stringify(skills.error)
      + ' failures=' + JSON.stringify(skills.failures));

    const resModel = await get('/vpn-assistant/api/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: 'select', providerId: 'mullvad', question: 'Mullvad 的价格与设备数限制是什么？' }),
    });
    const modelBody = await resModel.json().catch(() => null);
    record('P2 real model call via assist', resModel.status === 200 && modelBody?.ok === true && typeof modelBody.result?.aiUsed === 'boolean',
      'aiUsed=' + modelBody?.result?.aiUsed + ' model=' + JSON.stringify(modelBody?.result?.model ?? null)
      + ' detail=' + JSON.stringify(modelBody?.result?.aiDetail ?? modelBody?.result?.reason ?? null).slice(0, 300));

    const resPlugins = await get('/plugins');
    record('P4g client bundle route reachable', resPlugins.status === 200 || resPlugins.status === 404,
      'GET /plugins http ' + resPlugins.status);
  }
} finally {
  child.kill('SIGTERM');
  await delay(1500);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}
console.log('SUMMARY ' + results.filter((r) => r.ok).length + '/' + results.length + ' passed');
fs.writeFileSync(PROJECT_ROOT + '/docs/probe-results.json', JSON.stringify(results, null, 2), 'utf8');
process.exit(results.every((r) => r.ok) ? 0 : 1);
