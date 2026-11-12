import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHelperService, invokeHelper } from '../../src/host/helper.js';
import { normalizeClients, diagnostics } from '../../src/helper/detect.js';
test('helper requires authenticated session and consent scoped to operation', async () => {
  const service = createHelperService(async action => ({ action }));
  const req = { headers: { cookie: 'session=A' } };
  await assert.rejects(service.request({ headers: {} }, { action: 'grant', scopes: ['device'] }), /会话/);
  await assert.rejects(service.request(req, { action: 'device' }), /授权/);
  await service.request(req, { action: 'grant', scopes: ['device'] });
  assert.equal((await service.request(req, { action: 'device' })).action, 'device');
  await assert.rejects(service.request(req, { action: 'diagnostics' }), /授权/);
  await assert.rejects(service.request({ headers: { cookie: 'session=B' } }, { action: 'device' }), /授权/);
  await service.request(req, { action: 'revoke' });
  await assert.rejects(service.request(req, { action: 'device' }), /授权/);
  assert.equal(service.audit().some(x => JSON.stringify(x).includes('session=')), false);
  service.dispose(); assert.equal(service.audit().length, 0);
});
test('helper rejects arbitrary actions, extra fields and unapproved targets', async () => {
  const service = createHelperService(async () => assert.fail('must not execute'));
  const req = { headers: { cookie: 'session=A' } };
  await assert.rejects(service.request(req, { action: 'grant', scopes: ['exec'] }), /范围/);
  await assert.rejects(service.request(req, { action: 'device', command: 'whoami' }), /字段/);
  await service.request(req, { action: 'grant', scopes: ['diagnostics'] });
  await assert.rejects(service.request(req, { action: 'diagnostics', target: '127.0.0.1' }), /白名单/);
  await assert.rejects(diagnostics('example.com; whoami'), /白名单/);
});
test('concurrent scans rejected and revocation discards running result', async () => {
  let finish; const service = createHelperService(() => new Promise(r => { finish = r; }));
  const req = { headers: { cookie: 'session=A' } };
  await service.request(req, { action: 'grant', scopes: ['device'] });
  const pending = service.request(req, { action: 'device' });
  await assert.rejects(service.request(req, { action: 'device' }), /正在进行/);
  await service.request(req, { action: 'revoke' }); finish({});
  await assert.rejects(pending, /REVOKED/);
});
test('client detection normalizes real registry fields without connection claims', () => {
  const result = normalizeClients([{ DisplayName: 'Mullvad VPN', DisplayVersion: '2026.5' }, { DisplayName: 'Unrelated' }], ['mullvad-daemon']);
  assert.equal(result.length, 1); assert.equal(result[0].running, true);
  assert.equal(result[0].version, '2026.5'); assert.equal(result[0].connection, 'unknown');
});
test('independent helper rejects incorrect IPC identity', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/helper/cli.js', import.meta.url))], { env: { ...process.env, VP_HELPER_NONCE: 'expected' }, windowsHide: true });
  let output = ''; child.stdout.on('data', d => { output += d; });
  child.stdin.end(JSON.stringify({ version: 1, nonce: 'wrong', action: 'device' }) + '\n');
  await new Promise(r => child.on('close', r));
  assert.equal(JSON.parse(output).error.code, 'UNAUTHORIZED');
});
test('real helper reads actual OS, returns explicit client detection status', async () => {
  const result = await invokeHelper('device');
  assert.equal(result.system.platform, process.platform);
  assert.equal(result.system.architecture, process.arch);
  assert.ok(Date.parse(result.detectedAt));
  assert.ok(['completed', 'error', 'unsupported'].includes(result.clientDetection));
  assert.equal('hostname' in result.system, false);
});
