# Weaver UX Enhancement Proposal

## Session History & Live Progress Feedback

**Date:** 2026-06-12  
**Author:** GitHub Copilot (DeepSeek V4 Pro)  
**Status:** Implemented (core features shipped 2026-06-19 in commit 2d65327)

---

## Part 1 — Current Implementation Evaluation

### 1.1 Architecture Overview

The Weaver module is a **pure procedural ReAct state machine** — no LangChain, no LangGraph. It uses 14 source files organized into a clean layered architecture:

```
weaveService.ts          ── Entry point, provider init, API key mgmt
  ├── openRouterClient.ts ── Provider orchestration (resolve model → run graph)
  ├── weaveGraph.ts       ── Sequential state machine loop (transition table)
  ├── weaveGraphState.ts  ── Typed state model + WeaveProgressEvent (11 variants)
  ├── weaveGraphNodes.ts  ── 6 node factories (callModel, executeTool, repair, finalize, validate, fail)
  ├── weaveContextService.ts ── Vault context snapshot + 7-tool runtime
  ├── weavePlanPrompts.ts ── 10-layer prompt architecture
  ├── weavePlanSchema.ts  ── Strict JSON schema validation
  ├── weaveModelProfiles.ts ── Model resolution, profiles, budgets
  ├── weaveHttpClient.ts  ── HTTP transport + exponential-backoff retry
  ├── weaveRequestLogger.ts ── JSONL session event logger
  ├── weaveTraceCompactor.ts ── Trace compaction to prevent unbounded growth
  ├── weaverSessionHistory.ts ── Session listing/get/delete from JSONL files
  └── weaverEmbeddingService.ts ── Semantic embedding search (cosine similarity)
```

### 1.2 What's Working Well

| Area | Assessment |
|------|-----------|
| **Backend session logging** | `WeaveRequestSessionLogger` writes structured JSONL with `session-start`, `node-call-model`, `budget-resolved`, `graph-complete`, etc. The logger captures request params, resolved model, budget, thought text, action type, tool results, and final outcomes. |
| **Session history CRUD** | `weaverSessionHistory.ts` provides `listWeaverSessions()`, `getWeaverSession()`, `deleteWeaverSession()`, `clearWeaverSessions()`. Sessions are sorted newest-first. Full plan data is extractable via `node-validate-success` events. |
| **IPC bridge** | `main.ts` has 4 session-history handlers (`weave:list-sessions`, `weave:get-session`, `weave:delete-session`, `weave:clear-sessions`). `preload.ts` exposes all 4 via `contextBridge`. |
| **Progress event pipeline** | `WeaveProgressEvent` discriminated union (11 variants) flows: node factory → `runWeaveGraph` → `OpenRouterWeaveProvider` → `weaveService` → `main.ts` IPC `weave:plan-progress` → renderer. |
| **Rich progress data** | Each event carries contextual data: `turn` number, `toolName`, `thought` text, `ok` status, `callsRemaining`, `repairType`, `operations` count, `latencyMs`. |
| **Trace is available post-hoc** | `WeavePlanResult.trace` contains a compacted ReAct trace with thought/action/observation per step, shown in the UI as expandable `<details>` elements. |

### 1.3 What's Missing / Under-Built

#### Gap 1: No Session History UI ★★★ (Critical)

The entire backend is built but **there is no frontend component** that renders session history. Users cannot:
- Browse past Weaver sessions
- View a past session's plan, intent, model, budget
- Re-run a past session with the same parameters
- Delete individual or all sessions
- Search/filter sessions by card UID, request kind, success/failure

The APIs are wired and tested — only the UI component is missing.

#### Gap 2: Minimal Live Progress Display ★★★ (Critical)

The current progress bar shows only a single label string:
```
"Thinking…" → "Reading note…" → "Validating plan…" → "Done — 3 ops"
```

The rich event data is **entirely discarded** in the renderer. The UI code in `WeaverProposalPanel.tsx` (lines 424–436):

