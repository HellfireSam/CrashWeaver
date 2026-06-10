const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveModel,
  resolveFullModelProfile,
  validateAndClampBudgetValue,
  BUDGET_VALIDATION_BOUNDS,
  DEFAULT_MODEL_BY_UI_TIER,
} = require('../../dist-electron/weaver/weaveModelProfiles.js');

// ── Model resolution ─────────────────────────────────────────────────────────

test('resolveModel returns full OpenRouter ID when explicit model contains slash', () => {
  const result = resolveModel('openai/gpt-4o-mini', null);
  assert.equal(result, 'openai/gpt-4o-mini');
});

test('resolveModel maps cw-fast tier to openai/gpt-4o-mini', () => {
  const result = resolveModel('cw-fast', null);
  assert.equal(result, 'openai/gpt-4o-mini');
});

test('resolveModel maps cw-balanced tier to openai/gpt-4o', () => {
  const result = resolveModel('cw-balanced', null);
  assert.equal(result, 'openai/gpt-4o');
});

test('resolveModel maps cw-deep tier to anthropic/claude-sonnet-4-5', () => {
  const result = resolveModel('cw-deep', null);
  assert.equal(result, 'anthropic/claude-sonnet-4-5');
});

test('resolveModel falls back to balanced default when no model specified', () => {
  const result = resolveModel(undefined, null);
  assert.equal(result, DEFAULT_MODEL_BY_UI_TIER['cw-balanced']);
});

test('resolveModel uses preferred model when explicit is undefined', () => {
  const result = resolveModel(undefined, 'openai/gpt-4o-mini');
  assert.equal(result, 'openai/gpt-4o-mini');
});

test('resolveModel prefers explicit model over preferred', () => {
  const result = resolveModel('cw-fast', 'cw-deep');
  assert.equal(result, 'openai/gpt-4o-mini');
});

test('resolveModel passes through unknown but slash-containing model IDs', () => {
  const result = resolveModel('anthropic/claude-opus-4', null);
  assert.equal(result, 'anthropic/claude-opus-4');
});

test('resolveModel handles whitespace in model string', () => {
  const result = resolveModel('  cw-fast  ', null);
  assert.equal(result, 'openai/gpt-4o-mini');
});

// ── Budget validation ────────────────────────────────────────────────────────

test('validateAndClampBudgetValue returns the value when within bounds', () => {
  const result = validateAndClampBudgetValue(500, 'testField', { min: 100, max: 1000 });
  assert.equal(result, 500);
});

test('validateAndClampBudgetValue clamps below minimum to minimum', () => {
  const result = validateAndClampBudgetValue(50, 'testField', { min: 100, max: 1000 });
  assert.equal(result, 100);
});

test('validateAndClampBudgetValue clamps above maximum to maximum', () => {
  const result = validateAndClampBudgetValue(5000, 'testField', { min: 100, max: 1000 });
  assert.equal(result, 1000);
});

test('validateAndClampBudgetValue returns min for null/undefined', () => {
  assert.equal(validateAndClampBudgetValue(null, 'f', { min: 100, max: 1000 }), 100);
  assert.equal(validateAndClampBudgetValue(undefined, 'f', { min: 100, max: 1000 }), 100);
});

test('validateAndClampBudgetValue throws for non-finite values', () => {
  assert.throws(() => validateAndClampBudgetValue(NaN, 'f', { min: 100, max: 1000 }));
  assert.throws(() => validateAndClampBudgetValue(Infinity, 'f', { min: 100, max: 1000 }));
});

test('BUDGET_VALIDATION_BOUNDS has consistent min/max relationships', () => {
  assert.ok(BUDGET_VALIDATION_BOUNDS.minTokens < BUDGET_VALIDATION_BOUNDS.maxTokens);
  assert.ok(BUDGET_VALIDATION_BOUNDS.minTimeoutMs < BUDGET_VALIDATION_BOUNDS.maxTimeoutMs);
  assert.ok(BUDGET_VALIDATION_BOUNDS.minIterations < BUDGET_VALIDATION_BOUNDS.maxIterations);
});

