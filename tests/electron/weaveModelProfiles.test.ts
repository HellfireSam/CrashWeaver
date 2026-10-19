import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  resolveModel,
  resolveFullModelProfile,
  validateAndClampBudgetValue,
  BUDGET_VALIDATION_BOUNDS,
  DEFAULT_MODEL_BY_UI_TIER,
} = require('../../dist-electron/weaver/weaveModelProfiles.js');

describe('weaveModelProfiles', () => {
  // ── Model resolution ─────────────────────────────────────────────────────────

  it('resolveModel returns full OpenRouter ID when explicit model contains slash', () => {
    const result = resolveModel('openai/gpt-4o-mini', null);
    expect(result).toBe('openai/gpt-4o-mini');
  });

  it('resolveModel maps cw-fast tier to openai/gpt-4o-mini', () => {
    const result = resolveModel('cw-fast', null);
    expect(result).toBe('openai/gpt-4o-mini');
  });

  it('resolveModel maps cw-balanced tier to openai/gpt-4o', () => {
    const result = resolveModel('cw-balanced', null);
    expect(result).toBe('openai/gpt-4o');
  });

  it('resolveModel maps cw-deep tier to anthropic/claude-sonnet-4-5', () => {
    const result = resolveModel('cw-deep', null);
    expect(result).toBe('anthropic/claude-sonnet-4-5');
  });

  it('resolveModel falls back to balanced default when no model specified', () => {
    const result = resolveModel(undefined, null);
    expect(result).toBe(DEFAULT_MODEL_BY_UI_TIER['cw-balanced']);
  });

  it('resolveModel uses preferred model when explicit is undefined', () => {
    const result = resolveModel(undefined, 'openai/gpt-4o-mini');
    expect(result).toBe('openai/gpt-4o-mini');
  });

  it('resolveModel prefers explicit model over preferred', () => {
    const result = resolveModel('cw-fast', 'cw-deep');
    expect(result).toBe('openai/gpt-4o-mini');
  });

  it('resolveModel passes through unknown but slash-containing model IDs', () => {
    const result = resolveModel('anthropic/claude-opus-4', null);
    expect(result).toBe('anthropic/claude-opus-4');
  });

  it('resolveModel handles whitespace in model string', () => {
    const result = resolveModel('  cw-fast  ', null);
    expect(result).toBe('openai/gpt-4o-mini');
  });

  // ── Budget validation ────────────────────────────────────────────────────────

  it('validateAndClampBudgetValue returns the value when within bounds', () => {
    const result = validateAndClampBudgetValue(500, 'testField', { min: 100, max: 1000 });
    expect(result).toBe(500);
  });

  it('validateAndClampBudgetValue clamps below minimum to minimum', () => {
    const result = validateAndClampBudgetValue(50, 'testField', { min: 100, max: 1000 });
    expect(result).toBe(100);
  });

  it('validateAndClampBudgetValue clamps above maximum to maximum', () => {
    const result = validateAndClampBudgetValue(5000, 'testField', { min: 100, max: 1000 });
    expect(result).toBe(1000);
  });

  it('validateAndClampBudgetValue returns min for null/undefined', () => {
    expect(validateAndClampBudgetValue(null, 'f', { min: 100, max: 1000 })).toBe(100);
    expect(validateAndClampBudgetValue(undefined, 'f', { min: 100, max: 1000 })).toBe(100);
  });

  it('validateAndClampBudgetValue throws for non-finite values', () => {
    expect(() => validateAndClampBudgetValue(NaN, 'f', { min: 100, max: 1000 })).toThrow();
    expect(() => validateAndClampBudgetValue(Infinity, 'f', { min: 100, max: 1000 })).toThrow();
  });

  it('BUDGET_VALIDATION_BOUNDS has consistent min/max relationships', () => {
    expect(BUDGET_VALIDATION_BOUNDS.minTokens < BUDGET_VALIDATION_BOUNDS.maxTokens).toBeTruthy();
    expect(
      BUDGET_VALIDATION_BOUNDS.minTimeoutMs < BUDGET_VALIDATION_BOUNDS.maxTimeoutMs,
    ).toBeTruthy();
    expect(
      BUDGET_VALIDATION_BOUNDS.minIterations < BUDGET_VALIDATION_BOUNDS.maxIterations,
    ).toBeTruthy();
  });

  // ── Full model profile resolution ────────────────────────────────────────────

  it('resolveFullModelProfile returns structuredOutputMode for GPT-4o', () => {
    const profile = resolveFullModelProfile('openai/gpt-4o', {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });

    expect(profile.structuredOutputMode).toBe('json_mode');
    expect(profile.maxTokens > 0).toBeTruthy();
    expect(profile.timeoutMs > 0).toBeTruthy();
    expect(profile.iterationLimit > 0).toBeTruthy();
    expect(typeof profile.systemPromptOverlay === 'string').toBeTruthy();
    expect(typeof profile.temperature).toBe('number');
  });

  it('resolveFullModelProfile returns fences_and_braces for Claude', () => {
    const profile = resolveFullModelProfile('anthropic/claude-sonnet-4-5', {
      kind: 'intelligent',
      strength: 'standard',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });

    expect(profile.structuredOutputMode).toBe('fences_and_braces');
    expect(profile.repairStrategy).toBe('conservative');
  });

  it('resolveFullModelProfile returns response_format for json_mode models', () => {
    const profile = resolveFullModelProfile('openai/gpt-4o', {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });

    expect(profile.responseFormatParams).toEqual({ response_format: { type: 'json_object' } });
  });

  it('resolveFullModelProfile returns undefined responseFormatParams for non-json_mode', () => {
    const profile = resolveFullModelProfile('anthropic/claude-sonnet-4-5', {
      kind: 'intelligent',
      strength: 'light',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });

    expect(profile.responseFormatParams).toBe(undefined);
  });

  it('resolveFullModelProfile respects disableBudgetRestrictions setting', () => {
    const profile = resolveFullModelProfile(
      'openai/gpt-4o',
      {
        kind: 'intelligent',
        strength: 'light',
        cardUid: 'CW-001',
        intent: 'test',
        rootPath: '/vault',
        activeCrashpadId: 'cp-1',
        activeCrashpadPath: '.crashweaver/cp.crashpad.json',
      },
      { configured: true, preferredModel: null, disableBudgetRestrictions: true },
    );

    expect(profile.maxTokens).toBe(BUDGET_VALIDATION_BOUNDS.maxTokens);
    expect(profile.timeoutMs).toBe(BUDGET_VALIDATION_BOUNDS.maxTimeoutMs);
    // Unrestricted mode deliberately raises the tool-call ceiling above the
    // restricted maximum: 200 is a safety cap, not maxIterations (20).
    expect(profile.iterationLimit).toBe(200);
  });

  it('resolveFullModelProfile intelligent budgets scale by strength', () => {
    const light = resolveFullModelProfile('openai/gpt-4o', {
      kind: 'intelligent',
      strength: 'light',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    const standard = resolveFullModelProfile('openai/gpt-4o', {
      kind: 'intelligent',
      strength: 'standard',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    const goHam = resolveFullModelProfile('openai/gpt-4o', {
      kind: 'intelligent',
      strength: 'go-ham',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });

    expect(
      light.maxTokens < standard.maxTokens,
      'light tokens should be less than standard',
    ).toBeTruthy();
    expect(
      standard.maxTokens < goHam.maxTokens,
      'standard tokens should be less than go-ham',
    ).toBeTruthy();
    expect(
      light.iterationLimit < standard.iterationLimit,
      'light iterations should be less than standard',
    ).toBeTruthy();
    expect(
      standard.iterationLimit < goHam.iterationLimit,
      'standard iterations should be less than go-ham',
    ).toBeTruthy();
  });

  // ── Provider-prefix model detection ─────────────────────────────────────────

  it('resolveFullModelProfile uses json_mode for openai provider family', () => {
    const profile = resolveFullModelProfile('openai/gpt-4o', {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.structuredOutputMode).toBe('json_mode');
  });

  it('resolveFullModelProfile uses json_mode for google provider family', () => {
    const profile = resolveFullModelProfile('google/gemini-2.5-pro', {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.structuredOutputMode).toBe('json_mode');
  });

  it('resolveFullModelProfile uses json_mode for deepseek provider family', () => {
    const profile = resolveFullModelProfile('deepseek/deepseek-v3', {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.structuredOutputMode).toBe('json_mode');
  });

  it('resolveFullModelProfile uses fences_and_braces for anthropic/claude family', () => {
    const profile = resolveFullModelProfile('anthropic/claude-sonnet-4-5', {
      kind: 'intelligent',
      strength: 'standard',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.structuredOutputMode).toBe('fences_and_braces');
  });

  it('resolveFullModelProfile uses conservative repair for Claude models', () => {
    const profile = resolveFullModelProfile('anthropic/claude-opus-4', {
      kind: 'intelligent',
      strength: 'light',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.repairStrategy).toBe('conservative');
  });

  it('resolveFullModelProfile uses aggressive repair for non-Claude models', () => {
    const profile = resolveFullModelProfile('meta-llama/llama-4-maverick', {
      kind: 'intelligent',
      strength: 'light',
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.repairStrategy).toBe('aggressive');
  });

  it('resolveFullModelProfile falls back to fences_and_braces for unknown providers', () => {
    const profile = resolveFullModelProfile('unknown-provider/some-model', {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      cardUid: 'CW-001',
      intent: 'test',
      rootPath: '/vault',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp.crashpad.json',
    });
    expect(profile.structuredOutputMode).toBe('fences_and_braces');
    // Unknown providers default to aggressive repair
    expect(profile.repairStrategy).toBe('aggressive');
  });
});