```tsx
const e = event as { phase?: string; toolName?: string; operations?: number };
if (e.phase) {
  const label = e.phase === 'execute-tool-start' ? `Reading ${e.toolName ?? 'note'}…`
    : e.phase === 'call-model-start' ? 'Thinking…'
    : e.phase === 'validate-start' ? 'Validating plan…'
    : e.phase === 'graph-complete' ? `Done — ${e.operations ?? '?'} ops`
    : e.phase === 'graph-fail' ? 'Generation failed'
    : e.phase;
  setProgressPhase(label);
}
```

The following event data is **available but never shown**:
- `thought` — What the LLM is reasoning about before calling a tool or finalizing
- `parsedAs` — Whether the LLM returned a `tool`, `final`, or was `unparseable`
- `turn` — Which iteration of the ReAct loop we're on (e.g., "Turn 2 of 4")
- `callsRemaining` — How many tool calls remain in the budget
- `repairType` — What kind of repair is being attempted (syntactic, semantic, exhaustion)
- `repairAttempt` — How many repairs have been attempted
- `ok` — Whether a tool call succeeded
- `errorCategory` — What category of error occurred

#### Gap 3: No Re-Run from History ★★ (Important)

When viewing a past session, users cannot regenerate a plan with the same card, intent, model, and settings. This is a key VS Code Copilot feature that users expect.

#### Gap 4: Trace is Post-Hoc, Not Live ★ (Nice-to-have)

The ReAct trace (`WeavePlanResult.trace`) is only available after the plan completes. Users cannot see the trace being built in real-time. The progress events contain the same data — `thought` text, `action` descriptions, `observation` summaries — but they're not accumulated into a live trace feed.

#### Gap 5: No Clear Session Boundary in UI (Minor)

When a new plan starts generating, the previous result is cleared immediately. There's no concept of "this is session X, here are the results" in the UI — the panel is stateless between generations.

---

## Part 2 — Proposal: Session History Panel

### 2.1 UX Design (VS Code Copilot-Inspired)

The session history should follow VS Code Copilot's compact, IDE-like pattern. Based on the user's documented UI preference for "compact IDE-like UI over decorative card-heavy layouts", the design should be:

```
┌─────────────────────────────────────────────────┐
│ Weaver                                    [🗑] [×] │
│ ─────────────────────────────────────────────── │
│ [◀ Back to Weaver]                              │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🔍 Filter sessions…                         │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ Today ─────────────────────────────────────┐ │
│ │ ✅ guided-insert  CW-004    2s ago    3 ops │ │
│ │   "Insert TCP card into networking notes"   │ │
│ │   gpt-4o-mini · 1.2s · 3 ops                │ │
│ │                                              │ │
│ │ ❌ intelligent     CW-003   5m ago    fail   │ │
│ │   "Reorganize math vault around calculus"   │ │
│ │   claude-sonnet · timeout                   │ │
│ │                                              │ │
│ │ ✅ intelligent     CW-001   1h ago    8 ops  │ │
│ │   "Restructure web notes for React patterns"│ │
│ │   gpt-4o · 4.5s · 8 ops                     │ │
│ └──────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ Yesterday ─────────────────────────────────┐ │
│ │ ✅ guided-insert  CW-002   22h ago   1 op   │ │
│ └──────────────────────────────────────────────┘ │
│                                                 │
│ [Clear All Sessions]                            │
└─────────────────────────────────────────────────┘
```

### 2.2 Feature Set

#### 2.2.1 Session List View

- **Grouped by time**: Today, Yesterday, This Week, Older
- **Compact row per session**:
  - Status icon (✅/❌/⏳)
  - Request kind badge (`guided-insert` / `intelligent`)
  - Card UID chip (last 8 chars, clickable to navigate)
  - Intent preview (1 line, truncated)
  - Model name (compact)
  - Latency or error message
  - Operations count (if successful)
  - Relative timestamp
- **Filter bar**: Text search across intents, card UIDs, model names
- **Delete**: Individual delete (🗑 icon per row) + Bulk clear all (with confirmation)
- **Click to open detail**: Expands inline or navigates to detail view

#### 2.2.2 Session Detail View

