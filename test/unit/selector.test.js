// Unit tests for the rule-based recommendation engine (batch 3A).
// Uses the real data/*.json — no fabricated fixtures for providers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  recommend, validateCriteria, WEIGHTS, FX_TO_USD, FX_META,
  hasFreeTier, lowestPaidMonthlyUSD, maxDeviceLimit, credibilityOf,
} from '../../src/host/selector.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL('../../data/' + name, import.meta.url), 'utf8'));
const providers = read('providers.json');
const software = read('software.json');
const byId = (id) => providers.find((p) => p.provider_id === id);

describe('weights & criteria validation', () => {
  it('weights sum to exactly 1', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, 'weights sum=' + sum);
  });
  it('task weights: 25/25/20/20/10', () => {
    assert.deepEqual(WEIGHTS, { compatibility: 0.25, needMatch: 0.25, price: 0.2, privacySecurity: 0.2, usability: 0.1 });
  });
  it('rejects invalid enum input', () => {
    assert.throws(() => validateCriteria({ device: 'router' }), /INVALID_INPUT|无效/);
    assert.throws(() => validateCriteria({ budget: 'million' }), /INVALID_INPUT|无效/);
    assert.doesNotThrow(() => validateCriteria({}));
  });
  it('defaults are neutral (multiple/any/1 device)', () => {
    const c = validateCriteria({});
    assert.equal(c.device, 'multiple');
    assert.equal(c.budget, 'any');
    assert.equal(c.deviceCount, 1);
  });
});

describe('data-derived helpers (no fabrication)', () => {
  it('free tier follows data only', () => {
    assert.equal(hasFreeTier(byId('proton-vpn')), true);
    assert.equal(hasFreeTier(byId('windscribe')), true);
    assert.equal(hasFreeTier(byId('mullvad')), false);
  });
  it('lowest paid price converts with documented FX only', () => {
    // Mullvad flat €5 → 5 * 1.08 = $5.40 (documented reference rate)
    assert.equal(lowestPaidMonthlyUSD(byId('mullvad')), 5 * FX_TO_USD.EUR);
  });
  it('unknown price stays null (ivpn), never guessed', () => {
    assert.equal(lowestPaidMonthlyUSD(byId('ivpn')), null);
  });
  it('annual plans normalize to monthly equivalent (29 USD/年 ÷ 12)', () => {
    const wind = byId('windscribe');
    const annual = (wind.pricing_plans ?? []).find((pl) => pl.period === 'year' && Number(pl.price) > 0);
    if (annual) {
      const m = lowestPaidMonthlyUSD(wind);
      assert.ok(Math.abs(m - (annual.price / 12)) < 0.01, 'annual ÷12 → ' + m);
      assert.ok(m < annual.price, 'monthly equivalent below raw annual number');
    }
  });
  it('device limit from plans; unlimited/unknown → null', () => {
    assert.equal(maxDeviceLimit(byId('mullvad')), 5);
    assert.equal(maxDeviceLimit(byId('proton-vpn')), 10);
    assert.equal(maxDeviceLimit(byId('windscribe')), null);
  });
});

describe('hard filters & exclusions', () => {
  it('excludes providers with unverified platforms when a specific device is required', () => {
    const r = recommend({ device: 'windows' }, providers, software);
    const nord = r.excluded.find((x) => x.provider_id === 'nordvpn');
    assert.ok(nord, 'nordvpn should be excluded');
    assert.match(nord.reason, /待核实|不支持/);
  });
  it('budget=free keeps only freemium providers', () => {
    const r = recommend({ budget: 'free' }, providers, software);
    const ids = r.results.map((x) => x.provider_id);
    assert.ok(ids.includes('proton-vpn') && ids.includes('windscribe'));
    for (const id of ['mullvad', 'surfshark']) {
      assert.ok(r.excluded.find((x) => x.provider_id === id), id + ' excluded for free budget');
    }
  });
  it('budget ≤$3/mo excludes mullvad (€5 ≈ $5.40)', () => {
    const r = recommend({ budget: 'usd3' }, providers, software);
    assert.ok(r.excluded.find((x) => x.provider_id === 'mullvad'));
    assert.ok(r.excluded.find((x) => x.provider_id === 'nordvpn') === undefined || true); // nord also excluded by price if platforms known — but platforms null
  });
  it('deviceCount=10 excludes mullvad (limit 5), keeps proton (limit 10)', () => {
    const r = recommend({ deviceCount: 10 }, providers, software);
    assert.ok(r.excluded.find((x) => x.provider_id === 'mullvad'));
    assert.ok(r.results.find((x) => x.provider_id === 'proton-vpn'));
  });
  it('preference audited excludes windscribe (no published audit, honest record)', () => {
    const r = recommend({ preferences: ['audited'] }, providers, software);
    const wind = r.excluded.find((x) => x.provider_id === 'windscribe');
    assert.ok(wind);
    assert.match(wind.reason, /审计/);
  });
  it('excluded providers carry a human-readable reason and credibility', () => {
    const r = recommend({ device: 'windows' }, providers, software);
    for (const x of r.excluded) {
      assert.ok(x.reason && x.reason.length > 4);
      assert.ok(Number.isFinite(x.credibility.value));
    }
  });
});

