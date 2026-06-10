/**
 * weaveCostPolicy.ts
 *
 * @deprecated Import from weaveModelProfiles.ts directly.
 * This file is kept as a backward-compat re-export for any compiled JS
 * or external consumers that still reference it.  Will be removed in a
 * future cleanup.
 */

export {
  DEFAULT_MODEL_BY_UI_TIER,
  resolveModel,
} from './weaveModelProfiles';

// Legacy type exports — the canonical WeaveStructuredOutputMode is now
// defined in weaveModelProfiles.ts without the 'json_schema' variant.
export type { WeaveStructuredOutputMode } from './weaveModelProfiles';