When a session row is clicked:

```
┌─────────────────────────────────────────────────┐
│ [◀ Back to History]                        [🗑] │
│ ─────────────────────────────────────────────── │
│ ✅ Guided Insert · CW-004                       │
│ "Insert TCP card into networking notes"         │
│ ─────────────────────────────────────────────── │
│ Model:     openai/gpt-4o-mini                   │
│ Latency:   1.2s                                 │
│ Operations: 3                                   │
│ Tokens:    452 prompt / 189 completion          │
│ Started:   2026-06-12 11:30:27                  │
│ ─────────────────────────────────────────────── │
│ Plan:                                           │
│   ✓ insert-boundary-pair → notes/networking.md  │
│   ✓ edit-note-content   → notes/networking.md   │
│   ✓ create-note         → concepts/tcp.md       │
│                                                 │
│ Trace (3 steps):                                │
│   Step 1: "Checking candidate notes for TCP…"   │
│   Step 2: "Reading networking.md excerpt…"      │
│   Step 3: "Sufficient context gathered…"        │
│ ─────────────────────────────────────────────── │
│ [Re-run with Same Settings]  [Copy Plan JSON]   │
└─────────────────────────────────────────────────┘
```

#### 2.2.3 Re-run from History

The "Re-run with Same Settings" button:
1. Loads the session's original `request` payload
2. Pre-fills: card UID, intent, model, kind, strength, permissions
3. Switches back to the Weaver composer tab
4. Optionally auto-triggers generation

#### 2.2.4 Navigation Integration

- Add a **clock/history icon** button in the Weaver header toolbar (next to the close button)
- Clicking it toggles between "Composer" and "History" views
- The active session (currently generating) appears at the top of the history list with a ⏳ spinner

### 2.3 Technical Implementation

#### 2.3.1 New Component: `WeaverSessionHistory.tsx`

A new React component in `src/components/`:

```
WeaverSessionHistory.tsx
├── Props:
│   ├── sessions: WeaverSessionSummary[]
│   ├── onSelectSession: (sessionId: string) => void
│   ├── onDeleteSession: (sessionId: string) => void
│   ├── onClearAll: () => void
│   ├── onBack: () => void
│   └── isGenerating: boolean
├── State:
│   ├── filterQuery: string
│   ├── selectedSessionId: string | null
│   └── sessionDetail: WeaverSessionDetail | null (lazy loaded)
└── Sub-views:
    ├── SessionList (filtered + grouped)
    └── SessionDetail (full plan + trace + re-run)
```

#### 2.3.2 Modified Component: `WeaverProposalPanel.tsx`

Changes to integrate session history:

1. **New prop**: `sessions: WeaverSessionSummary[]` (or fetch internally)
2. **New state**: `view: 'composer' | 'history'`
3. **History toggle button** in header toolbar
4. **Re-run handler**: `onReRunFromHistory(session: WeaverSessionDetail)` — pre-fills all composer fields and optionally triggers generation
5. **Active session tracking**: When generating, record the session ID so it appears in history

#### 2.3.3 IPC Changes

The IPC bridge is already complete. No changes needed to `main.ts`, `preload.ts`, or `weaveService.ts`. The session history APIs are:
- `window.crashWeaver.listWeaverSessions()` → `WeaverSessionSummary[]`
- `window.crashWeaver.getWeaverSession(sessionId)` → `WeaverSessionDetail | null`
- `window.crashWeaver.deleteWeaverSession(sessionId)` → `boolean`
- `window.crashWeaver.clearWeaverSessions()` → `number`

#### 2.3.4 New Types in `vite-env.d.ts`

Already declared. No changes needed.

---

## Part 3 — Proposal: Live Progress Feedback Enhancement

### 3.1 Current State vs. Proposed State

