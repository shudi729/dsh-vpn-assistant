// VPN Assistant — rule-based recommendation engine (batch 3A).
// Deterministic, data-driven. NO LLM involvement: every score, reason and
// price in the output is derived from data/*.json by the rules documented in
// docs/RECOMMENDATION_RULES.md. Score and data-credibility are computed
// separately and never mixed.

/** Scoring weights (must sum to 1; asserted in unit tests). */
export const WEIGHTS = {
  compatibility: 0.25,   // 兼容性
  needMatch: 0.25,       // 需求匹配
  price: 0.20,           // 价格
  privacySecurity: 0.20, // 隐私及安全资料
  usability: 0.10,       // 易用性
};

export const DEVICE_OPTIONS = ['windows', 'macos', 'linux', 'android', 'ios', 'multiple'];
export const PURPOSE_OPTIONS = ['privacy', 'work', 'wifi', 'general'];
export const BUDGET_OPTIONS = ['free', 'usd3', 'usd6', 'usd12', 'any'];
export const DEVICE_COUNT_OPTIONS = [1, 2, 3, 5, 10];
export const PREFERENCE_OPTIONS = ['freeTier', 'audited', 'wideCoverage', 'officialChannels', 'manyDevices'];

/** Documented reference rates for budget comparison ONLY (以官网结算价为准). */
export const FX_TO_USD = { USD: 1, EUR: 1.08, HKD: 0.128 };
/** Provenance of the reference rates (honesty: static, not live). */
export const FX_META = {
  asOf: '2026-11-12',
  source: '引擎内置静态参考汇率（未接实时汇率源）',
  usage: '仅用于预算比较与展示换算；官网实际售价以各服务商官网结算页所示原币价格为准',
};
const CRED_FIELD_TOTAL = 12; // tracked provider fields for completeness
const BUDGET_LIMIT_USD = { free: 0, usd3: 3, usd6: 6, usd12: 12, any: Infinity };

