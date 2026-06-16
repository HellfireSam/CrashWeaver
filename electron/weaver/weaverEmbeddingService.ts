/**
 * weaverEmbeddingService.ts
 *
 * Embedding-based semantic search for the Weaver candidate note ranking.
 *
 * Uses OpenRouter's embedding API (openai/text-embedding-3-small) to compute
 * vector representations of vault notes and query intent.  Embeddings are
 * cached per-note in .crashweaver/embeddings.json with content-hash
 * validation so notes are only re-embedded when their content changes.
 *
 * The embedding similarity score is blended with the existing keyword-based
 * score in weaveContextService.ts to produce the final candidate ranking.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { net } from 'electron';

// ── Constants ────────────────────────────────────────────────────────────────

const EMBEDDINGS_FILE_NAME = 'embeddings.json';

/**
 * OpenRouter embedding model.
 * text-embedding-3-small: 1536-dim, ~$0.02/1M tokens — cheapest viable option.
 * text-embedding-3-large: 3072-dim, ~$0.13/1M tokens — better accuracy at 6.5× cost.
 */
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/** Dimensionality of the chosen embedding model (1536 for text-embedding-3-small). */
const EMBEDDING_DIMENSIONS = 1536;

const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

/**
 * Max leading characters of note content hashed for change detection.
 * 2000 chars captures the title + opening paragraphs of most notes.
 * Notes longer than this only invalidate the cache if their first 2000 chars change,
 * which is an acceptable trade-off for avoiding full-content re-hashing on every sync.
 */
const CONTENT_HASH_MAX_CHARS = 2000;

/**
 * Blend weight for embedding similarity in the hybrid candidate-note score.
 *
 * Keyword score ranges 0–~20 in typical vaults.
 * Cosine similarity is 0–1.
 * BOOST = 180 means a perfect embedding match contributes ~180 points,
 * roughly 9× a typical keyword score (~20). This ensures semantic relevance
 * dominates when embeddings are available but doesn't drown out keyword
 * matches when the embedding model is unavailable.
 */
export const EMBEDDING_SIMILARITY_BOOST = 180;

/**
 * Minimum cosine similarity threshold for applying the embedding boost.
 * 0.15 filters out noise — notes below this threshold are semantically
 * unrelated and get no boost (keyword score only).
 *
 * Chosen empirically: most "unrelated" note pairs land in 0.0–0.12 range;
 * loosely-related pairs start around 0.18–0.25 with text-embedding-3-small.
 */
const MIN_SIMILARITY_THRESHOLD = 0.15;

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmbeddingCacheEntry {
  embedding: number[];
  contentHash: string;
  embeddedAt: string;
}

export interface EmbeddingCache {
  version: 1;
  model: string;
  entries: Record<string, EmbeddingCacheEntry>;
}

export interface EmbeddingServiceDeps {
  apiKey: string;
  fetchImpl?: typeof net.fetch;
  appUrl?: string;
}

/**
 * Map from vault-relative (posix) file path to its embedding similarity
 * score (0–1 range).  Populated by the embedding service during snapshot
 * building and consumed by scoreCandidateNote.
 */
export type EmbeddingSimilarityMap = Map<string, number>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEmbeddingsFilePath(rootPath: string): string {
  return path.join(rootPath, '.crashweaver', EMBEDDINGS_FILE_NAME);
}

function hashContent(title: string, content: string): string {
  const input = `${title}\n${content.slice(0, CONTENT_HASH_MAX_CHARS)}`;
  return createHash('sha256').update(input).digest('hex');
}

function toIsoString(now: number): string {
  return new Date(now).toISOString();
}

// ── Cache I/O ────────────────────────────────────────────────────────────────

