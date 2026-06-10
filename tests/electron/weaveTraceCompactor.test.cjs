const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compactTraceItem,
  WeaveTraceAccumulator,
} = require('../../dist-electron/weaver/weaveTraceCompactor.js');

// ── compactTraceItem ─────────────────────────────────────────────────────────

test('compactTraceItem preserves thought and action for small observations', () => {
  const result = compactTraceItem({
    thought: 'Need to check candidates',
    action: 'Call list_candidate_notes',
    observation: 'Found 3 notes.',
  });

  assert.equal(result.thought, 'Need to check candidates');
  assert.equal(result.action, 'Call list_candidate_notes');
  assert.equal(result.observationSummary, 'Found 3 notes.');
  assert.equal(result.isLargeObservation, false);
  assert.ok(!result.observationLength || result.observationLength <= 400);
});

test('compactTraceItem truncates large observations', () => {
  const longObs = 'x'.repeat(500);
  const result = compactTraceItem({
    thought: 'Reading note',
    action: 'Call read_note_full',
    observation: longObs,
  });

  assert.equal(result.isLargeObservation, true);
  assert.ok(result.observationSummary.length <= 404, 'summary should be ~400 chars + …');
  assert.ok(result.observationSummary.endsWith('…'));
});

test('compactTraceItem generates resultHash for large tool results', () => {
  const result = compactTraceItem({
    thought: 'Reading note',
    action: 'Call read_note_full',
    observation: 'Found content.',
    toolResult: 'large content '.repeat(50),
  });

  assert.ok(typeof result.resultHash === 'string');
  assert.ok(result.resultHash.length > 0);
});

test('compactTraceItem does not include raw result when includeRawResult is false (default)', () => {
  const result = compactTraceItem({
    thought: 'Reading note',
    action: 'Call read_note_full',
    observation: 'Found content.',
    toolResult: { data: 'some data' },
  });

  assert.equal(result.toolResult, undefined);
});

test('compactTraceItem includes raw result when includeRawResult is true and under size limit', () => {
  const result = compactTraceItem({
    thought: 'Reading note',
    action: 'Call read_note_full',
    observation: 'Found content.',
    toolResult: { data: 'small' },
  }, true);

  assert.deepEqual(result.toolResult, { data: 'small' });
});

test('compactTraceItem handles missing thought', () => {
  const result = compactTraceItem({
    action: 'Call tool',
    observation: 'OK',
  });

  assert.equal(result.thought, undefined);
  assert.equal(result.action, 'Call tool');
});

test('compactTraceItem handles empty strings', () => {
  const result = compactTraceItem({
    thought: '',
    action: '',
    observation: '',
  });

  assert.equal(result.observationLength, 0);
  assert.equal(result.isLargeObservation, false);
});

// ── WeaveTraceAccumulator ────────────────────────────────────────────────────

test('WeaveTraceAccumulator accumulates items and tracks stats', () => {
  const acc = new WeaveTraceAccumulator(false);
  acc.addItem({ thought: 'Step 1', action: 'Call tool', observation: 'Done.' });
  acc.addItem({ thought: 'Step 2', action: 'Finalize', observation: 'Plan ready.' });

  const trace = acc.getTrace();
  assert.equal(trace.length, 2);
  assert.equal(trace[0].thought, 'Step 1');
  assert.equal(trace[1].thought, 'Step 2');
});

test('WeaveTraceAccumulator stats reflect item count and total chars', () => {
  const acc = new WeaveTraceAccumulator(false);
  acc.addItem({ thought: 'A', action: 'B', observation: 'C' });

  const stats = acc.getStats();
  assert.equal(stats.itemCount, 1);
  assert.ok(stats.totalCharCount > 0);
  assert.ok(typeof stats.avgCharCountPerItem === 'number');
});

test('WeaveTraceAccumulator enforces per-item size budget', () => {
  const acc = new WeaveTraceAccumulator(false);
  const longObs = 'z'.repeat(2000);
  acc.addItem({ thought: 'Big step', action: 'Big action', observation: longObs });

  const trace = acc.getTrace();
  assert.equal(trace.length, 1);
  // Observation should be truncated to fit budget
  assert.ok(trace[0].observationSummary.length < longObs.length);
});

test('WeaveTraceAccumulator with includeRawResults stores raw results', () => {
  const acc = new WeaveTraceAccumulator(true);
  acc.addItem({
    thought: 'Step',
    action: 'Act',
    observation: 'Obs',
    toolResult: { key: 'value' },
  });

  const trace = acc.getTrace();
  assert.deepEqual(trace[0].toolResult, { key: 'value' });
});

test('WeaveTraceAccumulator without includeRawResults does not store raw results', () => {
  const acc = new WeaveTraceAccumulator(false);
  acc.addItem({
    thought: 'Step',
    action: 'Act',
    observation: 'Obs',
    toolResult: { key: 'value' },
  });

  const trace = acc.getTrace();
  assert.equal(trace[0].toolResult, undefined);
});
