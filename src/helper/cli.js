// One authenticated request over private inherited stdio; no listening socket.
import readline from 'node:readline';
import { timingSafeEqual } from 'node:crypto';
import { device, diagnostics } from './detect.js';
const expected = process.env.VP_HELPER_NONCE;
delete process.env.VP_HELPER_NONCE;
const timer = setTimeout(() => process.exit(2), 15000);
const input = readline.createInterface({ input: process.stdin });
input.once('line', async line => {
  input.close();
  try {
    if (line.length > 4096) throw new Error('INVALID_INPUT');
    const req = JSON.parse(line);
    const a = Buffer.from(String(req.nonce || '')); const b = Buffer.from(expected || '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('UNAUTHORIZED');
    if (req.version !== 1 || !['device', 'diagnostics'].includes(req.action)) throw new Error('INVALID_INPUT');
    const result = req.action === 'device' ? await device() : await diagnostics(req.target);
    process.stdout.write(JSON.stringify({ ok: true, version: 1, result }) + '\n');
  } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: { code: e.code || e.message || 'HELPER_ERROR' } }) + '\n'); }
  clearTimeout(timer); process.exit();
});
