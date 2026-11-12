// Batch 3B unit tests: context protocol (host validator + client mirror
// parity), structured tool envelope, skill group mapping.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validateContext, CONTEXT_PAGES } from '../../src/host/context.js';
import { createTools } from '../../src/host/tools.js';
import { SKILL_GROUPS, resolveSkillGroup } from '../../src/host/skills.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL('../../data/' + name, import.meta.url), 'utf8'));
const providers = read('providers.json');
const software = read('software.json');
const tutorials = read('tutorials.json');

// ---- client mirror: load client.js in the same sandbox style as client-logic.test.js
function loadClientHook() {
  const code = fs.readFileSync(new URL('../../client.js', import.meta.url), 'utf8');
  const reactStub = {
    createElement: () => ({}), Fragment: 'Fragment',
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }),
  };
  const fakeWindow = { __ModuleLoader__: { load(def) { captured = def; } }, localStorage: { getItem: () => null, setItem: () => {} } };
  let captured = null;
  const sandboxRequire = (name) => { assert.equal(name, 'react'); return reactStub; };
  const context = { window: fakeWindow, require: sandboxRequire, console };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'client.js' });
  captured.factory(sandboxRequire);
  return fakeWindow.__VPN_ASSISTANT_TEST__;
}
const hook = loadClientHook();

describe('context protocol — host validator', () => {
  it('accepts a minimal valid context and normalizes defaults', () => {
    const c = validateContext({ version: 1, page: 'market' });
    assert.equal(c.page, 'market');
    assert.equal(c.source, 'vpn-assistant');
    assert.equal(c.version, 1);
    assert.equal(c.providerId, null);
    assert.equal(c.diagnostics, null);
  });
  it('rejects invalid page / version', () => {
    assert.throws(() => validateContext({ version: 1, page: 'nope' }), /page/);
    assert.throws(() => validateContext({ version: 2, page: 'market' }), /version/);
    assert.equal(CONTEXT_PAGES.length, 7);
  });
  it('providerId must exist in verified data', () => {
    const ok = validateContext({ version: 1, page: 'provider-detail', providerId: 'mullvad' }, { providers });
    assert.equal(ok.providerId, 'mullvad');
    assert.throws(() => validateContext({ version: 1, page: 'market', providerId: 'fake-vpn' }, { providers }), /未出现/);
  });
  it('softwareId must exist and match providerId; infers providerId', () => {
    const sw = software[0];
    const ok = validateContext({ version: 1, page: 'downloads', softwareId: sw.software_id }, { software });
    assert.equal(ok.providerId, sw.provider_id);
    assert.throws(() => validateContext({ version: 1, page: 'downloads', softwareId: 'nope' }, { providers, software }), /未出现/);
    assert.throws(() => validateContext({ version: 1, page: 'downloads', softwareId: sw.software_id, providerId: 'mullvad' }, { providers, software }), /同一服务商/);
  });
  it('platform enum and step range', () => {
    assert.throws(() => validateContext({ version: 1, page: 'wizard', platform: 'win95' }), /platform/);
    assert.throws(() => validateContext({ version: 1, page: 'wizard', step: 8 }), /step/);
    assert.throws(() => validateContext({ version: 1, page: 'wizard', step: 0 }), /step/);
    const ok = validateContext({ version: 1, page: 'wizard', platform: 'windows', step: 3 });
    assert.equal(ok.step, 3);
  });
  it('question length limit + secret rejection', () => {
    assert.throws(() => validateContext({ version: 1, page: 'market', question: 'x'.repeat(501) }), /500/);
    assert.throws(() => validateContext({ version: 1, page: 'market', question: 'my subscription-key is abc' }), /SECRET_REJECTED|凭据/);
    const ok = validateContext({ version: 1, page: 'market', question: '哪个适合公共 Wi-Fi？' });
    assert.equal(ok.question, '哪个适合公共 Wi-Fi？');
  });
  it('diagnostics rejected while whitelist is empty (3D reserved)', () => {
    assert.throws(() => validateContext({ version: 1, page: 'diagnostics', diagnostics: { os: 'win' } }), /DIAGNOSTICS_REJECTED|白名单/);
  });
  it('unknown fields are ignored (forward compat), null accepted', () => {
    const c = validateContext({ version: 1, page: 'market', futureField: { a: 1 }, providerId: null });
    assert.equal(c.providerId, null);
    assert.equal('futureField' in c, false);
  });
  it('null context passes through (no context = legacy behavior)', () => {
    assert.equal(validateContext(null), null);
    assert.equal(validateContext(undefined), null);
  });
});