export async function loadEmbeddingCache(rootPath: string): Promise<EmbeddingCache | null> {
  try {
    const filePath = getEmbeddingsFilePath(rootPath);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as EmbeddingCache;
    if (parsed.version === 1 && parsed.model === EMBEDDING_MODEL && parsed.entries) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveEmbeddingCache(rootPath: string, cache: EmbeddingCache): Promise<void> {
  const filePath = getEmbeddingsFilePath(rootPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(cache, null, 2), 'utf-8');
}

// ── Embedding API ────────────────────────────────────────────────────────────

interface OpenRouterEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

/**
 * Computes a single embedding vector via OpenRouter's embeddings endpoint.
 */
export async function computeEmbedding(
  apiKey: string,
  text: string,
  fetchImpl: typeof net.fetch,
  appUrl?: string,
): Promise<number[]> {
  const requestBody = {
    model: EMBEDDING_MODEL,
    input: text,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchImpl(OPENROUTER_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(appUrl ? { 'HTTP-Referer': appUrl, 'X-Title': 'CrashWeaver' } : {}),
      },
      body: Buffer.from(JSON.stringify(requestBody), 'utf-8'),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Embedding API returned ${response.status}`);
    }

    const data = (await response.json()) as OpenRouterEmbeddingResponse;
    const embedding = data.data?.[0]?.embedding;

    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding API returned an empty vector.');
    }

    return embedding;
  } catch (error) {
    clearTimeout(timeoutId);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to compute embedding: ${detail}`);
  }
}

// ── Similarity ───────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Returns a value in [0, 1] (negative similarities are clamped to 0).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  const similarity = dotProduct / denominator;
  return Math.max(0, similarity);
}

// ── Note embedding (with cache) ──────────────────────────────────────────────

/**
 * Returns the embedding vector for a note, either from cache or freshly computed.
 * Updates the cache in-memory and on disk when a new embedding is computed.
 */
export async function getOrComputeNoteEmbedding(
  apiKey: string,
  fetchImpl: typeof net.fetch,
  appUrl: string | undefined,
  rootPath: string,
  filePath: string,
  title: string,
  content: string,
  cache: EmbeddingCache,
  now: () => number,
): Promise<number[] | null> {
  const contentHash = hashContent(title, content);
  const existing = cache.entries[filePath];

  // Cache hit with matching content hash — no change detected
  if (existing && existing.contentHash === contentHash && existing.embedding.length === EMBEDDING_DIMENSIONS) {
    return existing.embedding;
  }

  // Need to compute or recompute
  try {
    const embeddingText = `${title}\n${content.slice(0, 1200)}`;
    const embedding = await computeEmbedding(apiKey, embeddingText, fetchImpl, appUrl);

    cache.entries[filePath] = {
      embedding,
      contentHash,
      embeddedAt: toIsoString(now()),
    };

    // Persist cache asynchronously (don't block the hot path)
    saveEmbeddingCache(rootPath, cache).catch(() => {
      // Silently ignore cache write failures
    });

    return embedding;
  } catch (error) {
    console.warn(`CrashWeaver Weaver: failed to embed note "${filePath}" —`, error);
    return null;
  }
}

// ── Query embedding ──────────────────────────────────────────────────────────

/**
 * Builds a query embedding for the card + intent, used to compare against
 * cached note embeddings via cosine similarity.
 */
export async function buildQueryEmbedding(
  apiKey: string,
  fetchImpl: typeof net.fetch,
  appUrl: string | undefined,
  cardUid: string,
  cardType: string[],
  cardContentExcerpt: string,
  intent: string,
): Promise<number[] | null> {
  const queryParts: string[] = [];

  if (intent.trim()) {
    queryParts.push(`Intent: ${intent.trim()}`);
  }
  queryParts.push(`Card type: ${cardType.join(', ')}`);
  queryParts.push(`Card content: ${cardContentExcerpt.slice(0, 500)}`);

  const queryText = queryParts.join('\n');

  try {
    return await computeEmbedding(apiKey, queryText, fetchImpl, appUrl);
  } catch (error) {
    console.warn('CrashWeaver Weaver: failed to compute query embedding —', error);
    return null;
  }
}

// ── Similarity map builder ───────────────────────────────────────────────────

/**
 * Builds a similarity map for all candidate notes against the query embedding.
 * Only notes with cached embeddings are scored; others get no boost.
 *
 * Returns the map and the number of notes that received an embedding boost.
 */
export function buildSimilarityMap(
  queryEmbedding: number[],
  noteEmbeddings: Map<string, number[]>,
): { similarityMap: EmbeddingSimilarityMap; boostedCount: number } {
  const similarityMap: EmbeddingSimilarityMap = new Map();
  let boostedCount = 0;

  for (const [filePath, embedding] of noteEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity >= MIN_SIMILARITY_THRESHOLD) {
      similarityMap.set(filePath, similarity);
      boostedCount += 1;
    }
  }

  return { similarityMap, boostedCount };
}