const DEVICE_LABEL = {
  windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS',
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Build a dimension result. `deductions` are explicit point-loss items; an
 * absorbing "rounding" item keeps Σ(value) === 1 − score exactly, so the
 * total score is always recomputable from the breakdown.
 */
function dim(key, score, reasons, deductions = []) {
  const s = round1(clamp01(score));
  const items = deductions.filter((d) => d.value > 0.0001).map((d) => ({ reason: d.reason, value: round2(d.value) }));
  const gap = round2(1 - s) - round2(items.reduce((a, b) => a + b.value, 0));
  if (Math.abs(gap) >= 0.01) {
    items.push({ reason: '其他构成/保留位差', value: round2(gap) });
  }
  return { key, weight: WEIGHTS[key], score: s, reasons, deductions: items };
}

export function validateCriteria(raw) {
  const c = raw ?? {};
  const out = {
    device: c.device ?? 'multiple',
    purpose: c.purpose ?? 'general',
    region: c.region === 'wide' ? 'wide' : 'any',
    budget: c.budget ?? 'any',
    deviceCount: Number.isInteger(c.deviceCount) ? c.deviceCount : 1,
    preferences: Array.isArray(c.preferences) ? c.preferences : [],
  };
  if (!DEVICE_OPTIONS.includes(out.device)) throw invalid('device');
  if (!PURPOSE_OPTIONS.includes(out.purpose)) throw invalid('purpose');
  if (!BUDGET_OPTIONS.includes(out.budget)) throw invalid('budget');
  if (!DEVICE_COUNT_OPTIONS.includes(out.deviceCount)) throw invalid('deviceCount');
  for (const pref of out.preferences) {
    if (!PREFERENCE_OPTIONS.includes(pref)) throw invalid('preferences');
  }
  return out;
}
function invalid(field) {
  const e = new Error('推荐条件字段无效：' + field);
  e.code = 'INVALID_INPUT';
  return e;
}

export function hasFreeTier(p) {
  if (p.price_tier === 'free' || p.price_tier === 'freemium') return true;
  return (p.pricing_plans ?? []).some((pl) => Number(pl.price) === 0);
}
export function monthlyUSD(plan) {
  const rate = FX_TO_USD[plan.currency];
  if (!Number.isFinite(rate)) return null;
  const base = Number(plan.price) * rate;
  // Normalize billing period to a monthly equivalent (year ÷ 12), documented.
  if (plan.period === 'year') return base / 12;
  return base;
}
/** Cheapest paid monthly price in USD (reference conversion), or null. */
export function lowestPaidMonthlyUSD(p) {
  const paid = (p.pricing_plans ?? []).map(monthlyUSD).filter((v) => Number.isFinite(v) && v > 0);
  return paid.length ? Math.min(...paid) : null;
}
/** Known max device limit across plans (null when not published). */
export function maxDeviceLimit(p) {
  const limits = (p.pricing_plans ?? []).map((pl) => pl.device_limit).filter((n) => Number.isFinite(n));
  return limits.length ? Math.max(...limits) : null;
}
export function auditCount(p) {
  const audits = p.security_information?.audits;
  return Array.isArray(audits) ? audits.length : 0;
}
export function verifiedDownloadStats(p, software) {
  const rows = software.filter((s) => s.provider_id === p.provider_id);
  return { verified: rows.filter((s) => s.official_download_url).length, total: rows.length };
}

/** Data credibility (0–100), separate from the recommendation score. */
export function credibilityOf(p) {
  const status = p.verification_status === 'verified' ? 0.55 : p.verification_status === 'partial' ? 0.30 : 0.10;
  const sources = Array.isArray(p.sources) ? Math.min(p.sources.length, 4) / 4 : 0;
  const unverified = Array.isArray(p.unverified_fields) ? p.unverified_fields.length : 0;
  const completeness = (1 - unverified / CRED_FIELD_TOTAL) * 0.25;
  return {
    value: Math.round((status + sources * 0.20 + completeness) * 100),
    status: p.verification_status ?? 'unknown',
    verifiedAt: p.verified_at ?? null,
    unverifiedFields: p.unverified_fields ?? [],
  };
}

function compatibilityDim(c, p) {
  const platforms = Array.isArray(p.supported_platforms) ? p.supported_platforms : null;
  if (c.device === 'multiple') {
    if (!platforms) return dim('compatibility', 0, ['支持平台待核实，无法评估多设备兼容'], [{ reason: '支持平台数据待核实', value: 1 }]);
    return dim('compatibility', platforms.length / 5,
      ['官方支持 ' + platforms.length + '/5 类平台（' + platforms.map((x) => DEVICE_LABEL[x] ?? x).join('、') + '）'],
      [{ reason: '平台覆盖 ' + platforms.length + '/5 类，未满全部常见平台', value: 1 - platforms.length / 5 }]);
  }
  if (!platforms) return dim('compatibility', 0, ['支持平台待核实'], [{ reason: '支持平台数据待核实', value: 1 }]);
  const breadth = platforms.length / 5;
  return dim('compatibility', 0.7 + 0.3 * breadth,
    ['官方支持 ' + (DEVICE_LABEL[c.device] ?? c.device) + ' 客户端（核实平台 ' + platforms.length + '/5 类）'],
    [{ reason: '其余 ' + (5 - platforms.length) + ' 类平台未覆盖/未核实', value: 0.3 * (1 - breadth) }]);
}

function needMatchDim(c, p) {
  if (c.purpose === 'privacy') {
    const cat = (p.categories ?? []).includes('privacy');
    const audits = auditCount(p);
    const reasons = [];
    if (cat) reasons.push('官方资料将产品归类为隐私导向');
    if (audits > 0) reasons.push('有 ' + audits + ' 次独立安全审计记录');
    if (!cat && audits === 0) reasons.push('隐私维度证据不足（待核实）');
    return dim('needMatch', (cat ? 0.6 : 0) + (audits > 0 ? 0.4 : 0), reasons, [
      { reason: '官方分类未标注隐私导向', value: cat ? 0 : 0.4 },
      { reason: '无独立安全审计记录（仅在用户将审计设为必要时才排除，此处仅降分）', value: audits > 0 ? 0 : 0.4 },
    ]);
  }
  if (c.purpose === 'work') {
    const limit = maxDeviceLimit(p);
    const reasons = [];
    let base;
    if (limit == null) { base = 0.3; reasons.push('套餐设备上限待核实，按保守评估'); }
    else if (limit >= c.deviceCount) { base = 0.6; reasons.push('套餐设备上限 ' + limit + ' 台，满足 ' + c.deviceCount + ' 台需求'); }
    else { base = 0.3; reasons.push('套餐设备上限 ' + limit + ' 台'); }
    if (p.supported_regions) reasons.push('服务地区已有核实信息：' + String(p.supported_regions[0] ?? p.supported_regions).slice(0, 40));
    else reasons.push('服务地区待核实');
    return dim('needMatch', base + (p.supported_regions ? 0.4 : 0), reasons, [
      { reason: '套餐设备上限待核实，保守计 0.3/0.6', value: limit == null ? 0.3 : 0 },
      { reason: '服务地区待核实', value: p.supported_regions ? 0 : 0.4 },
    ]);
  }
  if (c.purpose === 'wifi') {
    const tier = p.price_tier;
    const base = tier === 'freemium' ? 0.7 : tier === 'paid' ? 0.4 : 0.5;
    const platforms = Array.isArray(p.supported_platforms) ? p.supported_platforms : [];
    const breadth = platforms.length / 5;
    const reasons = [];
    if (tier === 'freemium') reasons.push('提供免费档，适合公共 Wi-Fi 临时使用');
    else if (tier === 'paid') reasons.push('无免费档（价格见价格维度）');
    else reasons.push('价格档位待核实');
    if (platforms.length) reasons.push('覆盖 ' + platforms.length + '/5 类平台');
    return dim('needMatch', base + 0.3 * breadth, reasons, [
      { reason: '无免费档', value: tier === 'freemium' ? 0 : 0.3 },
      { reason: '价格档位待核实', value: tier == null ? 0.2 : 0 },
      { reason: '平台覆盖 ' + platforms.length + '/5 类', value: 0.3 * (1 - breadth) },
    ]);
  }
  const platforms = Array.isArray(p.supported_platforms) ? p.supported_platforms : [];
  return dim('needMatch', 0.5 + 0.5 * (platforms.length / 5),
    ['未指定专项需求，按平台覆盖（' + platforms.length + '/5 类）综合评估'],
    [{ reason: '平台覆盖 ' + platforms.length + '/5 类，需求信息不足按中性基准 0.5 计', value: 0.5 * (1 - platforms.length / 5) }]);
}

function priceDim(c, p) {
  const free = hasFreeTier(p);
  const paid = lowestPaidMonthlyUSD(p);
  if (c.budget === 'free') return dim('price', 1, ['免费档 $0/月（以官网结算页为准）']);
  if (paid == null && !free) return dim('price', 0.3, ['价格待核实，无法评估性价比'], [{ reason: '价格数据待核实，无法比较', value: 0.7 }]);
  if (paid == null) return dim('price', 0.9, ['有免费档；付费价格待核实'], [{ reason: '付费价格待核实', value: 0.1 }]);
  const limit = BUDGET_LIMIT_USD[c.budget];
  let score;
  if (limit === Infinity) score = paid <= 6 ? 0.8 : 0.6;
  else score = clamp01(1 - 0.5 * (paid / limit));
  const src = (p.pricing_plans ?? []).find((pl) => Number(pl.price) > 0);
  const cur = src?.currency ?? '';
  const converted = cur === 'USD'
    ? (src?.period === 'year'
      ? '年付方案折合约 $' + paid.toFixed(2) + '/月（官网原价 ' + src?.price + ' USD/年）'
      : '官网原价 $' + src?.price + '/月')
    : '参考换算价 $' + paid.toFixed(2) + '/月（官网原价 ' + src?.price + ' ' + cur
      + (src?.period === 'year' ? '/年' : '/月') + '，按 ' + FX_META.asOf + ' 内置参考汇率 ' + FX_TO_USD[cur]
      + (src?.period === 'year' ? ' 并按年付÷12 折算' : '') + '，非官网实际售价）';
  return dim('price', score, ['最低付费档：' + converted + '；实际售价以官网结算页为准'], [
    { reason: '价格相对预算偏高（线性计 0.5×p/L）', value: limit === Infinity ? 1 - score : 0.5 * (paid / limit) },
  ]);
}

function privacySecurityDim(p) {
  const audits = p.security_information?.audits ?? [];
  const n = audits.length;
  const reasons = [];
  for (const a of audits.slice(0, 2)) reasons.push('审计：' + a.name + '（' + a.auditor + (a.year ? '，' + a.year : '') + '）');
  if (p.security_information && n === 0 && p.security_information.notes) {
    reasons.push(String(p.security_information.notes).slice(0, 60));
  }
  if (p.privacy_policy_url) {
    reasons.push('隐私政策 URL 已核实');
    return dim('privacySecurity', Math.min(1, 0.3 + 0.25 * Math.min(n, 2) + 0.2), reasons, [
      { reason: '独立审计记录不足 2 次（缺失时仅降分，不默认排除）', value: 0.25 * (2 - Math.min(n, 2)) },
    ]);
  }
  if (n === 0) reasons.push('隐私与审计资料待核实');
  else reasons.push('隐私政策 URL 待核实');
  return dim('privacySecurity', Math.min(1, 0.3 + 0.25 * Math.min(n, 2)), reasons, [
    { reason: '独立审计记录不足 2 次（缺失时仅降分，不默认排除）', value: 0.25 * (2 - Math.min(n, 2)) },
    { reason: '隐私政策 URL 未核实', value: 0.2 },
  ]);
}

function usabilityDim(p, dl) {
  const platforms = Array.isArray(p.supported_platforms) ? p.supported_platforms : [];
  const breadth = platforms.length / 5;
  const dlRatio = dl.verified / Math.max(dl.total, 1);
  return dim('usability', 0.5 * breadth + 0.5 * dlRatio,
    ['官方下载渠道已核实 ' + dl.verified + '/' + dl.total + ' 条记录'], [
    { reason: '平台覆盖 ' + platforms.length + '/5 类', value: 0.5 * (1 - breadth) },
    { reason: '官方下载渠道待核实 ' + (dl.total - dl.verified) + '/' + dl.total + ' 条', value: 0.5 * (1 - dlRatio) },
  ]);
}

function hardFilters(c, p) {
  const reasons = [];
  const platforms = Array.isArray(p.supported_platforms) ? p.supported_platforms : null;
  if (c.device !== 'multiple') {
    if (!platforms) reasons.push('支持平台待核实，无法确认 ' + (DEVICE_LABEL[c.device] ?? c.device) + ' 兼容');
    else if (!platforms.includes(c.device)) reasons.push('官方不支持 ' + (DEVICE_LABEL[c.device] ?? c.device) + ' 平台');
  } else if (!platforms) {
    reasons.push('支持平台待核实，无法评估多设备覆盖');
  }
  if (c.budget === 'free' && !hasFreeTier(p)) reasons.push('无免费档（与预算「仅免费」不符）');
  if (c.budget !== 'free' && c.budget !== 'any') {
    const paid = lowestPaidMonthlyUSD(p);
    if (paid == null && !hasFreeTier(p)) reasons.push('价格待核实，无法确认预算内');
    else if (paid != null && paid > BUDGET_LIMIT_USD[c.budget]) {
      reasons.push('最低付费档约 $' + paid.toFixed(2) + '/月，超出预算 $' + BUDGET_LIMIT_USD[c.budget] + '/月');
    }
  }
  const limit = maxDeviceLimit(p);
  if (limit != null && limit < c.deviceCount) {
    reasons.push('套餐设备上限 ' + limit + ' 台，低于需求 ' + c.deviceCount + ' 台');
  }
  for (const pref of c.preferences) {
    if (pref === 'freeTier' && !hasFreeTier(p)) reasons.push('不满足偏好：无免费档');
    if (pref === 'audited' && auditCount(p) === 0) {
      reasons.push(p.security_information ? '不满足偏好：官网未公布独立安全审计' : '不满足偏好：安全审计待核实');
    }
    if (pref === 'wideCoverage' && !p.supported_regions) reasons.push('不满足偏好：服务地区待核实');
    if (pref === 'officialChannels') {
      // filled by caller via dl stats (see recommend)
    }
  }
  return reasons;
}

/**
 * Rank providers for the given criteria.
 * @param {object} criteria raw criteria (validated/normalized here)
 * @param {Array} providers providers.json records
 * @param {Array} software software.json records
 * @returns {object} deterministic recommendation report
 */
export function recommend(rawCriteria, providers, software) {
  const c = validateCriteria(rawCriteria);
  const dlMap = new Map();
  for (const p of providers) dlMap.set(p.provider_id, verifiedDownloadStats(p, software ?? []));

  const results = [];
  const excluded = [];
  for (const p of providers) {
    const dl = dlMap.get(p.provider_id);
    const fail = hardFilters(c, p);
    if (c.preferences.includes('officialChannels') && (dl.verified < dl.total || dl.total === 0)) {
      fail.push('不满足偏好：官方下载渠道存在待核实项（' + dl.verified + '/' + dl.total + '）');
    }
    if (c.preferences.includes('manyDevices')) {
      const limit = maxDeviceLimit(p);
      if (limit == null || limit < Math.max(c.deviceCount, 5)) {
        fail.push(limit == null ? '不满足偏好：套餐设备上限待核实' : '不满足偏好：设备上限 ' + limit + ' 台（偏好 ≥5 台）');
      }
    }
    if (fail.length) {
      excluded.push({ provider_id: p.provider_id, name: p.name, reason: fail[0], allReasons: fail, credibility: credibilityOf(p) });
      continue;
    }
    const dimensions = [
      compatibilityDim(c, p),
      needMatchDim(c, p),
      priceDim(c, p),
      privacySecurityDim(p),
      usabilityDim(p, dl),
    ];
    const total = round1(dimensions.reduce((sum, d) => sum + d.weight * d.score, 0) * 100);
    const notes = [];
    if (maxDeviceLimit(p) == null) notes.push('套餐设备上限待核实，无法确认 ≥' + c.deviceCount + ' 台');
    if (c.region === 'wide' && !p.supported_regions) notes.push('服务地区待核实，无法确认全球覆盖广度');
    results.push({ provider_id: p.provider_id, name: p.name, score: total, dimensions, credibility: credibilityOf(p), notes });
  }
  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));
  excluded.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return {
    criteria: c,
    results,
    excluded,
    meta: {
      engine: 'rule-v1',
      generatedBy: 'local-rule-engine（规则计算，未使用 LLM）',
      weights: WEIGHTS,
      formula: 'total = Σ(维度权重 × 维度得分) × 100；维度扣分合计 = 1 − 维度得分',
      fx: FX_TO_USD,
      fxMeta: FX_META,
      providersAssessed: providers.length,
    },
  };
}