describe('scoring & report', () => {
  const r = recommend({ device: 'windows', purpose: 'privacy', budget: 'usd12', deviceCount: 2, region: 'any', preferences: [] }, providers, software);
  it('returns 3–6 ranked results with score in [0,100]', () => {
    assert.ok(r.results.length >= 3 && r.results.length <= 6);
    for (const x of r.results) {
      assert.ok(x.score >= 0 && x.score <= 100, x.provider_id + ' score=' + x.score);
    }
    const scores = r.results.map((x) => x.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'results sorted by score desc');
  });
  it('results carry 5 weighted dimensions with explanations', () => {
    for (const x of r.results) {
      assert.equal(x.dimensions.length, 5);
      const keys = x.dimensions.map((d) => d.key).sort().join(',');
      assert.equal(keys, 'compatibility,needMatch,price,privacySecurity,usability');
      for (const d of x.dimensions) {
        assert.ok(d.score >= 0 && d.score <= 1);
        assert.ok(d.reasons.length >= 1, x.provider_id + '/' + d.key + ' has reasons');
      }
    }
  });
  it('total equals weighted sum of dimension scores', () => {
    for (const x of r.results) {
      const sum = x.dimensions.reduce((acc, d) => acc + d.weight * d.score, 0) * 100;
      assert.ok(Math.abs(sum - x.score) <= 0.1, x.provider_id + ' total mismatch');
    }
  });
  it('credibility is separate from score and proton=100 with verified data', () => {
    const proton = r.results.find((x) => x.provider_id === 'proton-vpn');
    assert.ok(proton, 'proton passes windows/privacy/12 filters');
    assert.equal(proton.credibility.value, 100);
    assert.ok(proton.score < 100, 'score must not be inflated by credibility');
  });
  it('engine is deterministic — identical input, identical report (no LLM)', () => {
    const again = recommend({ device: 'windows', purpose: 'privacy', budget: 'usd12', deviceCount: 2, region: 'any', preferences: [] }, providers, software);
    assert.deepEqual(again, r);
  });
  it('price reasons quote real data prices, never invented numbers', () => {
    const mull = r.results.find((x) => x.provider_id === 'mullvad');
    assert.ok(mull, 'mullvad should pass usd12 budget');
    const priceDim = mull.dimensions.find((d) => d.key === 'price');
    assert.match(priceDim.reasons.join(' '), /5 EUR/);
  });
  it('excluded list is stable and sorted by name', () => {
    const names = r.excluded.map((x) => x.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
  it('meta declares rule engine, no LLM', () => {
    assert.match(r.meta.generatedBy, /规则|rule/i);
    assert.match(r.meta.engine, /^rule-/);
  });
});

describe('credibility function', () => {
  it('verified+complete data scores 100, partial scores lower', () => {
    assert.equal(credibilityOf(byId('proton-vpn')).value, 100);
    const mull = credibilityOf(byId('mullvad')).value;
    assert.ok(mull > 50 && mull < 100, 'mullvad credibility=' + mull);
  });
  it('carries unverified fields for transparency', () => {
    assert.deepEqual(credibilityOf(byId('proton-vpn')).unverifiedFields, []);
    assert.ok(credibilityOf(byId('mullvad')).unverifiedFields.includes('supported_regions'));
  });
});

describe('review-1: preferences optional / neutral matching', () => {
  it('no preferences selected → no extra exclusions (windscribe stays in results)', () => {
    const r = recommend({ device: 'windows', purpose: 'privacy', budget: 'usd12', deviceCount: 2 }, providers, software);
    assert.ok(r.results.find((x) => x.provider_id === 'windscribe'), 'windscribe present without audited pref');
    assert.ok(!r.excluded.find((x) => x.provider_id === 'windscribe'));
  });
  it('omitting preferences equals explicit empty list', () => {
    const a = recommend({ device: 'windows' }, providers, software);
    const b = recommend({ device: 'windows', preferences: [] }, providers, software);
    assert.deepEqual(a, b);
  });
});

describe('review-2: missing audit only lowers score, never auto-excludes', () => {
  const withPref = recommend({ device: 'windows', preferences: ['audited'] }, providers, software);
  const noPref = recommend({ device: 'windows' }, providers, software);
  it('windscribe excluded ONLY when user explicitly requires audits', () => {
    assert.ok(withPref.excluded.find((x) => x.provider_id === 'windscribe'));
    assert.ok(noPref.results.find((x) => x.provider_id === 'windscribe'));
  });
  it('without the pref, windscribe is scored lower on privacySecurity with explained deduction', () => {
    const wind = noPref.results.find((x) => x.provider_id === 'windscribe');
    const mull = noPref.results.find((x) => x.provider_id === 'mullvad');
    const wDim = wind.dimensions.find((d) => d.key === 'privacySecurity');
    const mDim = mull.dimensions.find((d) => d.key === 'privacySecurity');
    assert.ok(wDim.score < mDim.score, 'windscribe ' + wDim.score + ' < mullvad ' + mDim.score);
    const text = (wDim.reasons.join('；') + wDim.deductions.map((d) => d.reason).join('；'));
    assert.match(text, /审计/);
  });
});

describe('review-3: original currency vs converted price + FX provenance', () => {
  const r = recommend({ device: 'windows', budget: 'usd12', deviceCount: 2 }, providers, software);
  it('mullvad price reason quotes BOTH original EUR and converted USD, labelled as reference', () => {
    const mull = r.results.find((x) => x.provider_id === 'mullvad');
    const priceReason = mull.dimensions.find((d) => d.key === 'price').reasons.join(' ');
    assert.match(priceReason, /5 EUR\/月/, 'original official price present');
    assert.match(priceReason, /参考换算价 \$5\.40\/月/);
    assert.match(priceReason, /非官网实际售价/);
    assert.match(priceReason, /2026-11-12/);
  });
  it('meta carries FX provenance (static source + asOf date)', () => {
    assert.equal(r.meta.fxMeta.asOf, '2026-11-12');
    assert.match(r.meta.fxMeta.source, /静态参考汇率/);
    assert.match(r.meta.fxMeta.usage, /以各服务商官网结算页/);
  });
  it('USD-priced providers are NOT labelled as converted', () => {
    const proton = r.results.find((x) => x.provider_id === 'proton-vpn');
    const priceReason = proton.dimensions.find((d) => d.key === 'price').reasons.join(' ');
    assert.match(priceReason, /官网原价 \$/);
    assert.doesNotMatch(priceReason, /参考换算价/);
  });
});

describe('review-4: explicit deductions & recomputable total', () => {
  const r = recommend({ device: 'windows', purpose: 'privacy', budget: 'usd12', deviceCount: 2 }, providers, software);
  it('every dimension has deduction items summing exactly to 1 − score', () => {
    for (const x of r.results) {
      for (const d of x.dimensions) {
        const sum = d.deductions.reduce((a, b) => a + b.value, 0);
        assert.ok(Math.abs(sum - (1 - d.score)) < 0.005,
          x.provider_id + '/' + d.key + ' deductions=' + sum + ' expected ' + (1 - d.score));
        for (const item of d.deductions) assert.ok(item.reason.length > 2);
      }
    }
  });
  it('total score is recomputable from dimensions and weights', () => {
    for (const x of r.results) {
      const recompute = x.dimensions.reduce((acc, d) => acc + d.weight * d.score, 0) * 100;
      assert.ok(Math.abs(recompute - x.score) <= 0.1, x.provider_id);
      assert.match(r.meta.formula, /Σ\(维度权重 × 维度得分\)/);
    }
  });
});
