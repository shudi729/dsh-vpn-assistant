import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardUrl, guardProvider, guardSoftware } from '../../src/host/linkguard.js';

test('guardUrl allows https urls on whitelist domains incl. subdomains', () => {
  const domains = ['protonvpn.com', 'proton.me'];
  assert.equal(guardUrl('https://protonvpn.com/pricing', domains), 'https://protonvpn.com/pricing');
  assert.equal(guardUrl('https://account.proton.me/vpn', domains), 'https://account.proton.me/vpn');
  assert.equal(guardUrl('https://evil-protonvpn.com/x', domains), null);
  assert.equal(guardUrl('http://protonvpn.com/x', domains), null);
  assert.equal(guardUrl('https://example.com/x', domains), null);
  assert.equal(guardUrl('not a url', domains), null);
  assert.equal(guardUrl(null, domains), null);
});

test('guardProvider nulls non-whitelisted urls', () => {
  const provider = {
    official_domains: ['mullvad.net'],
    official_website: 'https://mullvad.net',
    privacy_policy_url: 'https://tracker.example/policy',
    download_page_url: 'https://mullvad.net/download',
    pricing_plans: [{ source_url: 'https://ads.example/pricing' }],
    security_information: { audits: [{ url: 'https://mullvad.net/download' }] },
  };
  const { unverified } = guardProvider(provider);
  assert.equal(provider.privacy_policy_url, null);
  assert.equal(provider.pricing_plans[0].source_url, null);
  assert.equal(provider.download_page_url, 'https://mullvad.net/download');
  assert.deepEqual(unverified, ['privacy_policy_url', 'pricing_plans.source_url']);
});

test('guardSoftware inherits provider domains', () => {
  const software = { official_download_url: 'https://surfshark.com/download/android', source: 'https://other.example/x' };
  const { unverified } = guardSoftware(software, ['surfshark.com']);
  assert.equal(software.official_download_url, 'https://surfshark.com/download/android');
  assert.equal(software.source, null);
  assert.deepEqual(unverified, ['source']);
});
