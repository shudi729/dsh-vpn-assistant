// VPN Assistant assist module: intent dispatch + truthful degrade.
// AI path uses real llm over verified data excerpts; degrade path generates
// guidance from data/*.json. Never fabricates prices, ratings or URLs.
// Batch 3B: accepts an optional validated page `context` (see context.js),
// resolves the VPN capability group and tags answers with it. No chat UI is
// built here — DSH Agent stays the conversation surface.
import { describeContext } from './context.js';
import { resolveSkillGroup } from './skills.js';

const INTENTS = ['select', 'install-guide', 'troubleshoot'];
const SECRET_KEY_PATTERN = /(password|passwd|secret|token|credential|apikey|api_key|subscription[-_ ]?key|private[-_ ]?key)/i;

const PLATFORM_LABELS = {
  windows: 'Windows', macos: 'macOS', android: 'Android', ios: 'iOS', linux: 'Linux',
};

export function validateAssistPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'INVALID_INPUT', message: '请求体必须是 JSON 对象' };
  }
  for (const key of Object.keys(body)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      return { error: 'SECRET_REJECTED', message: '请求包含疑似凭据字段（' + key + '），本插件不接收任何凭据' };
    }
  }
  const intent = body.intent;
  if (!intent) return { error: 'MISSING_INPUT', message: '缺少 intent 字段' };
  if (!INTENTS.includes(intent)) {
    return { error: 'INVALID_INPUT', message: 'intent 必须是 ' + INTENTS.join(' / ') };
  }
  const clean = { intent };
  if (body.providerId !== undefined) {
    if (typeof body.providerId !== 'string' || !body.providerId) {
      return { error: 'INVALID_INPUT', message: 'providerId 必须是非空字符串' };
    }
    clean.providerId = body.providerId;
  }
  if (body.platform !== undefined) {
    if (!PLATFORM_LABELS[body.platform]) {
      return { error: 'INVALID_INPUT', message: 'platform 必须是 ' + Object.keys(PLATFORM_LABELS).join(' / ') };
    }
    clean.platform = body.platform;
  }
  if (body.stepId !== undefined) {
    if (typeof body.stepId !== 'string' || !body.stepId) {
      return { error: 'INVALID_INPUT', message: 'stepId 必须是非空字符串' };
    }
    clean.stepId = body.stepId;
  }
  for (const field of ['question', 'errorText']) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') {
        return { error: 'INVALID_INPUT', message: field + ' 必须是字符串' };
      }
      clean[field] = body[field].slice(0, 2000);
      if (SECRET_KEY_PATTERN.test(clean[field])) {
        return { error: 'SECRET_REJECTED', message: '文本中包含疑似凭据内容，请去除账号、密码或订阅密钥后再试' };
      }
    }
  }
  return { payload: clean };
}

export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function createAssist({ store, model }) {
  return { run: (payload, context) => runAssist(store, model, payload, context) };
}

/** Facts excerpt for one provider, strictly from verified data, with sources. */
export function providerFacts(provider, software) {
  const rows = [];
  rows.push('- 名称：' + (provider.name ?? '待核实'));
  rows.push('- 官网：' + (provider.official_website ?? '待核实'));
  rows.push('- 运营主体：' + (provider.operator ?? '待核实'));
  rows.push('- 支持平台：' + (provider.supported_platforms?.map((p) => PLATFORM_LABELS[p] ?? p).join('、') ?? '待核实'));
  rows.push('- 服务地区：' + (provider.supported_regions?.join('、') ?? '待核实'));
  if (Array.isArray(provider.pricing_plans) && provider.pricing_plans.length) {
    for (const plan of provider.pricing_plans) {
      const price = plan.price === 0 ? '免费' : (plan.price ?? '待核实');
      rows.push('- 套餐 ' + (plan.name ?? '?') + '：' + price + ' ' + (plan.currency ?? '') + ' / ' + (plan.period ?? '')
        + '，设备 ' + (plan.device_limit ?? '待核实') + '（来源：' + (plan.source_url ?? '待核实') + '）');
    }
  } else {
    rows.push('- 套餐：待核实');
  }
  rows.push('- 隐私政策：' + (provider.privacy_policy_url ?? '待核实'));
  const audits = provider.security_information?.audits ?? [];
  rows.push('- 安全审计：' + (audits.length
    ? audits.map((a) => (a.name ?? '?') + '（' + (a.auditor ?? '?') + ' ' + (a.year ?? '?') + '）').join('；')
    : '暂未收集到公开审计信息（待核实）'));
  const sw = software.filter((s) => s.provider_id === provider.provider_id);
  rows.push('- 官方客户端：' + (sw.length
    ? sw.map((s) => (PLATFORM_LABELS[s.platform] ?? s.platform) + '（' + (s.channel ?? '?') + (s.version ? ' v' + s.version : '，版本待核实') + '）').join('；')
    : '待核实'));
  rows.push('- 资料核实时间：' + (provider.verified_at ?? '待核实'));
  if (provider.unverified_fields?.length) {
    rows.push('- 未核实字段（回答时必须如实说明）：' + provider.unverified_fields.join('、'));
  }
  return rows.join('\n');
}

