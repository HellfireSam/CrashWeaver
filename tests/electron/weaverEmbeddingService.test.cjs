const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cosineSimilarity,
  EMBEDDING_SIMILARITY_BOOST,
} = require('../../dist-electron/weaver/weaverEmbeddingService.js');

// ── cosineSimilarity ─────────────────────────────────────────────────────────

test('cosineSimilarity returns 1 for identical vectors', () => {
  const vec = [0.5, 0.3, 0.2, 0.1];
  const result = cosineSimilarity(vec, vec);
  assert.ok(Math.abs(result - 1) < 1e-10, `expected ~1, got ${result}`);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  const result = cosineSimilarity(a, b);
  assert.ok(Math.abs(result) < 1e-10, `expected ~0, got ${result}`);
});

test('cosineSimilarity returns 0 for opposing (negative) similarity', () => {
  const a = [1, 0, 0];
  const b = [-1, 0, 0];
  const result = cosineSimilarity(a, b);
  // Cosine is -1, but we clamp to 0
  assert.equal(result, 0);
});

test('cosineSimilarity handles zero-length vectors gracefully', () => {
  const result = cosineSimilarity([], []);
  assert.equal(result, 0);
});

test('cosineSimilarity handles mismatched vector lengths', () => {
  const result = cosineSimilarity([1, 2, 3], [1, 2]);
  assert.equal(result, 0);
});

test('cosineSimilarity handles zero-norm vector (all zeros)', () => {
  const a = [0, 0, 0];
  const b = [1, 2, 3];
  const result = cosineSimilarity(a, b);
  assert.equal(result, 0);
});

test('cosineSimilarity handles real-world embedding-like values', () => {
  const a = [0.12, -0.05, 0.33, 0.18, -0.22, 0.07];
  const b = [0.10, -0.03, 0.30, 0.20, -0.19, 0.09];
  const result = cosineSimilarity(a, b);
  // Should be very high (> 0.95) since vectors are nearly identical
  assert.ok(result > 0.95, `expected > 0.95, got ${result}`);
  assert.ok(result <= 1, `expected <= 1, got ${result}`);
});

test('cosineSimilarity handles moderately dissimilar vectors', () => {
  const a = [1, 0, 0, 0];
  const b = [0.5, 0.5, 0.5, 0.5];
  const result = cosineSimilarity(a, b);
  // cos = (1*0.5) / (1 * 1) = 0.5
  assert.ok(Math.abs(result - 0.5) < 1e-10, `expected ~0.5, got ${result}`);
});

// ── Constants ────────────────────────────────────────────────────────────────

test('EMBEDDING_SIMILARITY_BOOST is a positive number', () => {
  assert.ok(EMBEDDING_SIMILARITY_BOOST > 0);
  assert.equal(typeof EMBEDDING_SIMILARITY_BOOST, 'number');
});

test('EMBEDDING_SIMILARITY_BOOST is in a reasonable range (50–400)', () => {
  assert.ok(EMBEDDING_SIMILARITY_BOOST >= 50, 'should be at least 50 to meaningfully affect ranking');
  assert.ok(EMBEDDING_SIMILARITY_BOOST <= 400, 'should not exceed 400 to avoid drowning keyword signals');
});
