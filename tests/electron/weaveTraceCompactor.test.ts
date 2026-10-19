import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  compactTraceItem,
  WeaveTraceAccumulator,
} = require('../../dist-electron/weaver/weaveTraceCompactor.js');

describe('weaveTraceCompactor', () => {
  // ── compactTraceItem ─────────────────────────────────────────────────────────

  it('compactTraceItem preserves thought and action for small observations', () => {
    const result = compactTraceItem({
      thought: 'Need to check candidates',
      action: 'Call list_candidate_notes',
      observation: 'Found 3 notes.',
    });

    expect(result.thought).toBe('Need to check candidates');
    expect(result.action).toBe('Call list_candidate_notes');
    expect(result.observationSummary).toBe('Found 3 notes.');
    expect(result.isLargeObservation).toBe(false);
    expect(!result.observationLength || result.observationLength <= 400).toBeTruthy();
  });

  it('compactTraceItem truncates large observations', () => {
    const longObs = 'x'.repeat(500);
    const result = compactTraceItem({
      thought: 'Reading note',
      action: 'Call read_note_full',
      observation: longObs,
    });

    expect(result.isLargeObservation).toBe(true);
    expect(
      result.observationSummary.length <= 404,
      'summary should be ~400 chars + …',
    ).toBeTruthy();
    expect(result.observationSummary.endsWith('…')).toBeTruthy();
  });

  it('compactTraceItem generates resultHash for large tool results', () => {
    const result = compactTraceItem({
      thought: 'Reading note',
      action: 'Call read_note_full',
      observation: 'Found content.',
      toolResult: 'large content '.repeat(50),
    });

    expect(typeof result.resultHash === 'string').toBeTruthy();
    expect(result.resultHash.length > 0).toBeTruthy();
  });

  it('compactTraceItem does not include raw result when includeRawResult is false (default)', () => {
    const result = compactTraceItem({
      thought: 'Reading note',
      action: 'Call read_note_full',
      observation: 'Found content.',
      toolResult: { data: 'some data' },
    });

    expect(result.toolResult).toBe(undefined);
  });

  it('compactTraceItem includes raw result when includeRawResult is true and under size limit', () => {
    const result = compactTraceItem(
      {
        thought: 'Reading note',
        action: 'Call read_note_full',
        observation: 'Found content.',
        toolResult: { data: 'small' },
      },
      true,
    );

    expect(result.toolResult).toEqual({ data: 'small' });
  });

  it('compactTraceItem handles missing thought', () => {
    const result = compactTraceItem({
      action: 'Call tool',
      observation: 'OK',
    });

    expect(result.thought).toBe(undefined);
    expect(result.action).toBe('Call tool');
  });

  it('compactTraceItem handles empty strings', () => {
    const result = compactTraceItem({
      thought: '',
      action: '',
      observation: '',
    });

    expect(result.observationLength).toBe(0);
    expect(result.isLargeObservation).toBe(false);
  });

  // ── WeaveTraceAccumulator ────────────────────────────────────────────────────

  it('WeaveTraceAccumulator accumulates items and tracks stats', () => {
    const acc = new WeaveTraceAccumulator(false);
    acc.addItem({ thought: 'Step 1', action: 'Call tool', observation: 'Done.' });
    acc.addItem({ thought: 'Step 2', action: 'Finalize', observation: 'Plan ready.' });

    const trace = acc.getTrace();
    expect(trace.length).toBe(2);
    expect(trace[0].thought).toBe('Step 1');
    expect(trace[1].thought).toBe('Step 2');
  });

  it('WeaveTraceAccumulator stats reflect item count and total chars', () => {
    const acc = new WeaveTraceAccumulator(false);
    acc.addItem({ thought: 'A', action: 'B', observation: 'C' });

    const stats = acc.getStats();
    expect(stats.itemCount).toBe(1);
    expect(stats.totalCharCount > 0).toBeTruthy();
    expect(typeof stats.avgCharCountPerItem === 'number').toBeTruthy();
  });

  it('WeaveTraceAccumulator enforces per-item size budget', () => {
    const acc = new WeaveTraceAccumulator(false);
    const longObs = 'z'.repeat(2000);
    acc.addItem({ thought: 'Big step', action: 'Big action', observation: longObs });

    const trace = acc.getTrace();
    expect(trace.length).toBe(1);
    // Observation should be truncated to fit budget
    expect(trace[0].observationSummary.length < longObs.length).toBeTruthy();
  });

  it('WeaveTraceAccumulator with includeRawResults stores raw results', () => {
    const acc = new WeaveTraceAccumulator(true);
    acc.addItem({
      thought: 'Step',
      action: 'Act',
      observation: 'Obs',
      toolResult: { key: 'value' },
    });

    const trace = acc.getTrace();
    expect(trace[0].toolResult).toEqual({ key: 'value' });
  });

  it('WeaveTraceAccumulator without includeRawResults does not store raw results', () => {
    const acc = new WeaveTraceAccumulator(false);
    acc.addItem({
      thought: 'Step',
      action: 'Act',
      observation: 'Obs',
      toolResult: { key: 'value' },
    });

    const trace = acc.getTrace();
    expect(trace[0].toolResult).toBe(undefined);
  });
});
