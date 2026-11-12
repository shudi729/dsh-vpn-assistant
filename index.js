// VPN Assistant host half entry.
// Declarative `inject` (verified form from real plugins): waits for webServer.
// Skills and the model service are awaited lazily via ctx.inject — DSH
// services may mount AFTER apply().
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStore } from './src/host/store.js';
import { createModel } from './src/host/model.js';
import { createAssist } from './src/host/assist.js';
import { buildSkillRegistrations, registerSkills, SKILL_GROUPS } from './src/host/skills.js';
import { registerRoutes } from './src/host/routes.js';
import { recommend } from './src/host/selector.js';

const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));

export const inject = ['webServer'];

export function apply(ctx) {
  const store = new DataStore(process.env.VP_DATA_DIR ? path.resolve(process.env.VP_DATA_DIR) : DATA_DIR);
  const model = createModel(ctx);
  const assist = createAssist({ store, model });
  const skillState = { registrations: null, handle: null, failures: [], registered: 0, error: null };

  const skillsStatus = () => ({
    expected: 9,
    registered: skillState.registered,
    failures: skillState.failures,
    error: skillState.error,
    names: (skillState.registrations ?? []).map((s) => s.name),
    groups: SKILL_GROUPS,
  });

  // Skills: wait for the real skills service, then register runtime skills.
  ctx.inject(['skills'], (skillCtx) => {
    let active = true;
    Promise.resolve()
      .then(async () => {
        skillState.registrations = await buildSkillRegistrations(store);
      })
      .then(() => {
        if (!active) return;
        const result = registerSkills(skillCtx, skillState.registrations ?? []);
        skillState.handle = result;
        skillState.registered = result.registered;
        skillState.failures = result.failures;
      })
      .catch((error) => {
        skillState.error = error?.message ?? String(error);
        console.warn('[vpn-assistant] skill registration failed:', skillState.error);
      });
    return function skillsGone() {
      active = false;
      try { skillState.handle?.dispose?.(); } catch { /* teardown race */ }
      skillState.handle = null;
      skillState.registered = 0;
      skillState.failures = [];
    };
  });

  // Model service: attach its context when mounted so lazy calls can find it.
  ctx.inject(['llm'], (llmCtx) => {
    model.attach(llmCtx);
  });

  return applyRoutes(ctx, { store, assist, model, skillsStatus, recommend });
}
// PART2_APPEND_POINT

function applyRoutes(ctx, deps) {
  ctx.effect(function routes() {
    return registerRoutes({ ctx, ...deps });
  }, 'vpn-assistant:routes');
}