| Aspect | Current | Proposed |
|--------|---------|----------|
| Progress display | Single string label | Multi-line live feed with thought/tool/status |
| Thought visibility | Hidden (only in post-hoc trace) | **Live** — shown as the LLM reasons |
| Tool call visibility | "Reading note…" (generic) | **Specific** — "Reading `notes/networking.md` (Turn 2/4, 3 calls left)" |
| Repair visibility | Not shown | **Shown** — "🔧 Repairing JSON syntax (attempt 1/2)" |
| Turn counter | Not shown | **Shown** — "Turn 2 of 4" |
| Error details | "Generation failed" (generic) | **Specific** — "❌ Rate limit reached · Retrying…" |
| Session boundary | None | Session ID, model, start time visible |
| Trace | Post-hoc only | **Live accumulation** — trace builds in real-time |

### 3.2 UX Design: Live Progress Feed

```
┌─────────────────────────────────────────────────┐
│ Weaver                                    [🗑] [×] │
│ ─────────────────────────────────────────────── │
│ [model ▼] [workflow ▼] [options ▼]              │
│                                                 │
│ ⬡ CW-004                                        │
│                                                 │
│ ┌─ Live Progress ─────────────────────────────┐ │
│ │                                              │ │
│ │  Turn 1  🤔 Thinking…                        │ │
│ │  "I need to find which notes reference TCP   │ │
│ │   to determine the best insertion point."     │ │
│ │                                              │ │
│ │  Turn 1  🔍 Reading notes/networking.md       │ │
│ │  (3 calls remaining)                         │ │
│ │  ✓ Found 450 chars · Covers TCP flags        │ │
│ │                                              │ │
│ │  Turn 2  🤔 Thinking…                        │ │
│ │  "The networking note has a Transport Layer   │ │
│ │   section — I'll insert after that heading."  │ │
│ │                                              │ │
│ │  Turn 2  📋 Finalizing plan…                  │ │
│ │  ✓ 3 operations generated                    │ │
│ │                                              │ │
│ │  ✅ Validating…                              │ │
│ │  ✓ Schema valid · 3 ops · 1.2s               │ │
│ │                                              │ │
│ └──────────────────────────────────────────────┘ │
│                                                 │
│ [Describe intent…]                              │
│                                                 │
│ 3 ops · 1.2s · gpt-4o-mini    [Regenerate]      │
└─────────────────────────────────────────────────┘
```

Key design principles:
- **Dense, not decorative** — follows user's compact IDE-like preference
- **Monospaced thought text** — distinguishes LLM reasoning from system messages
- **Color-coded status** — ✓ green (success), ❌ red (error), 🔧 amber (repair), ⏳ animated (in-progress)
- **Auto-scroll** — feed scrolls to keep latest event visible
- **Collapsible** — can be collapsed to a single-line summary during generation

### 3.3 Technical Design

#### 3.3.1 New Type: `WeaverLiveEntry`

Extend the progress model to accumulate live entries:

```typescript
interface WeaverLiveEntry {
  id: string;           // unique key for React
  ts: number;           // timestamp for ordering
  phase: WeaveProgressEvent['phase'];
  turn?: number;
  thought?: string;     // LLM's reasoning text
  toolName?: string;    // e.g., "read_note_excerpt"
  toolTarget?: string;  // e.g., "notes/networking.md"
  status: 'running' | 'ok' | 'error' | 'info';
  detail?: string;      // e.g., "Found 450 chars", "3 calls remaining"
  callsRemaining?: number;
  repairType?: string;
  repairAttempt?: number;
  operations?: number;
  latencyMs?: number;
  errorMessage?: string;
}
```

#### 3.3.2 New Component: `WeaverProgressFeed.tsx`

```typescript
// src/components/WeaverProgressFeed.tsx

interface WeaverProgressFeedProps {
  entries: WeaverLiveEntry[];
  isGenerating: boolean;
  onToggleCollapse: () => void;
  isCollapsed: boolean;
}

function WeaverProgressFeed({ entries, isGenerating, onToggleCollapse, isCollapsed }: WeaverProgressFeedProps) {
  // Renders a scrolling live feed of entries
  // Each entry has: icon, turn badge, phase label, thought text, detail
  // Auto-scrolls to bottom on new entry
}
```

#### 3.3.3 Changes to `WeaverProposalPanel.tsx`