describe('context protocol — client mirror parity', () => {
  const structural = [
    { version: 1, page: 'market' },
    { version: 1, page: 'nope' },
    { version: 2, page: 'market' },
    { version: 1, page: 'wizard', platform: 'windows', step: 4 },
    { version: 1, page: 'wizard', platform: 'win95' },
    { version: 1, page: 'wizard', step: 9 },
    { version: 1, page: 'market', question: '公共 Wi-Fi 用哪个？' },
    { version: 1, page: 'market', question: 'x'.repeat(501) },
    { version: 1, page: 'market', question: 'my password is 123' },
    { version: 1, page: 'diagnostics', diagnostics: {} },
    { version: 1, page: 'market', providerId: null },
  ];
  for (const [i, fixture] of structural.entries()) {
    it('case ' + i + ' — host and client agree (accept/reject)', () => {
      let hostOk, clientOk, hostErr, clientErr;
      try { validateContext(JSON.parse(JSON.stringify(fixture))); hostOk = true; } catch (e) { hostOk = false; hostErr = e.code ?? e.message; }
      try { hook.validateContextClient(JSON.parse(JSON.stringify(fixture))); clientOk = true; } catch (e) { clientOk = false; clientErr = e.message; }
      assert.equal(hostOk, clientOk, 'parity mismatch: host=' + hostErr + ' client=' + clientErr);
      if (!hostOk) {
        assert.ok(SECRETISH(hostErr) === SECRETISH(clientErr), 'both must flag secrets identically');
      }
    });
  }
  function SECRETISH(v) { return /SECRET|凭据/.test(String(v)) ? 'secret' : 'normal'; }
  it('buildPageContext produces a host-valid context', () => {
    const built = hook.buildPageContext('wizard', { step: 5, providerId: 'mullvad', platform: 'macos' });
    const validated = validateContext(built, { providers });
    assert.equal(validated.page, 'wizard');
    assert.equal(validated.step, 5);
  });
  it('selector handover question embeds needs, results and exclusions, ≤480 chars', () => {
    const criteria = { device: 'windows', purpose: 'privacy', budget: 'usd12', deviceCount: 2, preferences: ['audited'], region: 'any' };
    const report = { results: [{ name: 'Proton VPN', score: 96, credibility: { value: 100 } }], excluded: [{ name: 'NordVPN', reason: '支持平台待核实' }] };
    const q = hook.selectorContextQuestion(criteria, report);
    assert.ok(q.length <= 480);
    assert.match(q, /设备=windows/);
    assert.match(q, /Proton VPN（96 分/);
    assert.match(q, /NordVPN（支持平台待核实）/);
  });
});

