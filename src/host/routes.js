// VPN Assistant host routes: ONE prefix route `/vpn-assistant` with internal
// dispatch, avoiding route-table collisions; one disposer on teardown.
// Read routes serve guarded data; the single write route enforces the same
// origin fence and a strict body whitelist.
import { guardProvider, guardSoftware } from './linkguard.js';
import { validateAssistPayload } from './assist.js';

const MAX_BODY = 32 * 1024;
const PREFIX = '/vpn-assistant';

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request body too large'), { code: 'INVALID_INPUT' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch {
        reject(Object.assign(new Error('invalid JSON body'), { code: 'INVALID_INPUT' }));
      }
    });
    req.on('error', reject);
  });
}

/** Same-origin trust fence (verified pattern from real plugins). */
function rejectedBy(ctx, req) {
  const connection = ctx.get('connection');
  if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req);
      if (rejection === undefined || rejection === null) return undefined;
      return typeof rejection === 'number' ? rejection : 403;
    } catch {
      return 403;
    }
  }
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return undefined;
  try {
    return new URL(origin).host === req.headers.host ? undefined : 403;
  } catch {
    return 403;
  }
}
// PART2_APPEND_POINT

import { validateContext } from './context.js';
import { createHelperService } from './helper.js';
import { readFile } from 'node:fs/promises';
const ILLUSTRATIONS = ['windows-install','macos-install','android-install','ios-install','download-failed','install-failed','client-missing','config-error'];

/**
 * Register the single prefix route. Returns a disposer.
 * @param {{ ctx: object, store: object, assist: object, model: object, skillsStatus: () => object }} deps
 */
