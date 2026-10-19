import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  cosineSimilarity,
  EMBEDDING_SIMILARITY_BOOST,
} = require('../../dist-electron/weaver/weaverEmbeddingService.js');

describe('weaverEmbeddingService', () => {
  // ── cosineSimilarity ─────────────────────────────────────────────────────────

  it('cosineSimilarity returns 1 for identical vectors', () => {
    const vec = [0.5, 0.3, 0.2, 0.1];
    const result = cosineSimilarity(vec, vec);
    expect(Math.abs(result - 1) < 1e-10, `expected ~1, got ${result}`).toBeTruthy();
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    expect(Math.abs(result) < 1e-10, `expected ~0, got ${result}`).toBeTruthy();
  });

  it('cosineSimilarity returns 0 for opposing (negative) similarity', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const result = cosineSimilarity(a, b);
    // Cosine is -1, but we clamp to 0
    expect(result).toBe(0);
  });

  it('cosineSimilarity handles zero-length vectors gracefully', () => {
    const result = cosineSimilarity([], []);
    expect(result).toBe(0);
  });

  it('cosineSimilarity handles mismatched vector lengths', () => {
    const result = cosineSimilarity([1, 2, 3], [1, 2]);
    expect(result).toBe(0);
  });

  it('cosineSimilarity handles zero-norm vector (all zeros)', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
  });

  it('cosineSimilarity handles real-world embedding-like values', () => {
    const a = [0.12, -0.05, 0.33, 0.18, -0.22, 0.07];
    const b = [0.1, -0.03, 0.3, 0.2, -0.19, 0.09];
    const result = cosineSimilarity(a, b);
    // Should be very high (> 0.95) since vectors are nearly identical
    expect(result > 0.95, `expected > 0.95, got ${result}`).toBeTruthy();
    expect(result <= 1, `expected <= 1, got ${result}`).toBeTruthy();
  });

  it('cosineSimilarity handles moderately dissimilar vectors', () => {
    const a = [1, 0, 0, 0];
    const b = [0.5, 0.5, 0.5, 0.5];
    const result = cosineSimilarity(a, b);
    // cos = (1*0.5) / (1 * 1) = 0.5
    expect(Math.abs(result - 0.5) < 1e-10, `expected ~0.5, got ${result}`).toBeTruthy();
  });

  // ── Constants ────────────────────────────────────────────────────────────────

  it('EMBEDDING_SIMILARITY_BOOST is a positive number', () => {
    expect(EMBEDDING_SIMILARITY_BOOST > 0).toBeTruthy();
    expect(typeof EMBEDDING_SIMILARITY_BOOST).toBe('number');
  });

  it('EMBEDDING_SIMILARITY_BOOST is in a reasonable range (50–400)', () => {
    expect(
      EMBEDDING_SIMILARITY_BOOST >= 50,
      'should be at least 50 to meaningfully affect ranking',
    ).toBeTruthy();
    expect(
      EMBEDDING_SIMILARITY_BOOST <= 400,
      'should not exceed 400 to avoid drowning keyword signals',
    ).toBeTruthy();
  });
});
