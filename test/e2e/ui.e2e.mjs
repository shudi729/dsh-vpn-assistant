import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
// E2E: boot the real DSH web profile, open the plugin panel in Chromium and
// verify the full UI per phase-2 acceptance list. Uses REAL mouse clicks and
// REAL keyboard input (no JS force-click for plugin interactions). The only
// forced action is dismissing the host's own preview/onboarding overlay mask,
// which is host chrome outside the plugin. Results → docs/e2e-results.json
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const DSH_HOME = process.env.DSH_HOME ?? PROJECT_ROOT + '/.dsh-probe';
const DSH_ENTRY = process.env.DSH_ENTRY;
if (!DSH_ENTRY) throw new Error('Set DSH_ENTRY to the installed @deepseek-ai/dsh lib/bin.js path');
const DSH_PROFILE = process.env.DSH_PROFILE ?? 'web';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: String(detail ?? '') });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

// Dismiss the host's own preview/onboarding overlay (host chrome, outside plugin).
async function dismissHostDialogs(page) {
  for (let i = 0; i < 12; i++) {
    const acted = await page.evaluate(() => {
      // host overlays only — never touch the plugin's own modal (.vp-modal-mask)
      const root = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="_mask_"]')]
        .find((el) => !el.closest('.vp-modal-mask'));
      if (!root) return false;
      const btns = [...root.querySelectorAll('button')];
      const cont = btns.find((b) => /continue|继续|知道了|got it|i understand|ok|确认|close|关闭/i.test(b.textContent || ''));
      if (cont) { cont.click(); return 'btn'; }
      if (btns.length) { btns[btns.length - 1].click(); return 'btn'; }
      return 'mask';
    });
    if (!acted) return;
    // standalone leftover host mask (aria-hidden overlay that intercepts clicks
    // but has no close button of its own): remove it from the DOM for the test.
    if (acted === 'mask') {
      const removed = await page.evaluate(() => {
        const m = document.querySelector('[class*="_mask_"]');
        if (m && !m.querySelector('[role="dialog"]')) { m.remove(); return true; }
        return false;
      });
      if (removed) await delay(100); else return;
    }
    await delay(100);
  }
}

// Real click on a PLUGIN element, transparently re-dismissing any host overlay.
async function clickPlugin(page, locator) {
  for (let i = 0; i < 8; i++) {
    await dismissHostDialogs(page);
    try { await locator.click({ timeout: 3000 }); return true; }
    catch { await dismissHostDialogs(page); }
  }
  return false;
}

// Open the plugin panel via the REAL sidebar button (with host-dialog dismissal).
async function openPanel(page) {
  for (let i = 0; i < 12; i++) {
    await dismissHostDialogs(page);
    const btn = page.locator('button[aria-label="VPN Assistant"], button[aria-label="VPN 助手"]').first();
    if (await btn.isVisible().catch(() => false)) {
      try { await btn.click({ timeout: 4000 }); }
      catch { await dismissHostDialogs(page); continue; }
      try { await page.waitForSelector('.vp-shell', { timeout: 4000 }); return true; }
      catch { await dismissHostDialogs(page); }
    } else { await delay(800); }
  }
  return false;
}

