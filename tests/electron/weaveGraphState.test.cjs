const test = require('node:test');
const assert = require('node:assert/strict');

const {
  systemMsg,
  userMsg,
  assistantMsg,
  MIN_REMAINING_TIME_MS,
  MAX_TOTAL_STEPS,
} = require('../../dist-electron/weaver/weaveGraphState.js');

// ── WeaveMessage helpers ─────────────────────────────────────────────────────

test('systemMsg creates a system message with correct role', () => {
  const msg = systemMsg('You are Weaver.');
  assert.deepEqual(msg, { role: 'system', content: 'You are Weaver.' });
});

test('userMsg creates a user message with correct role', () => {
  const msg = userMsg('Insert this card.');
  assert.deepEqual(msg, { role: 'user', content: 'Insert this card.' });
});

test('assistantMsg creates an assistant message with correct role', () => {
  const msg = assistantMsg('{"type":"final","plan":{}}');
  assert.deepEqual(msg, { role: 'assistant', content: '{"type":"final","plan":{}}' });
});

test('systemMsg handles empty content', () => {
  const msg = systemMsg('');
  assert.equal(msg.role, 'system');
  assert.equal(msg.content, '');
});

test('WeaveMessage is a plain object with no methods', () => {
  const msg = userMsg('test');
  // No _getType(), no prototype methods beyond Object
  assert.equal(typeof msg._getType, 'undefined');
  assert.equal(typeof msg.content, 'string');
  assert.equal(typeof msg.role, 'string');
});

// ── Constants ────────────────────────────────────────────────────────────────

test('MIN_REMAINING_TIME_MS is a positive number', () => {
  assert.ok(MIN_REMAINING_TIME_MS > 0);
  assert.equal(typeof MIN_REMAINING_TIME_MS, 'number');
});

test('MAX_TOTAL_STEPS is a reasonable positive integer', () => {
  assert.ok(MAX_TOTAL_STEPS > 0);
  assert.ok(Number.isInteger(MAX_TOTAL_STEPS));
  assert.ok(MAX_TOTAL_STEPS >= 10, 'should be at least 10 to allow tool + repair cycles');
  assert.ok(MAX_TOTAL_STEPS <= 100, 'should be capped to prevent memory issues');
});

// ── Type validation — step and route enums exist ─────────────────────────────

test('WeaveGraphStep and WeaveAgentRoute types are exported as strings in runtime code', () => {
  // These are compile-time types, but the constants that reference them
  // should be available at runtime.
  const mod = require('../../dist-electron/weaver/weaveGraphState.js');
  assert.ok(mod.systemMsg, 'systemMsg should be exported');
  assert.ok(mod.userMsg, 'userMsg should be exported');
  assert.ok(mod.assistantMsg, 'assistantMsg should be exported');
});
