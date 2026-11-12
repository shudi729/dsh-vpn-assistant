import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStore } from '../../src/host/store.js';
import { guardUrl, guardProvider, guardSoftware } from '../../src/host/linkguard.js';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

test('data files exist and pass structural validation', async () => {
  const store = new DataStore(DATA_DIR);
  const result = await store.validate();
  assert.equal(result.ok, true);
  assert.equal(result.providers, 6);
  assert.ok(result.software >= 30);
  assert.ok(result.tutorials >= 5);
});

test('every provider carries verification metadata', async () => {
  const store = new DataStore(DATA_DIR);
  const providers = await store.providers();
  for (const p of providers) {
    assert.ok(p.provider_id && p.name && p.official_website);
    assert.match(p.verified_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(p.sources) && p.sources.length >= 2, p.provider_id + ' needs sources');
    assert.equal(Array.isArray(p.unverified_fields), true);
    if (p.unverified_fields.length > 0) {
      assert.equal(p.verification_status, 'partial');
    }
  }
});

test('all URL fields are https and belong to official domains', async () => {
  const store = new DataStore(DATA_DIR);
  const [providers, software] = await Promise.all([store.providers(), store.software()]);
  const domainsByProvider = new Map(providers.map((p) => [p.provider_id, p.official_domains]));
  for (const p of providers) {
    const copy = JSON.parse(JSON.stringify(p));
    const { unverified } = guardProvider(copy);
    for (const field of ['official_website', 'privacy_policy_url', 'download_page_url']) {
      const value = copy[field];
      if (value) assert.match(value, /^https:/);
    }
    for (const source of p.sources ?? []) {
      if (source.url) {
        const guarded = guardUrl(source.url, p.official_domains);
        assert.ok(guarded, p.provider_id + ' source ' + source.url + ' outside official_domains');
      }
    }
    assert.ok(!unverified.includes('official_website'), p.provider_id);
  }
  for (const s of software) {
    if (s.official_download_url) {
      const guarded = guardUrl(s.official_download_url, domainsByProvider.get(s.provider_id) ?? []);
      assert.ok(guarded, s.software_id + ' download url outside whitelist');
    }
  }
});

test('no credential-like strings anywhere in data', async () => {
  const store = new DataStore(DATA_DIR);
  const files = ['meta.json', 'providers.json', 'software.json', 'tutorials.json'];
  const pattern = /(password|passwd|secret\s*[:=]|api[_-]?key\s*[:=]|subscription[-_ ]?key\s*[:=])/i;
  for (const file of files) {
    const raw = JSON.stringify(await (async () => {
      const store2 = new DataStore(DATA_DIR);
      if (file === 'meta.json') return store2.meta();
      if (file === 'providers.json') return store2.providers();
      if (file === 'software.json') return store2.software();
      return store2.tutorials();
    })());
    assert.doesNotMatch(raw, pattern, file + ' contains credential-like content');
  }
});

test('software/tutorials reference known providers (or platform-generic tutorials)', async () => {
  const store = new DataStore(DATA_DIR);
  const [providers, software, tutorials] = await Promise.all([store.providers(), store.software(), store.tutorials()]);
  const ids = new Set(providers.map((p) => p.provider_id));
  for (const s of software) assert.ok(ids.has(s.provider_id), s.software_id);
  for (const t of tutorials) {
    assert.ok(t.provider_id === null || ids.has(t.provider_id), t.tutorial_id);
    assert.ok(Array.isArray(t.steps) && t.steps.length >= 5, t.tutorial_id);
    assert.equal(t.authorship, 'assistant-generalized');
  }
});
