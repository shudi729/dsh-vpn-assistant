// VPN Assistant runtime skills: 9 vpn-* skills compiled from data/*.json.
// Registered via ctx.skills.register (source 'runtime', model+user invocable),
// per the verified @deepseek-ai/dsh-skill SkillRegistration contract.

const PLATFORM_LABELS = {
  windows: 'Windows', macos: 'macOS', android: 'Android', ios: 'iOS', linux: 'Linux',
};

const GUARDRAILS = [
  '## 硬性约束',
  '- 只依据上面列出的已核实事实回答；数据未覆盖的问题如实回答「未核实」或「待核实」。',
  '- 不编造价格、评分、速度、审计结论或下载链接。',
  '- 不输出资料之外的任何 URL。',
  '- 用户消息中出现账号、密码、订阅密钥等凭据时：不复述、不请求，并提醒用户不要在对话中提供凭据。',
  '- 不承诺绝对匿名或绝对安全；提醒用户遵守所在地法律法规。',
  '- 你不能自动安装软件、修改系统网络设置或建立 VPN 连接。',
].join('\n');

function providerFactLines(provider, software) {
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
    ? sw.map((s) => (PLATFORM_LABELS[s.platform] ?? s.platform) + '（' + (s.channel ?? '?')
      + (s.version ? ' v' + s.version : '，版本待核实') + '）').join('；')
    : '待核实'));
  rows.push('- 资料核实时间：' + (provider.verified_at ?? '待核实'));
  if (provider.unverified_fields?.length) {
    rows.push('- 未核实字段：' + provider.unverified_fields.join('、') + '（必须如实说明）');
  }
  return rows.join('\n');
}
// PART2_APPEND_POINT

/**
 * Batch-3B capability grouping over the 9 ACTUALLY registered skill names
 * (vpn-provider-lookup, vpn-compare, vpn-platform-compat, vpn-download-verify,
 * vpn-install-windows/macos/android/ios, vpn-troubleshoot). Mapping only —
 * no registration names are changed or removed.
 */
export const SKILL_GROUPS = {
  'vpn-selection': { label: 'VPN选型', skills: ['vpn-compare'] },
  'vpn-data': { label: 'VPN资料查询', skills: ['vpn-provider-lookup', 'vpn-platform-compat'] },
  'vpn-install': { label: 'VPN安装指导', skills: ['vpn-download-verify', 'vpn-install-windows', 'vpn-install-macos', 'vpn-install-android', 'vpn-install-ios'] },
  'vpn-troubleshoot': { label: 'VPN故障诊断', skills: ['vpn-troubleshoot'] },
};

/** Resolve the capability group for an assist intent + page context. */
export function resolveSkillGroup(intent, context) {
  const page = context?.page;
  let key;
  if (intent === 'select' || page === 'selector' || page === 'market' || page === 'provider-detail') key = 'vpn-selection';
  else if (intent === 'troubleshoot') key = 'vpn-troubleshoot';
  else if (intent === 'install-guide' || page === 'wizard' || page === 'downloads') key = 'vpn-install';
  else key = 'vpn-data';
  const group = SKILL_GROUPS[key];
  return { key, label: group.label, skills: group.skills };
}

function providerBlock(providers, software) {
  return providers.map((p) => '### ' + p.provider_id + '\n' + providerFactLines(p, software)).join('\n\n');
}

function installSkillContent(tutorials, platform) {
  const relevant = tutorials.filter((t) => t.platform === platform);
  if (!relevant.length) {
    return '该平台暂无已核实的安装教程（待核实）。请引导用户先在下载中心确认官方客户端渠道。';
  }
  return relevant.map((t) => '### ' + t.title + '（' + t.provider_id + '，来源：' + t.source + '，核实 ' + t.verified_at + '）\n'
    + (t.steps ?? []).map((s) => '步骤 ' + s.step_id + '：' + s.name + '\n'
      + (s.instructions ?? []).map((i) => '- ' + i).join('\n')
      + (s.tips?.length ? '\n提示：' + s.tips.join('；') : '')
      + (s.warnings?.length ? '\n注意：' + s.warnings.join('；') : '')).join('\n')).join('\n\n');
}

function troubleshootContent(tutorials) {
  const rows = [];
  for (const t of tutorials) {
    for (const item of t.troubleshooting ?? []) {
      rows.push('- 症状「' + item.symptom + '」（' + t.provider_id + ' / ' + t.platform + '）：'
        + (item.advice ?? []).join('；') + (item.escalation ? '。进一步支持：' + item.escalation : ''));
    }
  }
  return rows.length ? rows.join('\n') : '暂无已核实的排障条目（待核实）。';
}