1. **Replace** `progressPhase: string | null` state with `liveEntries: WeaverLiveEntry[]`
2. **Transform** `WeaveProgressEvent` → `WeaverLiveEntry` in the `onWeavePlanProgress` callback
3. **Accumulate** entries instead of overwriting
4. **Render** `<WeaverProgressFeed>` instead of the current single-line progress bar
5. **Add** session header showing: model name, start time, session ID
6. **Clear** entries on new generation start

The transformation logic:

```typescript
function progressEventToLiveEntry(event: WeaveProgressEvent): WeaverLiveEntry {
  const base = { id: crypto.randomUUID(), ts: Date.now() };
  
  switch (event.phase) {
    case 'call-model-start':
      return { ...base, phase: 'call-model-start', turn: event.turn, status: 'running' };
    case 'call-model-end':
      return {
        ...base, phase: 'call-model-end', turn: event.turn,
        thought: event.thought,
        status: event.parsedAs === 'unparseable' ? 'error' : event.parsedAs === 'invalid-shape' ? 'error' : 'ok',
        detail: event.parsedAs === 'tool' ? 'Calling tool…' : event.parsedAs === 'final' ? 'Finalizing…' : 'Parse issue',
      };
    case 'execute-tool-start':
      return { ...base, phase: 'execute-tool-start', turn: event.turn, toolName: event.toolName, status: 'running' };
    case 'execute-tool-end':
      return {
        ...base, phase: 'execute-tool-end', toolName: event.toolName,
        status: event.ok ? 'ok' : 'error',
        callsRemaining: event.callsRemaining,
        detail: event.ok ? 'Tool succeeded' : 'Tool failed',
      };
    case 'repair':
      return { ...base, phase: 'repair', repairType: event.repairType, repairAttempt: event.repairAttempt, status: 'info' };
    case 'validate-end':
      return { ...base, phase: 'validate-end', status: event.ok ? 'ok' : 'error' };
    case 'graph-complete':
      return { ...base, phase: 'graph-complete', operations: event.operations, latencyMs: event.latencyMs, status: 'ok' };
    case 'graph-fail':
      return { ...base, phase: 'graph-fail', status: 'error', errorMessage: event.error };
    default:
      return { ...base, phase: event.phase, status: 'info' };
  }
}
```

#### 3.3.4 Enhance Progress Events (Backend)

The current `WeaveProgressEvent` is already well-designed. Minor additions to improve the live feed:

1. **`execute-tool-start`**: Add `toolTarget?: string` (the filePath argument) so the UI can say "Reading `notes/networking.md`" instead of just "Reading note…"
2. **`execute-tool-end`**: Add `observationSummary?: string` (first 120 chars of observation) so the UI can show what was found
3. **`call-model-end`**: Already has `thought` — ensure it's always populated (it already is)

These are small, non-breaking additions to the existing event types.

### 3.4 CSS Variables Needed

```css
:root {
  --weaver-feed-bg: var(--bg-secondary, #1e1e1e);
  --weaver-feed-border: var(--border-color, #333);
  --weaver-feed-thought: var(--text-muted, #888);
  --weaver-feed-ok: var(--success-color, #4caf50);
  --weaver-feed-error: var(--error-color, #f44336);
  --weaver-feed-info: var(--info-color, #2196f3);
  --weaver-feed-running: var(--accent-color, #ffab40);
  --weaver-feed-turn-badge-bg: var(--badge-bg, #333);
}
```

---

## Part 4 — Implementation Plan

### Phase 1: Live Progress Feed (2-3 hours)

**Priority: ★★★** — Most visible UX improvement, uses existing infrastructure

| Task | File(s) | Effort |
|------|---------|--------|
| Add `toolTarget` and `observationSummary` to progress events | `weaveGraphState.ts`, `weaveGraphNodes.ts` | 30 min |
| Create `WeaverProgressFeed.tsx` component | New file | 1 hour |
| Transform progress events to live entries in `WeaverProposalPanel` | `WeaverProposalPanel.tsx` | 45 min |
| Add CSS for progress feed (animations, colors, layout) | `weaver.css` | 30 min |
| Remove old single-line progress bar | `WeaverProposalPanel.tsx` | 5 min |