describe('structured tools envelope', () => {
  const tools = createTools({ store: {
    providers: async () => providers, software: async () => software, tutorials: async () => tutorials,
  } });

  it('exposes exactly the 9 canonical tools', () => {
    assert.deepEqual(tools.names, ['get_provider', 'get_pricing', 'get_platform_support', 'get_download', 'get_tutorial', 'compare_providers', 'recommend_provider', 'get_wizard_step', 'troubleshoot']);
  });
  it('every success envelope has the unified shape with sources & verification', async () => {
    for (const [name, args] of [
      ['get_provider', { providerId: 'mullvad' }],
      ['get_pricing', { providerId: 'mullvad' }],
      ['get_platform_support', { providerId: 'proton-vpn' }],
      ['get_download', { platform: 'windows' }],
      ['get_tutorial', { platform: 'windows' }],
      ['compare_providers', { providerIds: ['mullvad', 'proton-vpn'] }],
      ['recommend_provider', { criteria: { budget: 'free' } }],
      ['get_wizard_step', { step: 3 }],
      ['troubleshoot', { errorText: '安装程序无法启动' }],
    ]) {
      const out = await tools.run(name, args);
      assert.deepEqual(Object.keys(out).sort(), ['data', 'error', 'sources', 'success', 'verification'], name);
      assert.equal(out.success, true, name);
      assert.ok(Array.isArray(out.sources) && out.sources.length >= 1, name + ' has sources');
      assert.ok(['verified', 'partial', 'unverified'].includes(out.verification), name + ' verification flag');
      assert.equal(out.error, null);
    }
  });
  it('pending data is never marked verified', async () => {
    const out = await tools.run('get_pricing', { providerId: 'ivpn' });
    assert.equal(out.verification, 'unverified', 'ivpn pricing is pending');
    const nord = await tools.run('get_platform_support', { providerId: 'nordvpn' });
    assert.equal(nord.verification, 'unverified', 'nordvpn platforms pending');
  });
  it('errors use the envelope, not exceptions', async () => {
    const out = await tools.run('get_provider', { providerId: 'fake' });
    assert.equal(out.success, false);
    assert.equal(out.error.code, 'NOT_FOUND');
    const bad = await tools.run('nonexistent', {});
    assert.equal(bad.error.code, 'UNKNOWN_TOOL');
    const cmp = await tools.run('compare_providers', { providerIds: ['mullvad'] });
    assert.equal(cmp.error.code, 'INVALID_INPUT');
  });
  it('recommend_provider tool reuses the 3A engine (deterministic)', async () => {
    const a = await tools.run('recommend_provider', { criteria: { budget: 'free' } });
    const b = await tools.run('recommend_provider', { criteria: { budget: 'free' } });
    assert.deepEqual(a.data, b.data);
    assert.equal(a.data.meta.engine, 'rule-v1');
  });
});

describe('skill group mapping (9 registered skills → 4 groups)', () => {
  const registered = ['vpn-provider-lookup', 'vpn-compare', 'vpn-platform-compat', 'vpn-download-verify', 'vpn-install-windows', 'vpn-install-macos', 'vpn-install-android', 'vpn-install-ios', 'vpn-troubleshoot'];
  it('all 9 registered skills are mapped exactly once', () => {
    const mapped = Object.values(SKILL_GROUPS).flatMap((g) => g.skills);
    assert.equal(mapped.length, 9);
    assert.deepEqual([...mapped].sort(), [...registered].sort());
  });
  it('exactly 4 groups with labels', () => {
    assert.equal(Object.keys(SKILL_GROUPS).length, 4);
    for (const g of Object.values(SKILL_GROUPS)) assert.ok(g.label && g.skills.length >= 1);
  });
  it('resolver maps intent/page → group', () => {
    assert.equal(resolveSkillGroup('select', null).key, 'vpn-selection');
    assert.equal(resolveSkillGroup(null, { page: 'selector' }).key, 'vpn-selection');
    assert.equal(resolveSkillGroup('install-guide', null).key, 'vpn-install');
    assert.equal(resolveSkillGroup(null, { page: 'wizard' }).key, 'vpn-install');
    assert.equal(resolveSkillGroup('troubleshoot', null).key, 'vpn-troubleshoot');
    assert.equal(resolveSkillGroup(null, { page: 'provider-detail' }).key, 'vpn-selection');
    assert.equal(resolveSkillGroup(null, { page: 'overview' }).key, 'vpn-data');
  });
});