/** Deterministic degrade path — guidance generated from verified data only. */
async function degrade(store, payload) {
  const providers = await store.providers();
  const software = await store.software();
  const tutorials = await store.tutorials();
  if (payload.intent === 'select') {
    const lines = ['（知识库模式：以下对比由已核实数据自动生成，不代表推荐排名。）', ''];
    for (const p of providers) {
      lines.push('## ' + p.name);
      lines.push(providerFacts(p, software));
      lines.push('');
    }
    return {
      answer: lines.join('\n'),
      aiUsed: false,
      reason: 'llm-unavailable',
      basedOn: providers.map((p) => ({ topic: p.provider_id, url: p.official_website, verified_at: p.verified_at })),
    };
  }
  if (payload.intent === 'install-guide') {
    const target = tutorials.find((t) => (!payload.providerId || t.provider_id === payload.providerId)
      && (!payload.platform || t.platform === payload.platform))
      ?? tutorials.find((t) => !payload.platform || t.platform === payload.platform);
    if (!target) {
      return {
        answer: '知识库中暂无该平台/服务商的已核实安装教程，请先在下载中心确认官方客户端渠道。',
        aiUsed: false, reason: 'llm-unavailable', basedOn: [],
      };
    }
    const step = (target.steps ?? []).find((s) => s.step_id === payload.stepId) ?? target.steps?.[0];
    const lines = ['（知识库模式：来自官方帮助中心的已核实教程，AI 未接入。）', '',
      '教程：' + target.title + '（来源：' + target.source + '，核实 ' + target.verified_at + '）', ''];
    if (step) {
      lines.push('## ' + step.name);
      (step.instructions ?? []).forEach((text, index) => lines.push((index + 1) + '. ' + text));
      if (step.tips?.length) lines.push('', '提示：' + step.tips.join('；'));
      if (step.warnings?.length) lines.push('', '注意：' + step.warnings.join('；'));
    }
    return {
      answer: lines.join('\n'), aiUsed: false, reason: 'llm-unavailable',
      basedOn: [{ topic: target.tutorial_id, url: target.source, verified_at: target.verified_at }],
    };
  }
  // troubleshoot
  const candidates = tutorials.filter((t) => (!payload.platform || t.platform === payload.platform)
    && (!payload.providerId || t.provider_id === payload.providerId));
  const text = ((payload.errorText ?? '') + ' ' + (payload.question ?? '')).toLowerCase();
  const matched = [];
  for (const tutorial of candidates) {
    for (const item of tutorial.troubleshooting ?? []) {
      const hit = (item.matches ?? []).some((keyword) => text.includes(String(keyword).toLowerCase()));
      if (hit) matched.push({ tutorial, item });
    }
  }
  const lines = ['（知识库模式：规则化排查，AI 未接入。）', ''];
  if (matched.length) {
    for (const { tutorial, item } of matched) {
      lines.push('## ' + item.symptom + '（来源：' + tutorial.source + '）');
      for (const advice of item.advice ?? []) lines.push('- ' + advice);
      if (item.escalation) lines.push('- 进一步支持：' + item.escalation);
      lines.push('');
    }
  } else {
    lines.push('未命中已知症状，通用排查顺序：');
    lines.push('1. 重启官方客户端后重试；');
    lines.push('2. 检查系统时间是否准确；');
    lines.push('3. 暂时关闭防火墙/杀毒软件后再安装或连接；');
    lines.push('4. 从官方下载页重新下载安装包（注意域名与发行方）；');
    lines.push('5. 仍未解决时使用服务商官方支持渠道。');
  }
  return {
    answer: lines.join('\n'), aiUsed: false, reason: 'llm-unavailable',
    basedOn: matched.map(({ tutorial }) => ({ topic: tutorial.tutorial_id, url: tutorial.source, verified_at: tutorial.verified_at })),
  };
}

