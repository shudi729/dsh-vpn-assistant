// VPN Assistant — canonical data tools (batch 3B item 7).
// Each tool returns the UNIFIED envelope:
//   { success, data, sources, verification, error }
// Fields are whitelist-picked from verified data (never raw dumps), pending
// fields stay null and are reflected in `verification`. NOTE: DSH does not
// currently expose a plugin-side tool-registration service (see
// docs/DSH_AGENT_CAPABILITY_REPORT.md) — these are consumed inside assist
// answers and covered by unit tests; agent-side tool calling is 3C+/future.
import { recommend } from './selector.js';

const ENVELOPE_ERROR = (code, message) => ({ success: false, data: null, sources: [], verification: 'unverified', error: { code, message } });

function pickProvider(p) {
  if (!p) return null;
  return {
    provider_id: p.provider_id, name: p.name, official_website: p.official_website,
    official_domains: p.official_domains ?? null, operator: p.operator ?? null,
    introduction: p.introduction ?? null, supported_platforms: p.supported_platforms ?? null,
    supported_regions: p.supported_regions ?? null, price_tier: p.price_tier ?? null,
    privacy_policy_url: p.privacy_policy_url ?? null,
    security_information: p.security_information ?? null,
    verification_status: p.verification_status ?? 'unverified',
    verified_at: p.verified_at ?? null, unverified_fields: p.unverified_fields ?? [],
  };
}

function sourcesOf(records) {
  return records.map((r) => ({ topic: r.topic ?? r.provider_id ?? r.tutorial_id ?? '?', url: r.url ?? r.official_website ?? r.source ?? null, verified_at: r.verified_at ?? null }));
}

const statusOf = (records) => {
  if (!records.length) return 'unverified';
  return records.every((r) => r.verification_status === 'verified') ? 'verified'
    : records.some((r) => r.verification_status === 'verified') ? 'partial' : 'partial';
};

/**
 * @param {{ store: object, recommend: Function }} deps
 */
