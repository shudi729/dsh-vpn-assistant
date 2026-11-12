// Unit tests for client.js pure logic via the browser test hook.
// We stub window.__ModuleLoader__ and require('react') to capture the factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const code = fs.readFileSync(path.join(root, 'client.js'), 'utf8');

const reactStub = {
  createElement: () => ({}),
  Fragment: 'Fragment',
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};
let captured = null;
const fakeWindow = {
  __ModuleLoader__: { load(def) { captured = def; } },
  localStorage: { getItem: () => null, setItem: () => {} },
};

const context = { window: fakeWindow, require: (name) => { assert.equal(name, 'react'); return reactStub; }, console };
vm.createContext(context);
vm.runInContext(code, context, { filename: 'client.js' });
const exported = captured.factory(context.require);

test('client.js factory registers under the verified ModuleLoader contract', () => {
  assert.ok(captured, 'ModuleLoader.load captured');
  assert.equal(captured.id, 'dsh-vpn-assistant');
  assert.equal(exported.inject.length, 2);
  assert.equal(exported.inject[0], 'slots');
  assert.equal(exported.inject[1], 'locale');
  assert.equal(typeof exported.apply, 'function');
});

const hook = fakeWindow.__VPN_ASSISTANT_TEST__;
test('test hook exposes pure helpers', () => {
  assert.ok(hook, 'window.__VPN_ASSISTANT_TEST__ set');
  assert.equal(typeof hook.filterProviders, 'function');
  assert.equal(hook.PLATFORMS.join(','), 'windows,macos,android,ios,linux');
  assert.equal(hook.WIZARD_STEPS.length, 7);
  assert.equal(hook.WIZARD_STEPS[3].tutorialSteps.join(','), 's2,s3');
});

const providers = [
  { provider_id: 'nordvpn', name: 'NordVPN', introduction: 'x', operator: 'Nord Security', supported_platforms: ['windows', 'macos'], price_tier: 'paid', categories: ['general'] },
  { provider_id: 'ivpn', name: 'IVPN', introduction: 'y', operator: 'IVPN Ltd', supported_platforms: ['windows', 'macos', 'linux'], price_tier: 'paid', categories: ['privacy'] },
  { provider_id: 'proton-vpn', name: 'Proton VPN', introduction: 'z', operator: 'Proton AG', supported_platforms: ['windows', 'macos', 'linux', 'android', 'ios'], price_tier: 'freemium', categories: ['privacy', 'general'] },
];

test('filterProviders: query matches name/introduction/operator case-insensitively', () => {
  assert.deepEqual(hook.filterProviders(providers, { query: 'proton' }).map((p) => p.provider_id), ['proton-vpn']);
  assert.deepEqual(hook.filterProviders(providers, { query: 'NORD SECURITY' }).map((p) => p.provider_id), ['nordvpn']);
});

test('filterProviders: platform filter is an AND over selected platforms', () => {
  const both = hook.filterProviders(providers, { platforms: ['windows', 'linux'] });
  assert.deepEqual(both.map((p) => p.provider_id), ['ivpn', 'proton-vpn']);
});

test('filterProviders: price and category filters', () => {
  assert.deepEqual(hook.filterProviders(providers, { price: 'freemium' }).map((p) => p.provider_id), ['proton-vpn']);
  assert.deepEqual(hook.filterProviders(providers, { category: 'privacy' }).map((p) => p.provider_id), ['ivpn', 'proton-vpn']);
});

test('filterProviders: result is always alphabetical (no ranking)', () => {
  const names = hook.filterProviders(providers, {}).map((p) => p.name);
  assert.deepEqual(names, ['IVPN', 'NordVPN', 'Proton VPN']);
});

test('lowestPlan/formatPrice handle free, priced and missing plans', () => {
  const proton = { pricing_plans: [
    { plan_id: 'free', price: 0, currency: 'USD', period: 'month' },
    { plan_id: 'plus', price: 2.99, currency: 'USD', period: 'month' },
    { plan_id: 'unlimited', price: 6.49, currency: 'USD', period: 'month' },
  ] };
  assert.equal(hook.formatPrice(hook.lowestPlan(proton), 'zh'), '免费');
  const paid = { pricing_plans: [{ price: 6.49, currency: 'USD', period: 'month' }, { price: 2.99, currency: 'USD', period: 'month' }] };
  assert.equal(hook.formatPrice(hook.lowestPlan(paid), 'zh'), 'USD 2.99/月');
  assert.equal(hook.formatPrice(hook.lowestPlan(paid), 'en'), 'USD 2.99/mo');
  assert.equal(hook.formatPrice(null, 'zh'), null);
  assert.equal(hook.lowestPlan({ pricing_plans: [] }), null);
});

test('tutorialFor/tutorialStep resolve platform tutorials and wizard step mapping', () => {
  const tutorials = [{ platform: 'windows', steps: [{ step_id: 's1', name: 'a' }, { step_id: 's2', name: 'b' }] }];
  const found = hook.tutorialFor(tutorials, 'windows');
  assert.equal(found.steps.length, 2);
  assert.equal(hook.tutorialFor(tutorials, 'macos'), null);
  assert.equal(hook.tutorialStep(found, 's2').name, 'b');
  assert.equal(hook.tutorialStep(found, 's9'), null);
});
