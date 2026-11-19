# QA pass — live-provider and renderer scenarios (2026-11-19)

A black-box pass over the built Electron app using the headless harness
(`/root/crashweaver-headless`), a throwaway copy of `fixtures/mock-vault`, and a real OpenRouter key.
Its purpose was to exercise the scenarios `tests/README.md` names as untested — the renderer UI, the
live Weaver provider path, review orchestration, and the settings/credential flows.

Environment note: this container's region cannot reach OpenAI, Google or Anthropic models through
OpenRouter (`403 "This model is not available in your region"`). DeepSeek, Meta and Qwen models
work. That is an environment fact, but it also means the app's **default model**
(`openai/gpt-4o`, `src/hooks/useWeaverController.ts:19`) fails out of the box here, so every live
weave below used `deepseek/deepseek-chat` selected through the model picker.

## What was exercised

| Area | Scenario | Result |
| --- | --- | --- |
| Vault | Open fixture vault through the patched picker; index rebuild | PASS — 13 notes, 20 crashpads, 2 diagnostics |
| Settings | Save OpenRouter key; provider flips to OpenRouter | PASS |
| Weaver | Guided-insert weave with live model; tool calls; plan; apply | PASS — 1 op, applied, boundary pair written |
| Weaver | Intelligent weave (`standard`); create-directory + create-note; apply | PASS — 48 s, 2 ops, directory and note created |
| Weaver | Provider error path — region-blocked `openai/gpt-4o` | PASS — error surfaced (`OpenRouter auth error: …`) |
| Weaver | Session history — list, detail, delete, re-run settings | PASS |
| Weaver | Unified diff modal — create-note preview | PASS |
| Crashpad | Create card; fill content/memory technique; save | PASS |
| Crashpad | Attach existing by case-insensitive title; duplicate attach rejection | PASS |
| Crashpad | Delete card with strict-confirmation checkbox; boundary removal | PASS — boundaries stripped, snapshot kept |
| Crashpad | Restore and reinsert boundaries | PASS |
| Review | Start session (19 due); rate Good; rate Again (requeued, `next_review` today) | PASS |
| Review | Rate all to completion; Done; re-open with nothing due | PASS — completion and empty states |
| Notes | Source edit, dirty marker, Ctrl+S save, card sync | PASS |
| Notes | Unsaved-change guard on surface switch | PASS — refuses with status message |
| Notes | Path field rewrite (`web/http.md` → `web/http-responses.md`) | PASS as documented **Save as**; see #11 |
| External change | Append to open note on disk; chokidar push | Catalogs refresh; open editor content stays stale — see #12 |

## Findings

Ordered by user impact. Each names the file where the cause is observable.

1. **Review surface header collides with the window utility strip.** `Exit review` sits underneath the
   `≣`/`⚙` buttons; the two overlap at the top-right of the editor pane. Reproduced on the review
   surface and the completion screen. (`review.css` / `AppChrome`)
2. **A freshly generated plan can show stale `APPLIED` badges.** The applied-operation set is keyed
   by plan index and is not cleared when a new plan/session replaces the old one, so plan index 0
   from a previous run marks op 0 of the new plan as applied. Misleading about what has been
   written. (`src/components/WeaverProposalPanel.tsx`, `appliedOps`)
3. **Session history says `Plan validated — ? operations ready`.** The history mapper expects
   `operations` to be an array, but `node-validate-success` logs it as a number, so the fallback `?`
   renders. Visible in every session detail. (`electron/weaver/weaverSessionHistory.ts:168`)
4. **`Demo Mode` badge is stale after saving a key.** The stub-provider probe runs once on mount;
   saving an API key does not re-query it, so a live provider still reads "Demo Mode" until reload.
   (`src/components/WeaverProposalPanel.tsx:530`)
5. **`create-note` duplicates its title.** The apply handler prepends `# ${title}` and the prompt's
   own create-note example puts an H1 of the title in `content`, so the note opens with two
   identical H1s. Reproduced on disk (`networking/tcp-handshake.md`).
   (`electron/weaver/weaveApplyNoteHandlers.ts:258`, `electron/weaver/weavePlanPrompts.ts`)