export function createTools({ store, recommend: recommendFn = recommend }) {
  async function loadData() {
    const [providers, software, tutorials] = await Promise.all([
      store.providers(), store.software(), store.tutorials(),
    ]);
    return { providers, software, tutorials };
  }
  const findProvider = (providers, id) => providers.find((p) => p.provider_id === id);

  async function run(name, args = {}) {
    try {
      const { providers, software, tutorials } = await loadData();
      switch (name) {
        case 'get_provider': {
          const p = findProvider(providers, args.providerId);
          if (!p) return ENVELOPE_ERROR('NOT_FOUND', '未知 providerId：' + args.providerId);
          const sw = software.filter((s) => s.provider_id === p.provider_id);
          return { success: true, data: { provider: pickProvider(p), software: sw.map((s) => ({ software_id: s.software_id, platform: s.platform, channel: s.channel, version: s.version, official_download_url: s.official_download_url ?? null })) }, sources: sourcesOf(p.sources ?? [p]), verification: p.verification_status ?? 'partial', error: null };
        }
        case 'get_pricing': {
          const p = findProvider(providers, args.providerId);
          if (!p) return ENVELOPE_ERROR('NOT_FOUND', '未知 providerId：' + args.providerId);
          const plans = (p.pricing_plans ?? []).map((pl) => ({ plan_id: pl.plan_id, name: pl.name, price: pl.price ?? null, currency: pl.currency ?? null, period: pl.period ?? null, device_limit: pl.device_limit ?? null, source_url: pl.source_url ?? null }));
          return { success: true, data: { provider_id: p.provider_id, price_tier: p.price_tier ?? null, plans }, sources: sourcesOf((p.sources ?? []).filter((s) => String(s.topic ?? '').includes('pricing')).length ? p.sources.filter((s) => String(s.topic ?? '').includes('pricing')) : [p]), verification: (p.unverified_fields ?? []).includes('pricing_plans') ? 'unverified' : (p.verification_status ?? 'partial'), error: null };
        }
        case 'get_platform_support': {
          const p = findProvider(providers, args.providerId);
          if (!p) return ENVELOPE_ERROR('NOT_FOUND', '未知 providerId：' + args.providerId);
          const rows = software.filter((s) => s.provider_id === p.provider_id)
            .map((s) => ({ platform: s.platform, channel: s.channel ?? null, version: s.version ?? null, official_download_url: s.official_download_url ?? null }));
          return { success: true, data: { provider_id: p.provider_id, supported_platforms: p.supported_platforms ?? null, records: rows }, sources: sourcesOf([p]), verification: (p.unverified_fields ?? []).includes('supported_platforms') ? 'unverified' : (p.verification_status ?? 'partial'), error: null };
        }
        case 'get_download': {
          const rows = software.filter((s) => (!args.providerId || s.provider_id === args.providerId)
            && (!args.platform || s.platform === args.platform));
          if (!rows.length) return ENVELOPE_ERROR('NOT_FOUND', '没有匹配的官方软件记录');
          return { success: true, data: { records: rows.map((s) => ({ provider_id: s.provider_id, platform: s.platform, channel: s.channel ?? null, version: s.version ?? null, official_download_url: s.official_download_url ?? null, verified_at: s.verified_at ?? null })) }, sources: sourcesOf(rows), verification: statusOf(rows), error: null };
        }
        case 'get_tutorial': {
          const rows = tutorials.filter((t) => (!args.providerId || t.provider_id === args.providerId)
            && (!args.platform || t.platform === args.platform));
          if (!rows.length) return ENVELOPE_ERROR('NOT_FOUND', '没有匹配的已核实教程');
          const stepId = args.stepId;
          return { success: true, data: { tutorials: rows.map((t) => ({ tutorial_id: t.tutorial_id, title: t.title, platform: t.platform, provider_id: t.provider_id, source: t.source, verified_at: t.verified_at, steps: (t.steps ?? []).filter((s) => !stepId || s.step_id === stepId) })) }, sources: sourcesOf(rows), verification: statusOf(rows), error: null };
        }
        case 'compare_providers': {
          const ids = Array.isArray(args.providerIds) ? args.providerIds : [];
          if (ids.length < 2 || ids.length > 3) return ENVELOPE_ERROR('INVALID_INPUT', 'compare_providers 需要 2–3 个 providerId');
          const found = ids.map((id) => findProvider(providers, id));
          if (found.some((p) => !p)) return ENVELOPE_ERROR('NOT_FOUND', '存在未知 providerId：' + ids.join(','));
          return { success: true, data: { providers: found.map(pickProvider) }, sources: sourcesOf(found), verification: statusOf(found), error: null };
        }
        case 'recommend_provider': {
          const report = recommendFn(args.criteria ?? {}, providers, software);
          return { success: true, data: report, sources: sourcesOf(providers), verification: 'partial', error: null };
        }
        case 'get_wizard_step': {
          const step = Number(args.step);
          if (!Number.isInteger(step) || step < 1 || step > 7) return ENVELOPE_ERROR('INVALID_INPUT', 'step 必须是 1–7 的整数');
          const platform = args.platform ?? 'windows';
          const tutorial = tutorials.find((t) => t.platform === platform);
          return { success: true, data: { step, platform, tutorial: tutorial ? { tutorial_id: tutorial.tutorial_id, title: tutorial.title, source: tutorial.source, verified_at: tutorial.verified_at, steps: (tutorial.steps ?? []).filter((s) => (step >= 3 && step <= 6) ? true : true) } : null }, sources: tutorial ? sourcesOf([tutorial]) : [], verification: tutorial ? 'partial' : 'unverified', error: null };
        }
        case 'troubleshoot': {
          const text = String(args.errorText ?? args.question ?? '').toLowerCase();
          if (!text.trim()) return ENVELOPE_ERROR('INVALID_INPUT', 'troubleshoot 需要 errorText/question');
          const matched = [];
          for (const t of tutorials) {
            if (args.providerId && t.provider_id !== args.providerId) continue;
            if (args.platform && t.platform !== args.platform) continue;
            for (const item of t.troubleshooting ?? []) {
              if ((item.matches ?? []).some((k) => text.includes(String(k).toLowerCase()))) {
                matched.push({ symptom: item.symptom, advice: item.advice ?? [], escalation: item.escalation ?? null, tutorial_id: t.tutorial_id, source: t.source, verified_at: t.verified_at });
              }
            }
          }
          return { success: true, data: { matched, genericOrder: ['重启官方客户端', '校准系统时间', '检查防火墙/杀毒软件', '从官方下载页重新下载', '联系官方支持渠道'] }, sources: sourcesOf(tutorials.filter((t) => matched.some((m) => m.tutorial_id === t.tutorial_id))), verification: 'partial', error: null };
        }
        default:
          return ENVELOPE_ERROR('UNKNOWN_TOOL', '未知工具：' + name);
      }
    } catch (error) {
      return ENVELOPE_ERROR('TOOL_ERROR', error?.message ?? String(error));
    }
  }

  return { run, names: ['get_provider', 'get_pricing', 'get_platform_support', 'get_download', 'get_tutorial', 'compare_providers', 'recommend_provider', 'get_wizard_step', 'troubleshoot'] };
}