### Phase 2: Session History UI (2-3 hours)

**Priority: ★★★** — Backend is complete, only UI missing

| Task | File(s) | Effort |
|------|---------|--------|
| Create `WeaverSessionHistory.tsx` (list + detail views) | New file | 1.5 hours |
| Add history toggle to Weaver header toolbar | `WeaverProposalPanel.tsx` | 30 min |
| Add CSS for session history (rows, grouping, detail) | `weaver.css` | 30 min |
| Wire session CRUD to UI (delete, clear all) | `WeaverSessionHistory.tsx` | 30 min |

### Phase 3: Re-Run from History (1 hour)

**Priority: ★★** — Key workflow improvement

| Task | File(s) | Effort |
|------|---------|--------|
| Add `onReRunFromHistory` callback prop | `WeaverProposalPanel.tsx` | 15 min |
| Implement "Re-run with Same Settings" button | `WeaverSessionHistory.tsx` | 30 min |
| Pre-fill composer fields from session data | Parent component | 15 min |

### Phase 4: Polish (1 hour)

| Task | Effort |
|------|--------|
| Active session appears in history with ⏳ spinner | 20 min |
| Filter/search for sessions | 20 min |
| Session grouping by time period (Today, Yesterday, etc.) | 20 min |

---

## Part 5 — Summary of Changes

### New Files

| File | Purpose |
|------|---------|
| `src/components/WeaverProgressFeed.tsx` | Live multi-line progress feed with thought/tool/status |
| `src/components/WeaverSessionHistory.tsx` | Session list + detail views with filter, delete, re-run |

### Modified Files

| File | Changes |
|------|---------|
| `electron/weaver/weaveGraphState.ts` | Add `toolTarget`, `observationSummary` to progress event variants |
| `electron/weaver/weaveGraphNodes.ts` | Populate new progress event fields in `executeTool` node |
| `src/components/WeaverProposalPanel.tsx` | Replace `progressPhase` with `liveEntries[]`; add history toggle; add re-run handler; add active session tracking |
| `src/styles/weaver.css` | Add ~80 lines: progress feed, session history rows, entry animations, grouping |
| `src/App.tsx` (or parent) | Fetch sessions list on mount; pass to Weaver panel; handle re-run |

### Unchanged Files (Backend Is Complete)

| File | Reason |
|------|--------|
| `electron/weaver/weaverSessionHistory.ts` | ✓ Already complete |
| `electron/weaver/weaveRequestLogger.ts` | ✓ Already complete |
| `electron/weaver/weaveService.ts` | ✓ Session wrappers already done |
| `electron/main.ts` | ✓ IPC handlers already done |
| `electron/preload.ts` | ✓ Bridge already done |
| `src/vite-env.d.ts` | ✓ Types already declared |

---

## Part 6 — Design Rationale

### Why Not a Chat-Like Interface?

The Weaver is a **planner**, not a conversational agent. It runs a bounded tool loop (1-6 iterations) and produces a structured JSON plan. A chat-like scroll with bubble messages would:
- Waste vertical space on decorative bubbles
- Imply a conversation when there isn't one (the LLM doesn't remember past turns — each is stateless)
- Add unnecessary interaction complexity (no user replies mid-generation)

The proposed **live feed** is more appropriate:
- Compact, dense, scannable
- Each entry is a single line + optional thought text
- Focus on information density (tool name, target, status, remaining budget)
- Familiar to developers (resembles build output, CI logs, terminal)

### Why Session History Like VS Code Copilot?

VS Code Copilot's session history is the gold standard for IDE-integrated LLM features:
- Sessions are automatically recorded (no user action needed)
- History is browsable but out of the way
- Re-running is a single click
- Sessions are grouped by time period
- Individual sessions can be deleted

This pattern maps perfectly to Weaver's use case: each plan generation is a discrete session with clear inputs (card, intent, model) and outputs (plan, trace, metrics).

---

**End of Proposal**
