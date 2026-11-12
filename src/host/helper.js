import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../helper/detect.js';
export { TARGETS };
export function invokeHelper(action, target, signal) {
  return new Promise((resolve, reject) => {
    const nonce = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, [fileURLToPath(new URL('../helper/cli.js', import.meta.url))], {
      env: Object.fromEntries(Object.entries({ SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, VP_HELPER_NONCE: nonce }).filter(([,v]) => v !== undefined)), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    let output = ''; let settled = false;
    const aborted = () => done(new Error('AUTHORIZATION_REVOKED'));
    const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); child.kill(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => done(new Error('HELPER_TIMEOUT')), 16000);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    child.on('error', e => done(e)); child.stdin.on('error', e => done(e));
    child.stdout.on('data', data => { output += data; if (output.length > 512 * 1024) done(new Error('HELPER_OUTPUT_LIMIT')); });
    child.on('close', () => {
      try { const value = JSON.parse(output); if (!value.ok || value.version !== 1) throw new Error(value.error?.code || 'HELPER_VERSION'); done(null, value.result); }
      catch (e) { done(e); }
    });
    child.stdin.end(JSON.stringify({ version: 1, nonce, action, target }) + '\n');
  });
}
export function createHelperService(run = invokeHelper) {
  const grants = new Map(); const audit = []; let busy = false; let current = null;
  const identity = req => createHash('sha256').update(String(req.headers.cookie || '')).digest('hex');
  const log = (action, status) => { audit.push({ at: new Date().toISOString(), action, status }); if (audit.length > 100) audit.shift(); };
  return {
    async request(req, body) {
      if (!req.headers.cookie) throw Object.assign(new Error('需要 DSH 已认证浏览器会话'), { code: 'FORBIDDEN' });
      if (!body || Array.isArray(body) || Object.keys(body).some(k => !['action', 'scopes', 'target'].includes(k))) throw Object.assign(new Error('未知请求字段'), { code: 'INVALID_INPUT' });
      const id = identity(req); const action = body.action;
      if (action === 'grant') {
        if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.some(s => !['device', 'diagnostics'].includes(s))) throw Object.assign(new Error('授权范围无效'), { code: 'INVALID_INPUT' });
        if (grants.size >= 1000) grants.clear();
        grants.set(id, { scopes: body.scopes, expires: Date.now() + 10 * 60 * 1000 }); log(action, 'granted');
        return { authorized: true, expiresInSeconds: 600 };
      }
      if (action === 'revoke') { grants.delete(id); if (current?.id === id) current.controller.abort(); log(action, 'revoked'); return { authorized: false }; }
      const grant = grants.get(id);
      if (!grant || grant.expires < Date.now() || !grant.scopes.includes(action)) { log(String(action).slice(0, 20), 'denied'); throw Object.assign(new Error('请先主动授权；授权有效期十分钟'), { code: 'FORBIDDEN' }); }
      if (!['device', 'diagnostics'].includes(action) || (body.target !== undefined && !TARGETS.includes(body.target))) throw Object.assign(new Error('操作或目标不在白名单'), { code: 'INVALID_INPUT' });
      if (busy) throw Object.assign(new Error('检测正在进行，请稍后重试'), { code: 'BUSY' });
      busy = true;
      current = { id, controller: new AbortController() };
      try { const result = await run(action, body.target, current.controller.signal); if (grants.get(id) !== grant) throw new Error('AUTHORIZATION_REVOKED'); log(action, 'completed'); return result; }
      catch(e) { log(action, 'error'); throw e; } finally { busy = false; current = null; }
    },
    dispose() { current?.controller.abort(); grants.clear(); audit.length = 0; },
    audit: () => audit.slice(),
  };
}
