// VPN Assistant — unified page-context protocol (batch 3B), v1.
// Single validation source for the host; the client mirrors the SAME rules in
// client.js (buildPageContext/validateContextClient) and parity is asserted by
// test/unit/context.test.js over shared fixtures. No user secrets ever pass.

export const CONTEXT_VERSION = 1;
export const CONTEXT_SOURCE = 'vpn-assistant';
export const CONTEXT_PAGES = ['overview', 'market', 'provider-detail', 'downloads', 'wizard', 'selector', 'diagnostics'];
export const CONTEXT_PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'];
export const CONTEXT_STEP_RANGE = [1, 7];
export const QUESTION_MAX_LENGTH = 500;

// Field whitelist for `diagnostics` — intentionally EMPTY in 3B; Local Helper
// (3D) extends this list after the authorization design lands.
export const DIAGNOSTICS_WHITELIST = [];

const SECRET_KEY_PATTERN = /(password|passwd|secret|token|credential|apikey|api_key|subscription[-_ ]?key|private[-_ ]?key)/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Validate and normalize one page-context payload.
 * @param {object} raw raw client-supplied context (unknown keys ignored for forward compat)
 * @param {{ providers?: Array, software?: Array }} refs real data for reference checks
 * @returns {object} normalized context
 */
export function validateContext(raw, { providers = [], software = [] } = {}) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('INVALID_INPUT', 'context 必须是 JSON 对象');
  if (raw.version !== CONTEXT_VERSION) fail('INVALID_INPUT', 'context.version 必须是 ' + CONTEXT_VERSION);
  if (typeof raw.page !== 'string' || !CONTEXT_PAGES.includes(raw.page)) {
    fail('INVALID_INPUT', 'context.page 必须是 ' + CONTEXT_PAGES.join(' / '));
  }
  const out = {
    version: CONTEXT_VERSION,
    source: CONTEXT_SOURCE,
    page: raw.page,
    providerId: null,
    platform: null,
    step: null,
    softwareId: null,
    question: null,
    diagnostics: null,
  };

  if (raw.providerId !== undefined && raw.providerId !== null) {
    if (typeof raw.providerId !== 'string' || !raw.providerId) fail('INVALID_INPUT', 'providerId 必须是非空字符串');
    if (SECRET_KEY_PATTERN.test(raw.providerId)) fail('SECRET_REJECTED', 'providerId 疑似包含凭据内容');
    if (!providers.some((p) => p.provider_id === raw.providerId)) {
      fail('INVALID_INPUT', 'providerId 未出现在已核实服务商数据中：' + raw.providerId);
    }
    out.providerId = raw.providerId;
  }

  if (raw.platform !== undefined && raw.platform !== null) {
    if (!CONTEXT_PLATFORMS.includes(raw.platform)) {
      fail('INVALID_INPUT', 'platform 必须是 ' + CONTEXT_PLATFORMS.join(' / '));
    }
    out.platform = raw.platform;
  }

  if (raw.step !== undefined && raw.step !== null) {
    if (!Number.isInteger(raw.step) || raw.step < CONTEXT_STEP_RANGE[0] || raw.step > CONTEXT_STEP_RANGE[1]) {
      fail('INVALID_INPUT', 'step 必须是 ' + CONTEXT_STEP_RANGE[0] + '–' + CONTEXT_STEP_RANGE[1] + ' 的整数');
    }
    out.step = raw.step;
  }

  if (raw.softwareId !== undefined && raw.softwareId !== null) {
    if (typeof raw.softwareId !== 'string' || !raw.softwareId) fail('INVALID_INPUT', 'softwareId 必须是非空字符串');
    const record = software.find((s) => s.software_id === raw.softwareId);
    if (!record) fail('INVALID_INPUT', 'softwareId 未出现在已核实软件数据中：' + raw.softwareId);
    if (out.providerId && record.provider_id !== out.providerId) {
      fail('INVALID_INPUT', 'softwareId 与 providerId 不属于同一服务商');
    }
    out.softwareId = raw.softwareId;
    if (!out.providerId) out.providerId = record.provider_id;
  }

  if (raw.question !== undefined && raw.question !== null) {
    if (typeof raw.question !== 'string') fail('INVALID_INPUT', 'question 必须是字符串');
    if (raw.question.length > QUESTION_MAX_LENGTH) fail('INVALID_INPUT', 'question 超过 ' + QUESTION_MAX_LENGTH + ' 字符');
    const question = raw.question.trim();
    if (!question) fail('INVALID_INPUT', 'question 不能为空白');
    if (SECRET_KEY_PATTERN.test(question)) {
      fail('SECRET_REJECTED', 'question 疑似包含账号、密码或订阅密钥，本插件不接收任何凭据');
    }
    out.question = question;
  }

  if (raw.diagnostics !== undefined && raw.diagnostics !== null) {
    // Whitelist is empty in 3B: nothing is authorized yet.
    fail('DIAGNOSTICS_REJECTED', 'diagnostics 白名单为空（Local Helper 授权设计在 3D 交付），本版本不接收诊断数据');
  }

  return out;
}

/** Human-readable one-line summary used in answers and the handover modal. */
export function describeContext(context) {
  if (!context) return '';
  const parts = ['页面=' + context.page];
  if (context.providerId) parts.push('服务商=' + context.providerId);
  if (context.platform) parts.push('平台=' + context.platform);
  if (context.step) parts.push('步骤=' + context.step);
  if (context.softwareId) parts.push('软件=' + context.softwareId);
  return parts.join('，');
}
