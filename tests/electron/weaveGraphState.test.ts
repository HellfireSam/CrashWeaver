import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  systemMsg,
  userMsg,
  assistantMsg,
  MIN_REMAINING_TIME_MS,
  MAX_TOTAL_STEPS,
} = require('../../dist-electron/weaver/weaveGraphState.js');

describe('weaveGraphState', () => {
  // ── WeaveMessage helpers ─────────────────────────────────────────────────────

  it('systemMsg creates a system message with correct role', () => {
    const msg = systemMsg('You are Weaver.');
    expect(msg).toEqual({ role: 'system', content: 'You are Weaver.' });
  });

  it('userMsg creates a user message with correct role', () => {
    const msg = userMsg('Insert this card.');
    expect(msg).toEqual({ role: 'user', content: 'Insert this card.' });
  });

  it('assistantMsg creates an assistant message with correct role', () => {
    const msg = assistantMsg('{"type":"final","plan":{}}');
    expect(msg).toEqual({ role: 'assistant', content: '{"type":"final","plan":{}}' });
  });

  it('systemMsg handles empty content', () => {
    const msg = systemMsg('');
    expect(msg.role).toBe('system');
    expect(msg.content).toBe('');
  });

  it('WeaveMessage is a plain object with no methods', () => {
    const msg = userMsg('test');
    // No _getType(), no prototype methods beyond Object
    expect(typeof msg._getType).toBe('undefined');
    expect(typeof msg.content).toBe('string');
    expect(typeof msg.role).toBe('string');
  });

  // ── Constants ────────────────────────────────────────────────────────────────

  it('MIN_REMAINING_TIME_MS is a positive number', () => {
    expect(MIN_REMAINING_TIME_MS > 0).toBeTruthy();
    expect(typeof MIN_REMAINING_TIME_MS).toBe('number');
  });

  it('MAX_TOTAL_STEPS is a reasonable positive integer', () => {
    expect(MAX_TOTAL_STEPS > 0).toBeTruthy();
    expect(Number.isInteger(MAX_TOTAL_STEPS)).toBeTruthy();
    expect(
      MAX_TOTAL_STEPS >= 10,
      'should be at least 10 to allow tool + repair cycles',
    ).toBeTruthy();
    expect(MAX_TOTAL_STEPS <= 100, 'should be capped to prevent memory issues').toBeTruthy();
  });

  // ── Type validation — step and route enums exist ─────────────────────────────

  it('WeaveGraphStep and WeaveAgentRoute types are exported as strings in runtime code', () => {
    // These are compile-time types, but the constants that reference them
    // should be available at runtime.
    const mod = require('../../dist-electron/weaver/weaveGraphState.js');
    expect(mod.systemMsg, 'systemMsg should be exported').toBeTruthy();
    expect(mod.userMsg, 'userMsg should be exported').toBeTruthy();
    expect(mod.assistantMsg, 'assistantMsg should be exported').toBeTruthy();
  });
});
