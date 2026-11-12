import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { registerRoutes } from '../../src/host/routes.js';
test('real HTTP helper origin fence, consent, bounded illustration routes and teardown', async () => {
  let handler; let removed = false;
  const dispose = registerRoutes({ ctx: { get: () => null, webServer: { register: r => { handler = r.handler; return () => { removed = true; }; } } } });
  const server = http.createServer((req,res) => handler(req,res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (body, headers = {}) => fetch(origin + '/vpn-assistant/api/helper', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session=test', origin, ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ action: 'grant', scopes: ['device'] }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ action: 'grant', scopes: ['device'] }, { origin: '' })).status, 403);
    assert.equal((await post({ action: 'device' })).status, 403);
    assert.equal((await post({ action: 'grant', scopes: ['device'] })).status, 200);
    assert.equal((await post({ action: 'device', shell: 'dir' })).status, 400);
    assert.equal((await post({ action: 'revoke' })).status, 200);
    assert.equal((await post({ action: 'device' })).status, 403);
    for (const id of ['windows-install','macos-install','android-install','ios-install','download-failed','install-failed','client-missing','config-error']) {
      const r = await fetch(origin + '/vpn-assistant/api/illustrations/' + id + '.svg');
      assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /svg/); assert.match(await r.text(), /<title/);
    }
    assert.equal((await fetch(origin + '/vpn-assistant/api/illustrations/unknown.svg')).status, 404);
    dispose(); assert.equal(removed, true);
  } finally { dispose(); await new Promise(r => server.close(r)); }
});