/** Main dispatch: AI first over verified excerpts; degrade on any real failure. */
async function runAssist(store, model, payload, context = null) {
  const [providers, software, tutorials] = await Promise.all([
    store.providers(), store.software(), store.tutorials(),
  ]);
  const effectiveProviderId = payload.providerId ?? context?.providerId ?? null;
  const provider = effectiveProviderId ? providers.find((p) => p.provider_id === effectiveProviderId) : null;
  if (effectiveProviderId && !provider) {
    const error = new Error('未知的服务商 providerId：' + effectiveProviderId);
    error.code = 'NOT_FOUND';
    throw error;
  }
  const effectivePlatform = payload.platform ?? context?.platform ?? null;
  const group = resolveSkillGroup(payload.intent, context);
  const contextLine = context ? '（当前页面上下文：' + describeContext(context) + '）' : '';

  let system;
  let facts;
  if (payload.intent === 'select') {
    system = '你是 VPN 选型助手。只依据提供的事实回答；不排名、不使用营销话术；'
      + '数据未覆盖的问题如实回答「待核实」；不编造价格、评分或链接；'
      + '提醒用户遵守所在地法律法规。';
    facts = provider
      ? providerFacts(provider, software)
      : providers.map((p) => providerFacts(p, software)).join('\n\n');
  } else {
    system = '你是 VPN 安装助手。只依据提供的官方教程事实逐步指导；不编造步骤或链接；'
      + '不请求用户提供账号、密码或订阅密钥；你不能自动安装软件或修改系统设置。';
    const relevant = tutorials.filter((t) => (!effectiveProviderId || t.provider_id === effectiveProviderId)
      && (!effectivePlatform || t.platform === effectivePlatform));
    facts = relevant.map((t) => '教程：' + t.title + '（来源：' + t.source + '，核实 ' + t.verified_at + '）\n'
      + (t.steps ?? []).map((s) => '步骤 ' + s.step_id + '：' + s.name + '\n'
        + (s.instructions ?? []).map((i) => '- ' + i).join('\n')
        + (s.warnings?.length ? '\n注意：' + s.warnings.join('；') : '')).join('\n')).join('\n\n');
  }

  const question = [payload.question, payload.errorText].filter(Boolean).join('\n') || '请基于事实给出指导。';
  const basedOn = (provider
    ? [{ topic: provider.provider_id, url: provider.official_website, verified_at: provider.verified_at }]
    : providers.map((p) => ({ topic: p.provider_id, url: p.official_website, verified_at: p.verified_at })));
  const prompt = '以下是已核实的资料（含来源与核实时间）：\n\n' + facts
    + '\n\n用户的问题/描述：\n' + question
    + '\n\n要求：只使用上述事实；未覆盖的信息回答「待核实」；不输出资料之外的下载链接。';

  try {
    const answer = await model.complete({ system, prompt, maxTokens: 1400 });
    return { answer, aiUsed: true, model: model.stats.route, basedOn, skillGroup: group, context: context || null };
  } catch (error) {
    const degraded = await degrade(store, { ...payload, providerId: effectiveProviderId ?? undefined, platform: effectivePlatform ?? undefined });
    degraded.aiReason = error?.code ?? 'LLM_ERROR';
    degraded.aiDetail = error?.message ?? String(error);
    if (!degraded.basedOn.length) degraded.basedOn = basedOn;
    degraded.skillGroup = group;
    degraded.context = context || null;
    if (contextLine) degraded.answer = contextLine + '\n\n' + degraded.answer;
    return degraded;
  }
}