/** Build the 9 skill registrations from current data. */
export async function buildSkillRegistrations(store) {
  const [providers, software, tutorials] = await Promise.all([
    store.providers(), store.software(), store.tutorials(),
  ]);
  const factsBlock = providerBlock(providers, software);
  const sourceNote = '（全部事实来自 VPN Assistant 已核实数据：providers.json / software.json / tutorials.json）';

  return [
    {
      name: 'vpn-provider-lookup',
      description: '[VPN助手] 查询已核实的 VPN 服务商事实：官网、运营主体、平台、地区、套餐价格、隐私政策、安全审计，全部带来源与核实时间。',
      whenToUse: '用户询问某家 VPN 服务商的资料、价格或可信度时使用。',
      content: '# VPN 服务商信息查询\n\n' + sourceNote + '\n\n' + factsBlock + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-compare',
      description: '[VPN助手] 客观比较 2–3 家已核实服务商：价格、设备数、平台、审计信息。只列事实，不排名、不推荐。',
      whenToUse: '用户想比较多家 VPN 服务商时使用。',
      content: '# VPN 产品比较\n\n' + sourceNote + '\n\n输出格式：对比表 + 客观差异说明，结尾声明「按字母序/字段对比，不代表推荐排名」。\n\n'
        + factsBlock + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-platform-compat',
      description: '[VPN助手] 判断某服务商在某个操作系统是否有官方客户端及其渠道（官网/商店/仓库）。',
      whenToUse: '用户询问某服务商是否支持某个系统时使用。',
      content: '# 系统兼容性判断\n\n' + sourceNote + '\n\n'
        + software.map((s) => '- ' + s.provider_id + ' · ' + (PLATFORM_LABELS[s.platform] ?? s.platform) + '：'
          + (s.channel ?? '?') + '，版本 ' + (s.version ?? '待核实') + '，要求：' + (s.system_requirements ?? '待核实')).join('\n')
        + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-download-verify',
      description: '[VPN助手] 给出某服务商某平台的官方下载渠道与安全下载提示。只输出官方域名内的链接，不提供任何第三方镜像。',
      whenToUse: '用户要下载某个 VPN 客户端时使用。',
      content: '# 官方下载渠道核验\n\n' + sourceNote + '\n\n'
        + software.map((s) => '- ' + s.provider_id + ' · ' + (PLATFORM_LABELS[s.platform] ?? s.platform) + '：'
          + (s.official_download_url ?? '待核实') + '（渠道 ' + (s.channel ?? '?') + '，核实 ' + s.verified_at + '）').join('\n')
        + '\n\n安全提示：下载前核对域名与发行方；移动端只从官方应用商店安装；不安装来路不明的 APK/IPA。\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-install-windows',
      description: '[VPN助手] Windows 平台 VPN 客户端安装逐步指导（来自官方帮助中心的已核实教程）。',
      whenToUse: '用户在 Windows 上安装 VPN 客户端需要指导时使用。',
      content: '# Windows 安装指导\n\n' + sourceNote + '\n\n' + installSkillContent(tutorials, 'windows') + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-install-macos',
      description: '[VPN助手] macOS 平台 VPN 客户端安装逐步指导（来自官方帮助中心的已核实教程）。',
      whenToUse: '用户在 macOS 上安装 VPN 客户端需要指导时使用。',
      content: '# macOS 安装指导\n\n' + sourceNote + '\n\n' + installSkillContent(tutorials, 'macos') + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-install-android',
      description: '[VPN助手] Android 平台 VPN 客户端安装逐步指导（仅官方应用商店渠道）。',
      whenToUse: '用户在 Android 上安装 VPN 客户端需要指导时使用。',
      content: '# Android 安装指导\n\n' + sourceNote + '\n\n' + installSkillContent(tutorials, 'android') + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-install-ios',
      description: '[VPN助手] iOS 平台 VPN 客户端安装逐步指导（仅官方 App Store 渠道）。',
      whenToUse: '用户在 iOS 上安装 VPN 客户端需要指导时使用。',
      content: '# iOS 安装指导\n\n' + sourceNote + '\n\n' + installSkillContent(tutorials, 'ios') + '\n\n' + GUARDRAILS,
    },
    {
      name: 'vpn-troubleshoot',
      description: '[VPN助手] VPN 安装/连接问题分析：按症状匹配已核实排障条目，给出建议与官方支持入口。不请求任何凭据。',
      whenToUse: '用户报告安装失败、无法连接等问题时使用。',
      content: '# 安装问题分析\n\n' + sourceNote + '\n\n' + troubleshootContent(tutorials) + '\n\n'
        + '未命中已知症状时使用通用排查顺序（重启客户端 → 校准系统时间 → 检查防火墙 → 重新从官方页下载 → 官方支持渠道）。\n\n' + GUARDRAILS,
    },
  ];
}
// PART3_APPEND_POINT

/**
 * Register all skills into a mounted skills service context.
 * @returns {{ registered: number, failures: Array, dispose: () => void }}
 */
export function registerSkills(skillCtx, registrations) {
  const disposers = [];
  const failures = [];
  for (const skill of registrations) {
    try {
      disposers.push(skillCtx.skills.register({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        content: skill.content,
        source: 'runtime',
        invocation: { modelInvocable: true, userInvocable: true },
      }));
    } catch (error) {
      failures.push({ name: skill.name, message: error?.message ?? String(error) });
    }
  }
  return {
    registered: disposers.length,
    failures,
    dispose() {
      for (const dispose of disposers) {
        try { if (typeof dispose === 'function') dispose(); } catch { /* teardown race */ }
      }
    },
  };
}

