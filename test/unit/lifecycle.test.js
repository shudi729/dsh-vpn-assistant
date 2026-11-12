import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../index.js';
test('late asynchronous skill compilation cannot register after plugin disposal', async () => {
  let registrations = 0; let cleanup;
  const ctx = {
    get: () => undefined,
    effect: () => {},
    inject(names, cb) {
      if (names[0] === 'skills') cleanup = cb({ skills: { register() { registrations++; return { dispose() {} }; } } });
    },
  };
  apply(ctx); cleanup();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(registrations, 0);
});