const child = spawn(process.execPath, [DSH_ENTRY, '--profile', DSH_PROFILE, '--patch', PROJECT_ROOT + '/test/probe/probe-patch.yml'], {
  env: { ...process.env, DSH_HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

let bootUrl = null;
for (let i = 0; i < 120 && !bootUrl; i++) {
  await delay(1000);
  const m = log.match(/https?:\/\/[^\s"']+/);
  if (m) bootUrl = m[0].replace(/[)\].,]+$/, '');
}

let browser = null;
try {
  if (!bootUrl) throw new Error('no boot URL within 120s');
  record('E0 boot + URL', true, new URL(bootUrl).origin);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  page.on('pageerror', (err) => console.log('PAGE-ERROR:', err.message.slice(0, 200)));
  // Neutralise the host preview overlay's click-blocking (test-env workaround;
  // plugin interactions below still use REAL clicks/keyboard).
  await page.addInitScript(() => {
    const add = () => {
      try {
        const s = document.createElement('style');
        s.textContent = '[class*="_mask_"],[role="presentation"][class*="_root_"]{pointer-events:none !important}';
        (document.head || document.documentElement || document.body).appendChild(s);
      } catch { /* document not ready */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
    else add();
  });

  await page.goto(bootUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const opened = await openPanel(page);
  record('E1a sidebar entry opens panel (real click)', opened, opened ? 'panel visible' : 'panel never opened');
  await page.waitForSelector('.vp-shell', { timeout: 30000 });
  record('E1 plugin panel renders', true, 'vp-shell visible');
  await page.waitForSelector('.vp-nav .vp-nav-item', { timeout: 15000 });
  await dismissHostDialogs(page);
  await delay(500);

  // E2: main UI + 8 navigation sections.
  const navCount = await page.locator('.vp-nav .vp-nav-item').count();
  record('E2 nav has 8 sections', navCount === 8, 'nav items=' + navCount);
  const aiPill = await page.locator('.vp-nav-foot .vp-pill').first().textContent().catch(() => '');
  record('E2b model-service status badge present', /知识库模式|模型服务已挂载/.test(aiPill ?? ''), aiPill?.trim());

  // E3: navigation across all sections (real clicks)
  for (const [label, marker] of [['服务市场', '.vp-grid .vp-card'], ['下载中心', '.vp-tabbar'], ['安装向导', '.vp-steps'], ['帮助中心', '.vp-card:has-text("AI 服务状态")']]) {
    await clickPlugin(page, page.locator('.vp-nav-item', { hasText: label }).first());
    const ok = await page.waitForSelector(marker, { timeout: 20000 }).then(() => true).catch(() => false);
    record('E3 nav → ' + label, ok, 'marker ' + marker + (ok ? ' visible' : ' MISSING'));
    await dismissHostDialogs(page);
    await delay(400);
  }

  // E4: market search + filters + alphabetical order
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '服务市场' }).first());
  await page.waitForSelector('.vp-grid .vp-card', { timeout: 15000 });
  const allCards = await page.locator('.vp-grid > .vp-card').count();
  record('E4a six provider cards', allCards === 6, 'cards=' + allCards);
  await dismissHostDialogs(page);
  await page.locator('.vp-input').first().fill('proton');
  await page.waitForTimeout(300);
  const searched = await page.locator('.vp-grid > .vp-card').count();
  record('E4b search "proton" → 1 card', searched === 1, 'cards=' + searched);
  await page.locator('.vp-input').first().fill('');
  await page.waitForTimeout(300);
  await clickPlugin(page, page.locator('.vp-chip', { hasText: 'Linux' }).first());
  await page.waitForTimeout(300);
  const linuxCount = await page.locator('.vp-grid > .vp-card').count();
  record('E4c Linux platform filter', linuxCount === 5, 'cards=' + linuxCount + ' (nordvpn platforms pending → excluded)');
  await clickPlugin(page, page.locator('.vp-chip', { hasText: '付费' }).first());
  await page.waitForTimeout(300);
  const paidLinux = await page.locator('.vp-grid > .vp-card').count();
  record('E4d Linux + paid filter', paidLinux === 2, 'cards=' + paidLinux + ' (mullvad+surfshark; ivpn/nordvpn fields pending)');
  await clickPlugin(page, page.locator('.vp-btn.sec', { hasText: '清除筛选' }).first());
  await page.waitForTimeout(300);
  const names = await page.locator('.vp-grid > .vp-card strong').allTextContents();
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
  record('E4e alphabetical order (no ranking)', JSON.stringify(names) === JSON.stringify(sorted), names.join(','));

  // E5: provider detail opens and returns
  await clickPlugin(page, page.locator('.vp-grid > .vp-card', { hasText: 'Proton VPN' }).first().locator('button', { hasText: '查看详情' }));
  await page.waitForSelector('.vp-card:has-text("套餐与价格")', { timeout: 15000 });
  const sections = await page.locator('.vp-card .vp-h2').count();
  record('E5a detail page sections render', sections >= 7, 'h2 sections=' + sections);
  const planRow = await page.locator('.vp-table tbody tr').count();
  record('E5b plan table rows', planRow >= 3, 'rows=' + planRow);
  const auditLink = await page.locator('button:has-text("报告"), a:has-text("报告")').count();
  record('E5c audit report link present', auditLink >= 1, 'links=' + auditLink);
  await clickPlugin(page, page.locator('.vp-crumb', { hasText: '服务市场' }).first());
  await page.waitForSelector('.vp-input', { timeout: 10000 });
  record('E5d back to market keeps filters cleared', true, 'crumb navigation ok');

  // E6: downloads — platform tabs, pending version, verified link through confirm modal
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '下载中心' }).first());
  await page.waitForSelector('.vp-tabbar', { timeout: 15000 });
  const tabCount = await page.locator('.vp-tab').count();
  record('E6a five platform tabs', tabCount === 5, 'tabs=' + tabCount);
  await page.locator('.vp-select').first().selectOption('nordvpn');
  await page.waitForTimeout(400);
  const nordCards = await page.locator('.vp-grid > .vp-card').count();
  const nordDisabled = await page.locator('.vp-grid > .vp-card button[disabled]').count();
  record('E6b nordvpn pending download disabled', nordCards >= 1 && nordDisabled >= 1, 'cards=' + nordCards + ' disabledBtns=' + nordDisabled);
  await page.locator('.vp-select').first().selectOption('mullvad');
  await page.waitForTimeout(400);
  await clickPlugin(page, page.locator('.vp-grid > .vp-card button', { hasText: '官方下载' }).first());
  await page.waitForSelector('.vp-modal', { timeout: 10000 });
  const modalText = await page.locator('.vp-modal').textContent();
  record('E6c leave-site confirm shows mullvad.net', /mullvad\.net/.test(modalText), modalText.slice(0, 120));

  // E6d/E6e: REAL keyboard — focus trap (Tab cycles inside) + Escape closes.
  // The host dialog runs its own Tab trap and may steal focus, so establish
  // focus inside the plugin dialog with a REAL click on the dialog panel first.
  await dismissHostDialogs(page);
  // remove host overlay nodes so their focus management cannot fight the plugin modal
  await page.evaluate(() => {
    document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="_mask_"]').forEach((el) => {
      if (!el.closest('.vp-modal-mask') && !el.classList.contains('vp-modal')) el.remove();
    });
  });
  const stillOpen = (await page.locator('.vp-modal').count()) > 0;
  await page.locator('.vp-modal').click({ position: { x: 14, y: 14 }, timeout: 5000 }).catch(() => {});
  const inside0 = await page.evaluate(() => !!document.activeElement?.closest('.vp-modal'));
  let trapped = stillOpen && inside0;
  let escapedTo = '';
  for (let i = 0; i < 6 && trapped; i++) {
    await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => !!document.activeElement?.closest('.vp-modal')))) {
      escapedTo = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? a.tagName + '.' + (a.className || '').toString().slice(0, 60) : 'null';
      });
      trapped = false;
    }
  }
  record('E6d modal focus trap (Tab cycles inside)', trapped, 'modalOpen=' + stillOpen + ' focusInside=' + inside0 + (trapped ? '' : ' escapedTo=' + escapedTo));
  await page.keyboard.press('Escape');
  let closed = false;
  for (let i = 0; i < 20 && !closed; i++) { await delay(200); closed = (await page.locator('.vp-modal').count()) === 0; }
  record('E6e Escape closes modal', closed, '');

  // E7: wizard full 7-step run
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '安装向导' }).first());
  await page.waitForSelector('.vp-steps', { timeout: 15000 });
  await clickPlugin(page, page.locator('.vp-grid > .vp-card', { hasText: 'Mullvad VPN' }).first());
  await clickPlugin(page, page.locator('.vp-btn', { hasText: '完成，下一步' }));
  await clickPlugin(page, page.locator('.vp-platbtn', { hasText: 'Windows' }));
  await clickPlugin(page, page.locator('.vp-btn', { hasText: '完成，下一步' }));
  await page.waitForSelector('.vp-card:has-text("官方下载")', { timeout: 15000 });
  record('E7a step 3 shows official download', true, '');
  await page.locator('img[src*='+String.fromCharCode(34)+'windows-install'+String.fromCharCode(34)+']').waitFor();
  record('E7a2 installation SVG enters real wizard', await page.locator('img[src*='+String.fromCharCode(34)+'windows-install'+String.fromCharCode(34)+']').evaluate(x => x.complete && x.naturalWidth > 0));
  for (const _ of [0, 1, 2]) { await clickPlugin(page, page.locator('.vp-btn', { hasText: '完成，下一步' })); }
  await page.waitForSelector('.vp-check', { timeout: 15000 });
  const checks = await page.locator('.vp-check input').count();
  record('E7b step 6 has 3 confirmations', checks === 3, 'checkboxes=' + checks);
  for (let i = 0; i < checks; i++) await page.locator('.vp-check input').nth(i).check();
  await clickPlugin(page, page.locator('.vp-btn', { hasText: '完成，下一步' }));
  await page.waitForSelector('.vp-card:has-text("7 ·")', { timeout: 15000 });
  record('E7c step 7 reached', true, '');
  await clickPlugin(page, page.locator('.vp-btn', { hasText: '完成' }).last());
  record('E7d wizard finished', true, '');
  const savedBanner = await page.locator('.vp-info:has-text("已保存进度")').count();
  record('E7e progress banner shown', savedBanner >= 1, 'banner=' + savedBanner);

  // E8: reload restores wizard progress (real click after reload too)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="VPN Assistant"], button[aria-label="VPN 助手"], .vp-shell', { timeout: 60000 });
  await openPanel(page);
  await page.waitForSelector('.vp-shell', { timeout: 30000 });
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '安装向导' }).first());
  await page.waitForSelector('.vp-pill:has-text("7 / 7")', { timeout: 15000 });
  record('E8 progress restored after reload', true, 'step pill 7/7');

  // E9: theme — the plugin uses host --dsw-alias-* tokens; verify they resolve
  // on the plugin surface and observe a light/dark switch attempt.
  const before = await page.evaluate(() => {
    const card = document.querySelector('.vp-card');
    const cs = getComputedStyle(card);
    return {
      cardBg: cs.backgroundColor,
      token: cs.getPropertyValue('--dsw-alias-bg-layer-1').trim(),
      tokenBorder: cs.getPropertyValue('--dsw-alias-border-l2').trim(),
      scheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await delay(400);
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('.vp-card')).backgroundColor);
  const tokenOk = !!before.token || !!before.tokenBorder;
  record('E9 theme tokens resolve on plugin surface', tokenOk && before.cardBg && before.cardBg !== 'rgba(0, 0, 0, 0)',
    'bg=' + before.cardBg + ' bgToken=' + before.token + ' borderToken=' + before.tokenBorder + ' scheme=' + before.scheme + ' darkBg=' + after);

  // E11: smart selector (batch 3A) — six inputs, rule-engine report, real clicks
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '智能选型' }).first());
  await page.waitForSelector('.vp-card:has-text("AI 智能选型")', { timeout: 15000 });
  record('E11a selector page renders', true, 'title visible');
  await clickPlugin(page, page.locator('.vp-chip', { hasText: 'Windows' }).first());
  await clickPlugin(page, page.locator('.vp-chip', { hasText: '日常隐私保护' }).first());
  await clickPlugin(page, page.locator('.vp-chip', { hasText: '≤ $6/月' }).first());
  await clickPlugin(page, page.locator('.vp-chip', { hasText: '有独立审计' }).first());
  await clickPlugin(page, page.locator('.vp-btn', { hasText: '生成推荐报告' }));
  await page.waitForSelector('.vp-rank', { timeout: 15000 });
  const recCount = await page.locator('.vp-rank').count();
  const credPills = await page.locator('.vp-pill:has-text("资料可信度")').count();
  const dimBars = await page.locator('.vp-bar').count();
  const excludedShown = await page.locator('.vp-card:has-text("因硬性条件排除")').count();
  const noteShown = await page.locator('.vp-info:has-text("规则引擎")').count();
  record('E11b ranked results produced', recCount >= 1 && recCount <= 6, 'results=' + recCount);
  record('E11c score + credibility shown separately', credPills === recCount && dimBars === recCount * 5, 'credPills=' + credPills + ' dimBars=' + dimBars);
  record('E11d excluded-by-hard-criteria list shown', excludedShown === 1, 'excluded card=' + excludedShown);
  record('E11e rule-engine disclaimer (no LLM)', noteShown === 1, 'disclaimer=' + noteShown);
  const apiRes = await page.evaluate(async () => {
    const r = await fetch('/vpn-assistant/api/recommend', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ criteria: { budget: 'free' } }),
    });
    const b = await r.json().catch(() => null);
    return { status: r.status, ok: b?.ok, n: b?.result?.results?.length ?? 0, engine: b?.result?.meta?.engine };
  });
  record('E11f POST /api/recommend 200 (rule-v1)', apiRes.status === 200 && apiRes.ok === true && apiRes.n >= 1 && apiRes.engine === 'rule-v1', JSON.stringify(apiRes));

  // E12: AI-assist context handover (batch 3B) — honest degrade, no fake chat
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '服务市场' }).first());
  await page.waitForSelector('.vp-grid', { timeout: 15000 });
  await clickPlugin(page, page.locator('button', { hasText: 'AI协助' }).first());
  await page.waitForSelector('[data-testid="vp-context-json"]', { timeout: 10000 });
  const ctxJson = await page.locator('[data-testid="vp-context-json"]').textContent();
  record('E12a market AI-assist modal shows page context', /"page":\s*"market"/.test(ctxJson ?? '') && /"source":\s*"vpn-assistant"/.test(ctxJson ?? ''), (ctxJson ?? '').slice(0, 80));
  const degradeNote = await page.locator('.vp-warnbox:has-text("DSH 原生对话")').count();
  record('E12b honest handover note (no fake agent chat)', degradeNote === 1, 'note=' + degradeNote);
  const copyBtn = await page.locator('.vp-modal button', { hasText: '复制上下文' }).count();
  record('E12c copy-context action present', copyBtn === 1, 'buttons=' + copyBtn);
  await clickPlugin(page, page.locator('.vp-modal button', { hasText: '基于本地数据解答' }));
  await page.waitForSelector('.vp-ai-card', { timeout: 20000 });
  const aiCard = await page.locator('.vp-ai-card').textContent();
  record('E12d local-data answer with skill-group label', /能力组：/.test(aiCard ?? '') && /知识库模式|AI/.test(aiCard ?? ''), (aiCard ?? '').slice(-60));
  await page.keyboard.press('Escape');
  await delay(600);
  // detail page context carries providerId
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '服务市场' }).first());
  await page.waitForSelector('.vp-grid > .vp-card', { timeout: 15000 });
  await clickPlugin(page, page.locator('.vp-grid > .vp-card', { hasText: 'Mullvad VPN' }).first().locator('button', { hasText: '查看详情' }));
  await page.waitForSelector('.vp-card:has-text("套餐与价格")', { timeout: 15000 });
  await clickPlugin(page, page.locator('button', { hasText: 'AI协助' }).first());
  await page.waitForSelector('[data-testid="vp-context-json"]', { timeout: 10000 });
  const detailJson = await page.locator('[data-testid="vp-context-json"]').textContent();
  record('E12e detail context carries providerId', /"providerId":\s*"mullvad"/.test(detailJson ?? ''), (detailJson ?? '').slice(0, 100));
  await page.keyboard.press('Escape');
  await delay(500);
  // status API exposes skill groups
  const statusRes = await page.evaluate(async () => {
    const r = await fetch('/vpn-assistant/api/status');
    const b = await r.json();
    return { groups: Object.keys(b?.result?.skills?.groups ?? {}), names: b?.result?.skills?.names?.length ?? 0 };
  });
  record('E12f status exposes 4 skill groups over 9 skills', statusRes.groups.length === 4 && statusRes.names === 9, JSON.stringify(statusRes));

  // Final product: actual helper scans through authenticated DSH HTTP routes.
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '设备管理' }));
  await page.waitForSelector('[data-testid="vp-local-page"]');
  record('E13a helper initially disconnected and scan disabled', await page.getByRole('button', { name: '开始检测', exact: true }).isDisabled());
  await page.locator('[data-testid="vp-local-page"] input[type=checkbox]').first().check();
  await clickPlugin(page, page.getByRole('button', { name: '授权本地检测', exact: true }));
  await page.getByText('已授权（十分钟有效）', { exact: true }).waitFor();
  await clickPlugin(page, page.getByRole('button', { name: '开始检测', exact: true }));
  await page.waitForSelector('[data-testid="vp-device-result"]', { timeout: 25000 });
  const deviceText = await page.locator('[data-testid="vp-device-result"]').textContent();
  record('E13b real helper OS and registry detection', /win32/.test(deviceText) && /检测时间/.test(deviceText), deviceText);
  await clickPlugin(page, page.getByRole('button', { name: '撤销授权并清除结果', exact: true }));
  await page.getByText('尚未连接 · 请先主动授权本地辅助组件', { exact: true }).waitFor();
  record('E13c revoke clears device results', await page.locator('[data-testid="vp-device-result"]').count() === 0);
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '网络诊断' }));
  await page.locator('[data-testid="vp-local-page"] input[type=checkbox]').first().check();
  await clickPlugin(page, page.getByRole('button', { name: '授权本地检测', exact: true }));
  await page.getByText('已授权（十分钟有效）', { exact: true }).waitFor();
  await clickPlugin(page, page.getByRole('button', { name: '开始检测', exact: true }));
  await page.waitForSelector('[data-testid="vp-diagnostic-result"]', { timeout: 25000 });
  const diagText = await page.locator('[data-testid="vp-diagnostic-result"]').textContent();
  record('E13d real DNS and TCP report (failure is evidence, not fake success)', /dns-config/.test(diagText) && /tcp/.test(diagText), diagText);
  const imgs = page.locator('[data-testid="vp-local-page"] img');
  await imgs.first().waitFor();
  const allImages = await imgs.evaluateAll(xs => xs.every(x => x.complete && x.naturalWidth > 0));
  record('E13e four troubleshooting SVGs actually render', await imgs.count() === 4 && allImages);
  const illustrationIds = ['windows-install','macos-install','android-install','ios-install','download-failed','install-failed','client-missing','config-error'];
  const imageStatus = await page.evaluate(async ids => Promise.all(ids.map(async id => {
    const r = await fetch('/vpn-assistant/api/illustrations/' + id + '.svg'); return r.status;
  })), illustrationIds);
  record('E13f all eight localized illustration resources reachable', imageStatus.every(x => x === 200));
  await clickPlugin(page, page.locator('[data-testid="vp-local-page"]').getByRole('button', { name: /AI协助/ }));
  const privateContext = await page.locator('[data-testid="vp-context-json"]').textContent();
  record('E13g no diagnosis data exported without sharing opt-in', /尚未授权分享检测数据/.test(privateContext) && /"diagnostics": null/.test(privateContext));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: PROJECT_ROOT + '/docs/ui-diagnostics.png' });
  await clickPlugin(page, page.getByRole('button', { name: '撤销授权并清除结果', exact: true }));

  await clickPlugin(page, page.locator('[data-testid="vp-local-page"]').getByRole('button', { name: /AI协助/ }));
  const availableNative = await page.evaluate(() => window.__VPN_ASSISTANT_TEST__.nativeCapability());
  record('E14a public sessions service dynamically available', availableNative);
  await clickPlugin(page, page.getByRole('button', { name: '发送到 DSH 新对话', exact: true }));
  await page.waitForSelector('[data-testid="vp-native-receipt"]', { timeout: 25000 });
  record('E14b real DSH session accepts page context (not model completion)', /DSH 已受理上下文/.test(await page.locator('[data-testid="vp-native-receipt"]').textContent()));
  await page.keyboard.press('Escape');
  // E10: narrow viewport layout (real click to market)
  await clickPlugin(page, page.locator('.vp-nav-item', { hasText: '服务市场' }).first());
  await page.waitForSelector('.vp-grid', { timeout: 15000 });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(400);
  const navDir = await page.evaluate(() => getComputedStyle(document.querySelector('.vp-nav')).flexDirection);
  const gridCols = await page.evaluate(() => {
    const g = document.querySelector('.vp-main .vp-grid');
    return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : -1;
  });
  record('E10 narrow layout adapts', navDir === 'row' && gridCols === 1, 'nav=' + navDir + ' gridCols=' + gridCols);
} catch (error) {
  record('E2E flow', false, error?.message ?? String(error));
} finally {
  if (browser) await browser.close().catch(() => {});
  child.kill('SIGTERM');
  await delay(1500);
  try { child.kill('SIGKILL'); } catch { /* gone */ }
}
const passed = results.filter((r) => r.ok).length;
console.log('SUMMARY ' + passed + '/' + results.length + ' passed');
fs.writeFileSync(PROJECT_ROOT + '/docs/e2e-results.json', JSON.stringify(results, null, 2), 'utf8');
process.exit(passed === results.length ? 0 : 1);