// ── Full model profile resolution ────────────────────────────────────────────

test('resolveFullModelProfile returns structuredOutputMode for GPT-4o', () => {
  const profile = resolveFullModelProfile('openai/gpt-4o', {
    kind: 'guided-insert',
    permissions: { editContent: false, createNote: false },
    cardUid: 'CW-001',
    intent: 'test',
    rootPath: '/vault',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });

  assert.equal(profile.structuredOutputMode, 'json_mode');
  assert.ok(profile.maxTokens > 0);
  assert.ok(profile.timeoutMs > 0);
  assert.ok(profile.iterationLimit > 0);
  assert.ok(typeof profile.systemPromptOverlay === 'string');
  assert.equal(typeof profile.temperature, 'number');
});

test('resolveFullModelProfile returns fences_and_braces for Claude', () => {
  const profile = resolveFullModelProfile('anthropic/claude-sonnet-4-5', {
    kind: 'intelligent',
    strength: 'standard',
    cardUid: 'CW-001',
    intent: 'test',
    rootPath: '/vault',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });

  assert.equal(profile.structuredOutputMode, 'fences_and_braces');
  assert.equal(profile.repairStrategy, 'conservative');
});

test('resolveFullModelProfile returns response_format for json_mode models', () => {
  const profile = resolveFullModelProfile('openai/gpt-4o', {
    kind: 'guided-insert',
    permissions: { editContent: false, createNote: false },
    cardUid: 'CW-001',
    intent: 'test',
    rootPath: '/vault',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });

  assert.deepEqual(profile.responseFormatParams, { response_format: { type: 'json_object' } });
});

test('resolveFullModelProfile returns undefined responseFormatParams for non-json_mode', () => {
  const profile = resolveFullModelProfile('anthropic/claude-sonnet-4-5', {
    kind: 'intelligent',
    strength: 'light',
    cardUid: 'CW-001',
    intent: 'test',
    rootPath: '/vault',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });

  assert.equal(profile.responseFormatParams, undefined);
});

test('resolveFullModelProfile respects disableBudgetRestrictions setting', () => {
  const profile = resolveFullModelProfile('openai/gpt-4o', {
    kind: 'intelligent',
    strength: 'light',
    cardUid: 'CW-001',
    intent: 'test',
    rootPath: '/vault',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  }, { configured: true, preferredModel: null, disableBudgetRestrictions: true });

  assert.equal(profile.maxTokens, BUDGET_VALIDATION_BOUNDS.maxTokens);
  assert.equal(profile.timeoutMs, BUDGET_VALIDATION_BOUNDS.maxTimeoutMs);
  assert.equal(profile.iterationLimit, BUDGET_VALIDATION_BOUNDS.maxIterations);
});

test('resolveFullModelProfile intelligent budgets scale by strength', () => {
  const light = resolveFullModelProfile('openai/gpt-4o', {
    kind: 'intelligent', strength: 'light',
    cardUid: 'CW-001', intent: 'test', rootPath: '/vault',
    activeCrashpadId: 'cp-1', activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });
  const standard = resolveFullModelProfile('openai/gpt-4o', {
    kind: 'intelligent', strength: 'standard',
    cardUid: 'CW-001', intent: 'test', rootPath: '/vault',
    activeCrashpadId: 'cp-1', activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });
  const goHam = resolveFullModelProfile('openai/gpt-4o', {
    kind: 'intelligent', strength: 'go-ham',
    cardUid: 'CW-001', intent: 'test', rootPath: '/vault',
    activeCrashpadId: 'cp-1', activeCrashpadPath: '.crashweaver/cp.crashpad.json',
  });

  assert.ok(light.maxTokens < standard.maxTokens, 'light tokens should be less than standard');
  assert.ok(standard.maxTokens < goHam.maxTokens, 'standard tokens should be less than go-ham');
  assert.ok(light.iterationLimit < standard.iterationLimit, 'light iterations should be less than standard');
  assert.ok(standard.iterationLimit < goHam.iterationLimit, 'standard iterations should be less than go-ham');
});
