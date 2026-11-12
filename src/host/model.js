/**
 * DSH model adapter — reuse the running profile's `llm` service; no second
 * model stack, no credential access.
 *
 * Call signature verified against @deepseek-ai/dsh-llm 0.2.1-rc.5 types and
 * the real enterprise-expert-workspace adapter:
 *   llm.stream({ provider, model, messages, system, maxTokens, signal })
 *   → async iterable: {type:'text-delta',text} | {type:'finish',reason} | error forms.
 *
 * `ctx.llm` may mount AFTER apply(); every call resolves it lazily.
 */
const DEFAULT_PROVIDER = 'deepseek-official';

export function createModel(ctx) {
  const contexts = [ctx];
  const state = {
    lastError: null,
    route: null,
    providers: null,
    source: null,
    calls: 0,
    failures: 0,
    lastSuccessAt: null,
  };

  const getLlm = () => {
    for (const candidate of contexts) {
      try {
        const direct = candidate?.llm;
        if (direct && typeof direct.stream === 'function') return direct;
        const viaGet = candidate?.get?.('llm');
        if (viaGet && typeof viaGet.stream === 'function') return viaGet;
      } catch { /* try next injected context */ }
    }
    return null;
  };

  function discoverRoute(llm) {
    if (state.route) return state.route;
    let provider = process.env.VP_MODEL_PROVIDER || null;
    let model = process.env.VP_MODEL_NAME || null;
    let reasoningEffort = null;
    let source = 'environment';
    try {
      const selection = ctx?.agentDefaultModel?.currentSelection?.()
        ?? ctx?.get?.('agentDefaultModel')?.currentSelection?.();
      if (selection?.provider && selection?.model) {
        provider = provider ?? selection.provider;
        model = model ?? selection.model;
        reasoningEffort = selection.reasoningEffort ?? null;
        source = 'dsh-agent-default-model';
      }
    } catch { /* fall through */ }
    try {
      if (typeof llm?.listProviders === 'function') {
        const providers = llm.listProviders();
        state.providers = providers.map((item) => item?.id ?? item?.name).filter(Boolean);
        if (!provider || (state.providers.length > 0 && !state.providers.includes(provider))) {
          provider = state.providers[0] ?? provider ?? DEFAULT_PROVIDER;
          source = 'llm.listProviders';
        }
      }
    } catch { /* best effort */ }
    state.route = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
    state.source = source;
    return state.route;
  }

  return {
    attach(extra) { if (extra && !contexts.includes(extra)) contexts.push(extra); },
    get available() { return typeof getLlm()?.stream === 'function'; },
    get reason() {
      return this.available ? null : 'DSH llm 服务尚未挂载（需 dsh-base 组合、模型适配器与可用凭据）';
    },
    get route() {
      const llm = getLlm();
      return llm ? discoverRoute(llm) : null;
    },
    get stats() {
      return {
        calls: state.calls, failures: state.failures, lastError: state.lastError,
        lastSuccessAt: state.lastSuccessAt, source: state.source,
        route: state.route, providers: state.providers,
      };
    },
    async complete(options) {
      return completeCall(this, state, getLlm, discoverRoute, options ?? {});
    },
  };
}

/**
 * Run one real llm.stream() call and accumulate text deltas.
 * Never fabricates output: throws with the true failure reason.
 */
async function completeCall(api, state, getLlm, discoverRoute, { system, prompt, maxTokens = 1200, signal } = {}) {
  const llm = getLlm();
  if (!llm || typeof llm.stream !== 'function') {
    state.failures += 1;
    state.lastError = 'DSH llm 服务未挂载';
    const error = new Error('DSH 模型调用失败：' + state.lastError);
    error.code = 'LLM_UNAVAILABLE';
    throw error;
  }
  const route = discoverRoute(llm);
  state.calls += 1;
  const options = {
    provider: route.provider,
    model: route.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: String(prompt ?? '') }] }],
    system: String(system ?? ''),
    maxTokens,
    ...(signal ? { signal } : {}),
  };
  const parts = [];
  let termination = null;
  const chunkTypes = [];
  try {
    const stream = await llm.stream(options);
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
      throw new Error('llm.stream 未返回可迭代流');
    }
    for await (const chunk of stream) {
      if (chunk?.type && !chunkTypes.includes(chunk.type)) chunkTypes.push(chunk.type);
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text);
      else if (chunk?.type === 'finish') termination = chunk.reason ?? 'finish';
      else if (chunk?.type === 'error') termination = chunk;
      else if (chunk?.kind === 'error' || chunk?.kind === 'aborted') termination = chunk;
    }
  } catch (error) {
    state.failures += 1;
    state.lastError = error?.message ?? String(error);
    const wrapped = new Error('DSH 模型调用失败：' + state.lastError);
    wrapped.code = error?.code === 'LLM_UNAVAILABLE' ? 'LLM_UNAVAILABLE' : 'LLM_ERROR';
    throw wrapped;
  }
  const text = parts.join('').trim();
  if (!text) {
    state.failures += 1;
    const reason = typeof termination === 'string'
      ? termination
      : (termination?.failure?.code ?? termination?.code ?? termination?.error?.code
        ?? JSON.stringify(termination)?.slice(0, 220) ?? 'unknown');
    state.lastError = '模型未返回正文（终止原因=' + reason + '；分片类型=' + (chunkTypes.join(',') || 'none')
      + '）；常见原因：缺少凭据 MISSING_CREDENTIAL、路由未注册 NO_ADAPTER、网络/鉴权失败';
    const wrapped = new Error('DSH 模型调用失败：' + state.lastError);
    wrapped.code = 'LLM_ERROR';
    throw wrapped;
  }
  state.lastError = null;
  state.lastSuccessAt = new Date().toISOString();
  return text;
}

/** Marker so assist.js can distinguish unavailable vs failed calls. */
export const MODEL_ERRORS = { UNAVAILABLE: 'LLM_UNAVAILABLE' };
