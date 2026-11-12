import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssistPayload } from '../../src/host/assist.js';

test('rejects missing or unknown intent', () => {
  assert.equal(validateAssistPayload({}).error, 'MISSING_INPUT');
  assert.equal(validateAssistPayload({ intent: 'hack' }).error, 'INVALID_INPUT');
});

test('rejects credential-like keys and content', () => {
  assert.equal(validateAssistPayload({ intent: 'select', userPassword: 'x' }).error, 'SECRET_REJECTED');
  assert.equal(validateAssistPayload({ intent: 'troubleshoot', errorText: 'my subscription key is xxx' }).error, 'SECRET_REJECTED');
});

test('accepts a clean payload and truncates long text', () => {
  const result = validateAssistPayload({
    intent: 'troubleshoot', providerId: 'proton-vpn', platform: 'windows',
    stepId: 's3', errorText: 'x'.repeat(3000),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.payload.errorText.length, 2000);
  assert.equal(result.payload.platform, 'windows');
});

test('rejects invalid platform values', () => {
  assert.equal(validateAssistPayload({ intent: 'install-guide', platform: 'dos' }).error, 'INVALID_INPUT');
});
