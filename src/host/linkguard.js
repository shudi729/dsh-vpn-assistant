/**
 * Link guard: every URL that will render as a link/button must belong to the
 * record's own official domains (https only). Non-conforming URLs are nulled
 * at the data layer so the client can never render an unverified link.
 */

function hostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function domainMatches(hostname, domains) {
  if (!hostname) return false;
  const list = Array.isArray(domains) ? domains : [];
  for (const raw of list) {
    const domain = String(raw ?? '').toLowerCase().replace(/^\./, '');
    if (!domain) continue;
    if (hostname === domain) return true;
    if (hostname.endsWith('.' + domain)) return true;
  }
  return false;
}

/**
 * Return the URL when it passes the whitelist, otherwise null.
 */
export function guardUrl(url, domains) {
  if (typeof url !== 'string' || !url) return null;
  const host = hostOf(url);
  if (!host) return null;
  return domainMatches(host, domains) ? url : null;
}

/**
 * Guard a provider record in place: null every URL field that is not on the
 * record's official_domains list, and collect the nulled field names.
 */
export function guardProvider(provider) {
  const domains = provider?.official_domains ?? [];
  const unverified = [];
  const check = (field, value) => {
    const guarded = guardUrl(value, domains);
    if (value && !guarded) unverified.push(field);
    return guarded;
  };
  provider.official_website = check('official_website', provider.official_website);
  provider.privacy_policy_url = check('privacy_policy_url', provider.privacy_policy_url);
  provider.download_page_url = check('download_page_url', provider.download_page_url);
  if (provider.security_information && Array.isArray(provider.security_information.audits)) {
    for (const audit of provider.security_information.audits) {
      if (audit && typeof audit === 'object') {
        const guarded = guardUrl(audit.url, domains);
        if (audit.url && !guarded) unverified.push('security_information.audits.url');
        audit.url = guarded;
      }
    }
  }
  if (Array.isArray(provider.pricing_plans)) {
    for (const plan of provider.pricing_plans) {
      if (plan && typeof plan === 'object') {
        const guarded = guardUrl(plan.source_url, domains);
        if (plan.source_url && !guarded) unverified.push('pricing_plans.source_url');
        plan.source_url = guarded;
      }
    }
  }
  return { unverified };
}

/**
 * Guard a software record. official_domains may be inherited from the
 * provider record when the software entry does not carry its own.
 */
export function guardSoftware(software, providerDomains) {
  const domains = software.official_domains ?? providerDomains ?? [];
  const unverified = [];
  const download = guardUrl(software.official_download_url, domains);
  if (software.official_download_url && !download) unverified.push('official_download_url');
  software.official_download_url = download;
  const source = guardUrl(software.source, domains);
  if (software.source && !source) unverified.push('source');
  software.source = source;
  return { unverified };
}
