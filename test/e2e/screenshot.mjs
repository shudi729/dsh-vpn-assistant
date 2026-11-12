// Screenshot the refreshed overview page (kept as a visual regression aid)
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const DSH_HOME = process.env.DSH_HOME ?? PROJECT_ROOT + '/.dsh-probe';
const DSH_ENTRY = process.env.DSH_ENTRY;
if (!DSH_ENTRY) throw new Error('Set DSH_ENTRY to the installed @deepseek-ai/dsh lib/bin.js path');
const child = spawn(process.execPath, [DSH_ENTRY, '--profile', 'web', '--patch', PROJECT_ROOT + '/test/probe/probe-patch.yml'], {
  env: { ...process.env, DSH_HOME }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });
let url = null;
for (let i = 0; i < 120 && !url; i++) { await delay(1000); const m = log.match(/https?:\/\/[^\s"']+/); if (m) url = m[0].replace(/[)\].,]+$/, ''); }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Number(process.env.SHOT_W ?? 1440), height: Number(process.env.SHOT_H ?? 800) }, locale: 'zh-CN' });
await page.addInitScript(() => {
  const add = () => { try {
    const s = document.createElement('style');
    s.textContent = '[class*="_mask_"],[role="presentation"][class*="_root_"]{display:none !important}';
    (document.head || document.documentElement || document.body).appendChild(s);
  } catch { /* */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await delay(2500);
await page.locator('button[aria-label="VPN Assistant"], button[aria-label="VPN 智能助手"], button[aria-label="VPN 助手"]').first().click({ timeout: 10000 });
await page.waitForSelector('.vp-shell', { timeout: 15000 });
await delay(1200);
await page.screenshot({ path: PROJECT_ROOT + '/docs/ui-overview.png' });
// market page too
await page.locator('.vp-nav-item', { hasText: '服务市场' }).first().click();
await page.waitForSelector('.vp-grid .vp-card', { timeout: 15000 });
await delay(600);
await page.screenshot({ path: PROJECT_ROOT + '/docs/ui-market.png' });
// selector page with a generated report
await page.locator('.vp-nav-item', { hasText: '智能选型' }).first().click();
await page.waitForSelector('.vp-card:has-text("AI 智能选型")', { timeout: 15000 });
await page.locator('.vp-chip', { hasText: 'Windows' }).first().click();
await page.locator('.vp-chip', { hasText: '日常隐私保护' }).first().click();
await page.locator('.vp-chip', { hasText: '≤ $6/月' }).first().click();
await page.locator('.vp-btn', { hasText: '生成推荐报告' }).click();
await page.waitForSelector('.vp-rank', { timeout: 15000 });
await page.screenshot({ path: PROJECT_ROOT + '/docs/ui-selector.png', fullPage: true });
console.log('screenshots saved');
await browser.close();
child.kill('SIGKILL');
process.exit(0);