export function registerRoutes({ ctx, store, assist, model, skillsStatus, recommend }) {
  const helper = createHelperService();
  async function handle(req, res) {
    const url = new URL(req.url, 'http://internal');
    const routePath = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    const parts = routePath.split('/').filter(Boolean); // e.g. ['api','providers']

    if (routePath === '/api/context') {
      if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', '仅接受 POST');
      if (rejectedBy(ctx, req) !== undefined) return fail(res, 403, 'FORBIDDEN', '同源校验失败');
      if (!String(req.headers['content-type']).startsWith('application/json')) return fail(res, 400, 'INVALID_INPUT', '需要 JSON');
      try {
        const body = await readBody(req);
        const [providers, software] = await Promise.all([store.providers(), store.software()]);
        return sendJson(res, 200, { ok: true, result: validateContext(body.context, { providers, software }) });
      } catch(e) { return fail(res, 400, e.code || 'INVALID_INPUT', e.message); }
    }
    if (routePath === '/api/helper') {
      if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', '仅接受 POST');
      const rejection = rejectedBy(ctx, req);
      // Explicit browser origin required even when the host connection service is absent.
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch {}
      if (rejection !== undefined || !sameOrigin) return fail(res, 403, 'FORBIDDEN', '需要同源浏览器请求');
      if (!String(req.headers['content-type']).startsWith('application/json')) return fail(res, 400, 'INVALID_INPUT', '需要 JSON');
      try { return sendJson(res, 200, { ok: true, result: await helper.request(req, await readBody(req)) }); }
      catch (e) { return fail(res, e.code === 'FORBIDDEN' ? 403 : e.code === 'BUSY' ? 409 : e.code === 'INVALID_INPUT' ? 400 : 503, e.code || 'HELPER_UNAVAILABLE', e.message); }
    }
    if (parts[0] === 'api' && parts[1] === 'illustrations') {
      const id = parts[2]?.replace(/\.svg$/, '');
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'METHOD_NOT_ALLOWED', '仅接受 GET/HEAD');
      if (parts.length !== 3 || !ILLUSTRATIONS.includes(id)) return fail(res, 404, 'NOT_FOUND', '未知示意图');
      const svg = await readFile(new URL('../../data/illustrations/' + id + '.svg', import.meta.url));
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
      return res.end(req.method === 'HEAD' ? undefined : svg);
    }
    // ---- write route: POST /api/assist ----
    if (parts[0] === 'api' && parts[1] === 'assist') {
      if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'assist 仅接受 POST');
      const rejection = rejectedBy(ctx, req);
      if (rejection !== undefined) return fail(res, rejection, 'FORBIDDEN', '同源校验未通过');
      const contentType = String(req.headers['content-type'] ?? '');
      if (!contentType.includes('application/json')) {
        return fail(res, 400, 'INVALID_INPUT', 'content-type 必须是 application/json');
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return fail(res, 400, error?.code ?? 'INVALID_INPUT', error?.message ?? String(error));
      }
      const validated = validateAssistPayload(body);
      if (validated.error) {
        const status = validated.error === 'MISSING_INPUT' || validated.error === 'SECRET_REJECTED' ? 400 : 400;
        return fail(res, status, validated.error, validated.message);
      }
      try {
        let context = null;
        if (body.context !== undefined) {
          const [providers, software] = await Promise.all([store.providers(), store.software()]);
          context = validateContext(body.context, { providers, software });
        }
        const result = await assist.run(validated.payload, context);
        return sendJson(res, 200, { ok: true, result });
      } catch (error) {
        if (error?.code === 'NOT_FOUND') return fail(res, 404, 'NOT_FOUND', error.message);
        if (error?.code === 'INVALID_INPUT' || error?.code === 'SECRET_REJECTED' || error?.code === 'DIAGNOSTICS_REJECTED') {
          return fail(res, 400, error.code, error.message);
        }
        return fail(res, 500, 'INTERNAL', error?.message ?? String(error));
      }
    }

    // ---- write route: POST /api/recommend (rule engine, no LLM) ----
    if (parts[0] === 'api' && parts[1] === 'recommend') {
      if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'recommend 仅接受 POST');
      const rejection = rejectedBy(ctx, req);
      if (rejection !== undefined) return fail(res, rejection, 'FORBIDDEN', '同源校验未通过');
      const contentType = String(req.headers['content-type'] ?? '');
      if (!contentType.includes('application/json')) {
        return fail(res, 400, 'INVALID_INPUT', 'content-type 必须是 application/json');
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return fail(res, 400, error?.code ?? 'INVALID_INPUT', error?.message ?? String(error));
      }
      try {
        const [providers, software] = await Promise.all([store.providers(), store.software()]);
        const result = recommend(body?.criteria ?? body ?? {}, providers, software);
        return sendJson(res, 200, { ok: true, result });
      } catch (error) {
        if (error?.code === 'INVALID_INPUT') return fail(res, 400, 'INVALID_INPUT', error.message);
        return fail(res, 500, 'INTERNAL', error?.message ?? String(error));
      }
    }

    if (parts[0] !== 'api') return fail(res, 404, 'NOT_FOUND', '未知路径：' + routePath);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return fail(res, 405, 'METHOD_NOT_ALLOWED', '只读接口，仅接受 GET/HEAD');
    }

    try {
      // ---- GET /api/status ----
      if (parts[1] === 'status') {
        const validation = await store.validate();
        return sendJson(res, 200, {
          ok: true,
          result: {
            plugin: 'vpn-assistant',
            data: validation,
            ai: { available: model.available, reason: model.reason, route: model.stats.route, stats: model.stats },
            skills: skillsStatus(),
          },
        });
      }
      // ---- GET /api/meta ----
      if (parts[1] === 'meta') {
        return sendJson(res, 200, { ok: true, result: await store.meta() });
      }
      // ---- GET /api/providers[/{id}] ----
      if (parts[1] === 'providers') {
        if (parts[2]) {
          const provider = await store.provider(parts[2]);
          if (!provider) return fail(res, 404, 'NOT_FOUND', '未知服务商：' + parts[2]);
          guardProvider(provider);
          return sendJson(res, 200, { ok: true, result: provider });
        }
        const providers = await store.providers();
        for (const provider of providers) guardProvider(provider);
        return sendJson(res, 200, { ok: true, result: providers });
      }
      // ---- GET /api/software ----
      if (parts[1] === 'software') {
        const [software, providers] = await Promise.all([store.software(), store.providers()]);
        const domainsByProvider = new Map(providers.map((p) => [p.provider_id, p.official_domains ?? []]));
        const result = software.map((s) => {
          const copy = JSON.parse(JSON.stringify(s));
          guardSoftware(copy, domainsByProvider.get(copy.provider_id) ?? []);
          return copy;
        });
        return sendJson(res, 200, { ok: true, result });
      }
      // ---- GET /api/tutorials ----
      if (parts[1] === 'tutorials') {
        const tutorials = await store.tutorials();
        const providerFilter = url.searchParams.get('provider');
        const platformFilter = url.searchParams.get('platform');
        const result = tutorials.filter((t) =>
          (!providerFilter || t.provider_id === providerFilter)
          && (!platformFilter || t.platform === platformFilter));
        return sendJson(res, 200, { ok: true, result });
      }
      return fail(res, 404, 'NOT_FOUND', '未知 API 路径：' + routePath);
    } catch (error) {
      if (error?.code === 'DATA_MISSING' || error?.code === 'DATA_INVALID') {
        return fail(res, 500, error.code, error.message);
      }
      return fail(res, 500, 'INTERNAL', error?.message ?? String(error));
    }
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => { Promise.resolve(handle(req, res)).catch((error) => {
      try { fail(res, 500, 'INTERNAL', error?.message ?? String(error)); } catch { /* socket gone */ }
    }); },
  });
  return () => { helper.dispose(); if (typeof dispose === 'function') dispose(); };
}