6. **The Weaver's operation titles are truncated to ~10 characters** in the narrow right panel
   (`Create dir…`, `Create vau…`) even though card titles were fixed for the chip (#23). The panel is
   the app's densest surface and the least legible.
7. **Session-history rows overflow the right panel**: the kind, card, intent, model, op count and age
   all try to share one line; meta is clipped and the row is cut on the right.
8. **The Weaver needs the crashpad tab active to generate.** Switching to a note leaves the composer
   saying "Open a crashpad to start a Weaver session" while the crashpad tab is still open. This is
   arguably by design (focused crashpad card), but the empty-state copy does not say *switch back to
   the crashpad tab*, so the next action is unclear to the user.
9. **Progress feed, session history and tree/tab chrome use emoji/unicode glyphs** (`🤔 🔍 📋 ✨ ✅ 🗑`,
   `▸ ▾ •`, `↺ ↻ ⤓`). The Weaver menus already use SVG icons, so the app is internally inconsistent,
   and the emoji are the single strongest "generated UI" signal.
10. **The app opens onto leftover scratch content.** With no vault, the editor pre-fills
    `Inbox/Stage-2-scratch.md` / `# Stage 2 Scratch Note`, which reads as stale test data rather than
    a welcome. Already recorded as an observation in `docs-open-questions.md`; it is the first thing
    a new user sees.
11. **The path field behaves as "Save as", not "rename".** Documented, but unlabelled: saving a new
    path leaves the old note in place, so the same card UID can end up bounded in two notes and the
    card gains a duplicate reference. The UI gives no hint that this creates a copy.
12. **An externally changed open note is not reloaded.** The watcher refreshes catalogs but the open
    editor keeps stale text with no "changed on disk" indicator; the user has to close/reopen.
13. **Error label is imprecise.** A region-blocked model surfaces as `OpenRouter auth error: …`;
    "auth error" suggests a bad key, and a 403 geo-block is neither auth nor user-fixable by a new
    key.
14. **Model picker lists models the key cannot call**, including region-blocked ones, with no
    availability signal; the first live weave on the default model is a dead end here.
15. **Inconsistent micro-interaction states**: apply buttons stay disabled with no explanation, the
    editor Save icon is unchanged for dirty/saved, and the status bar keeps stale text (`Reviewing 18
    due cards.` after the session completed).

## What the follow-up pass changed

The same session continued into the visual and state pass below. Status against the list:

| # | Status | What changed |
| --- | --- | --- |
| 1 | fixed | The floating utility strip became a real title bar above the layout grid, so no surface can collide with it. |
| 2 | fixed | `WeaverProposalPanel` clears its index-keyed accepted/rejected/applied/expanded sets whenever the plan changes. |
| 3 | fixed | `weaverSessionHistory` reads the numeric `operations` payload field (and still tolerates the array form), so the step reads `Plan validated — N operations ready`. |
| 4 | fixed | The stub-provider probe re-runs when provider health changes, so saving a key clears the Demo Mode badge without a reload. |
| 5 | fixed at the prompt | Create-note guidelines and both canonical examples no longer put the title's H1 in `content`; the system still writes `# title`. Pinned by a prompt test. |
| 6 | fixed | Operation titles wrap to two lines in the narrow panel instead of ellipsizing at ~10 characters. |
| 7 | fixed | Session rows are a four-row grid (status, kind/time, card, intent, meta) instead of one clipped line. |
| 8 | partially | The status now reads `Not connected` until a crashpad is open; the empty-state copy is unchanged. |
| 9 | fixed | An SVG icon set (`src/components/AppIcon.tsx`) replaces the emoji and unicode glyphs across the chrome, tree, tabs, review, Weaver feed and session history. |
| 10 | fixed | A welcome surface replaces the leftover scratch draft, and the default draft is an empty `Untitled.md`. |
| 11 | labelled | The note-path input now states that saving to a new path creates a second note rather than renaming. Behaviour unchanged. |
| 12 | open | Still catalog-refresh only; the open editor keeps its stale text. Worth its own issue. |
| 13 | fixed | A region-gated 403 maps to `config-error` with "choose a different model" rather than `auth-error`. Pinned by an HTTP-client test. |
| 14 | open | The picker still lists region-blocked models; no availability probe was added. |
| 15 | mostly fixed | Disabled states, dirty-tab marker, status bar and hover/focus states were unified. The stale `Reviewing N due cards.` status text is unchanged. |

The broader visual overhaul is recorded in [`docs/reference/interface.md`](../../docs/reference/interface.md):
one token layer, one icon set, a title bar, a welcome surface, restyled every surface, and the
`--weaver-*` palette layer defined in `foundation.css`.
