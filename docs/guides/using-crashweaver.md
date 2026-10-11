# Using CrashWeaver

CrashWeaver turns a folder of markdown — your **vault** — into a spaced-repetition knowledge base.
Notes carry **UID boundaries** around the text belonging to a card, each card's full payload lives
in a **card store** next to the vault, and the **Weaver** proposes note and folder changes that you
approve before anything is written. The vocabulary is defined in [CONTEXT.md](../../CONTEXT.md);
see the [documentation index](../README.md), the [data model](../architecture/data-model.md) and
the [weave pipeline](../architecture/weave-pipeline.md) for what happens behind the UI, and
[development setup](./development-setup.md) for building from source.
## 1. Open a vault

1. Click the gear button (⚙, tooltip "Open settings") in the top-right utility strip.
2. In **Vault Settings**, under **Vault actions**, click **Open Vault** (it reads **Change Vault**
   once a vault is loaded) and pick the folder.
3. Read the status bar below the editor: `Vault opened and .crashweaver/index.json synchronized.`
   followed by a rebuild summary such as
   `Card rebuild: 42 notes, 3 card updates, 0 stale references removed, 1 diagnostics.`

Opening a vault scans every markdown file, parses its boundaries, rebuilds the card store from the
notes and writes `.crashweaver/index.json`; **Open first note automatically after vault load** then
decides whether to open the first note.

The vault is watched after that: a file changed outside the app is re-synced into the card store and
the index, card catalogs and tree are refreshed, and deleting a note removes its references.
`.crashweaver/` and the card store folder are ignored, and an open draft is never overwritten.
Re-scan on demand with **Settings → Refresh Index**; **Choose Card Store**, **Choose Image
Directories** and **Use Vault Root Only** configure where cards and images live.
## 2. The shell

The window is a widget rail, a left sidebar, the editor surface and the right panel.

| Region | What it shows | Collapse / resize |
| --- | --- | --- |
| Widget rail (far left) | `☰` "Toggle explorer pane", `CP` "Open daily Crashpad", `+` "Extensions placeholder" | `☰` toggles the sidebar; `CP` is disabled until a vault is open; `+` only posts a status message |
| Sidebar | Tabs **Explorer** and **Vault** | `☰`, or drag the `Resize explorer pane` splitter |
| Editor pane | Tab strip, view-mode tabs, active surface | Drag either splitter |
| Right Panel | **Info** and **LLM** toggle buttons, context sub-panel above the Weaver panel, and the top-right strip's `≣` "Toggle right panel" / `⚙` "Open settings" | `≣`, or the `×` on a sub-panel; settings closes on **Close**, Escape, or a click outside |

The **Explorer** tab (`Files`, `ExplorerTree`) is a virtualized tree: folders expand with `▸`/`▾`, files open with a
click, and the selected row is highlighted. Notes are listed without `.md`, crashpads without
`.crashpad.json`, cards by UID. `.crashweaver/` is always shown; other dot-files appear only when
**Reveal hidden files and directories in the tree** is enabled. With no vault loaded it reads
`Select a vault to load markdown notes and crashpad files.` The **Vault** tab (`Vault Info`)
summarizes **Path**, **Card store**, **Markdown files**, **Crashpads**, **Indexed entries** and
**Last rebuild**. The **Info** half of the right panel adapts to focus and resizes against the
Weaver half with the `Resize right panel sections` splitter; a sub-panel's `×` is disabled while it
is the last one open.
## 3. Notes: open, edit, save, preview

1. Click a note in the Explorer tree; the status bar reports `Loaded <path>.`
2. Choose **Source**, **Preview** or **Cards** with the view-mode tabs above the editor. In
   **Source**, type into the editor (`Write markdown...`), or change the path field at the top to
   save the draft elsewhere — a path that does not exist yet is created on save.
3. Save with the `⤓` button (tooltip "Save (Ctrl+S)") or **Ctrl+S** / **Cmd+S**; the status bar
   reports `Saved <path> and refreshed .crashweaver/index.json. Card sync: x created, y updated,
   z removed.` **Reset** (tooltip "Discard changes") drops the draft and restores the last saved
   content.

Tabs accumulate as you open files: a dirty tab shows `*`, `×` closes it (tooltip `Close <name>`),
and tabs can be dragged into a new order. CrashWeaver refuses to lose work — switching dirty notes
or tabs reports `Save or discard current changes before switching notes or tabs.`, closing the active
dirty tab reports `... before closing the active tab.`, and **Reset** stays disabled until there is
something to discard.

**Preview** renders the draft as HTML: raw HTML is allowed, but `script`, `iframe`, `object`,
`embed`, `form`, `style`, `meta`, `link`, `base` and inline `on*` handlers are stripped, relative
image and link paths resolve against the vault root or configured image directories, and `$…$` /
`\[…\]` math renders with KaTeX. Source and preview are separate views, not a split pane.

**Cards** (`CardsWorkspace`) shows the cards linked to the current surface: the `Cards scope` switch chooses **Note**
(boundaries in this note) or **Vault** (every card in the store), and the rail and detail panel read
each card through **Content**, **Memory Technique**, **QnA** (**Reveal answer** / **Hide answer**)
and **Meta data**, with a **Parser Diagnostics** panel in note scope. The vault-wide list is still a
placeholder hinting at a **Future vault card picker** with search and filters.
## 4. Crashpads and cards

A **crashpad** (`CrashpadWorkspace`) is the authoring surface where cards are composed before being woven into notes. It
stores only card UIDs and how each card got there; every payload stays in the card store.
### Open or create a crashpad

1. Open a crashpad file from the Explorer tree, or click `CP` in the widget rail (tooltip "Open
   daily Crashpad"). `CP` opens today's **daily crashpad** at
   `.crashweaver/crashpads/<YYYY-MM-DD>.crashpad.json`, creating it if needed, and reports
   `Loaded daily crashpad <YYYY-MM-DD>.` Existing crashpads are listed in the sidebar's **Vault**
   tab and open from the tree.

> Open question: the UI has no control for creating a *named* crashpad — the daily crashpad is the
> only creation path wired up, although `useCrashpadActions.handleCreateCrashpad` exists. Add a
> "New crashpad" control, or is the daily crashpad the only intended entry point?
### Add and edit cards

The header shows the crashpad's name, path, **Created**/**Updated** timestamps, a card count and
**Undo** / **Redo**, with **Cards** and **History** tabs below.

1. Click **+ Add Card** (it becomes `— Close`) and choose **Attach existing**, typing a UID such as
   `CW-001` into `Enter existing card title / ID (e.g. CW-001)`, or **Create new**, typing into
   `Enter new card title / ID (e.g. CW-002)`. Press **Attach**/**Create** or Enter, then pick a card
   from the rail — each entry shows its UID, whether it is `new` or `attached`, and its refs.
2. In **Edit** mode fill in **Card title / ID**, **Tags (comma-separated)**, **Familiarity**,
   **Next review** (`ISO date or blank`), **Content (markdown)**, **Memory technique** and
   **QnA Pairs** (**+ Add pair**, `×` to remove one), then press **Save** (`Saved card <uid>.`).
   Renaming the UID rewrites boundaries in every note that used the old UID and every crashpad
   listing the card: `Renamed card <old> to <new>. Updated N notes and M crashpads.`
3. **Preview** reads the card back through the **Content**, **Memory Technique**, **QnA** and
   **Metadata** tabs, where the toolbar says `Switch back to Edit to save or copy this card embed.`
### Delete, undo and restore

1. Press **Delete card** (it becomes **Cancel**), then **Confirm delete** — with **Require
   confirmation when deleting cards** on, first tick `Confirm deletion of this card from the store`.
2. Deleting removes the card from the crashpad and deletes its file from the card store; with
   **Remove note boundaries by default when deleting cards** on, its boundary pairs leave the notes
   too, and the status bar reports how many notes and lines were affected.
3. The **History** tab keeps a snapshot of every card deleted from the crashpad: its origin
   (`was new` / `was attached`), when it was deleted, and a `boundaries removed` marker. Restore it
   with **Restore card**, or **Restore and reinsert notes** / **Restore and forget old links**.
4. **Undo** / **Redo** walk the crashpad's own action stack — attach, create, save, delete — not the
   text you type, reporting `Crashpad undo applied.` / `Crashpad redo applied.`; undoing a creation
   deletes the card file again, undoing a deletion restores the card and reinserts its boundaries
   where the snapshot still matches. The stack clears when a vault is opened or a crashpad created.
## 5. Place a card into a note by hand

A card sits in a note as a pair of boundary comments around the text that belongs to it; those
markers are the only link between note and card. See [boundary format](../reference/boundary-format.md)
for the exact strings and parsing rules, [card insert templates](../reference/card-insert-templates.md)
for block shapes, and [card schema](../reference/card-schema.md) for the card fields.

1. Open the crashpad, focus the card, and stay in **Edit** mode.
2. Click **Copy embed** (tooltip "Copy card embed comment for pasting into a markdown note"). The
   button reads `Copied!` for a moment and the clipboard holds `%%CW_CARD_START uid:<UID>%%`, a blank
   line, and `%%CW_CARD_END uid:<UID>%%`.
3. Open the target note in **Source** and paste the markers where the card belongs, with the card's
   text between them. Keep each marker on its own line, use only letters, numbers, underscores or
   dashes in the UID, and make both markers match.
4. Save the note: the boundaries are parsed, the card is linked to that span, its references and
   `.crashweaver/index.json` are updated, and the status bar confirms the card sync. Editing the card
   later and pressing **Save** updates the stored payload, not the text inside the boundaries.
## 6. Ask the Weaver for a plan

The Weaver lives in the right panel's **LLM** sub-panel. It needs an open crashpad with at least one
card; the focused card is the one it works from (otherwise the first card in the crashpad), and its
chip shows the last eight characters of the UID.

1. The header shows the provider, or a `Demo Mode` badge when no OpenRouter key is configured — the
   offline stub provider still generates plans — and an inline dot reading `Checking…` or
   `Unavailable`.
2. Pick a model with the model button (tooltip `Model: <name>`): search with `Search models`, choose
   from the featured list or expand **Other Models**, and use the gear to open `openrouter.ai/keys`.
3. Pick a workflow with the workflow button (tooltip `Workflow: <name>`): **Guided Insert** ("Insert
   into vault notes, with optional note edits or new-note creation.") or **Intelligent** ("Plan
   broader note and directory restructuring around the focused card."). Then pick options with the
   options button (tooltip `Options: <label>`):
   - Guided Insert always allows inserting and adds **Edit content** ("Allow note prose edits around
     the insertion point.") and **Create note** ("Allow Weaver to propose a new markdown note when
     insertion into an existing note is not enough."); with neither selected it reads `Insert only`.
   - Intelligent replaces those with a strength — **Light** ("Low-churn vault cleanup."), **Standard**
     ("Balanced restructuring."), **Go Ham** ("Aggressive vault reorganization.") — which changes
     autonomy only, never the model.
4. Describe the goal in the intent box (`Describe where this card should land in the vault or what
   restructuring Weaver should plan. (Ctrl+Enter to generate)`), then press **Ctrl+Enter** or click
   **Generate** (later `Regenerate`). Without a crashpad the panel reads `Open a crashpad to start a
   Weaver session in the right panel.`

While it runs, **Live Progress** (`WeaverProgressFeed`) streams the run: `Thinking`, tool steps such as `Read full note` or
`Search notes` with their target, `Repair: <type> (attempt n)`, `Validating…`, and finally
`Done — N ops · Mms`, under a header showing the model and the tool-call budget. Tool steps expand
with **Tool arguments**, the feed collapses with `−` / `＋`, and problems appear as chips such as
`Reads exhausted` or `Tool args invalid`. The finished plan also carries the run as a **ReAct trace**
— a step timeline (`N steps`, or `✨ Done — N ops · Mms`) expandable to replay those thoughts, tool
calls and observations.

The clock button (tooltip "Session history") opens past runs grouped into **Today**, **Yesterday**,
**This Week** and **Older**, filterable with `Filter sessions…`. Each row shows `Guided` or
`Intelligent`, the card, the intent, the model, `N ops · Mms` (or the error) and how long ago it ran;
open one for its status, latency, **Thinking Steps (N)**, **Plan Summary**, **Operations (N)** and
**Raw Plan JSON**, then **Re-run with Same Settings**
(`Re-loaded settings from session. Press Generate to re-run.`). The `🗑` on a row deletes that session
and **Clear All Sessions** deletes them all, while `+` ("New session — clears current proposal")
starts fresh (`Started a new Weaver session.`).
### Budgets

**Settings → Weaver → Budgets & Restrictions** limits what a run may spend. **Disable All LLM Token
& Timeout Restrictions** turns every limit off and hides the fields; otherwise each profile has its
own token, timeout and iteration limits (`Tokens: 100–32000`, `Timeout: 5000–600000 ms`,
`Iterations: 1–20`): **Guided Insert Mode** (default 1400 tokens / 30s), **Guided Insert Mode
Expanded** (default 2200 tokens / 45s), **Intelligent Light / Standard / Go Ham Mode** for the three
strengths, and **Max Plan Operations (1–20)**, which caps the operations in a plan per workflow and
strength.

The same screen holds the OpenRouter key (**Save Key** / **Remove Key**, placeholder `sk-or-…`) and
the warning that cloud mode sends selected vault context to OpenRouter.
## 7. Review and apply a plan

Nothing is written until you approve it. Each staged operation is a row with its label — **Embed into
note**, **Edit note content**, **Create vault note**, **Rename note**, **Move note**, **Delete note**,
**Create directory**, **Rename directory**, **Move directory**, **Delete directory** — and its path.

1. Expand a row (`WeaverOperationItem`) with its chevron for the rationale and an inline preview (boundary insertion, a line
   diff for content edits, a new-note preview, an old-path → new-path arrow for renames and moves, a
   `⚠` block for deletions), or click the row to open the unified diff overlay
   (`WeaverUnifiedDiffModal`). The overlay reloads the target note and shows the whole file
   (`@@ full file diff @@`) with `+`/`−` counts, scrolled to the first change; close it with `×`
   ("Close diff view").
2. Accept with `✓` ("Accept this change") or reject with `✕` ("Reject this change"); clicking again
   clears the choice, and an applied row shows an **Applied** badge instead of buttons.
3. Click **Apply accepted (N)** or **Apply all (except rejected)**; while it runs the button reads
   `Applying…`.
4. A destructive operation (delete, rename or move of a note or directory) triggers **Confirm
   destructive changes** (`WeaverConfirmDialog`) first: it lists the operations, warns that "These
   changes cannot be undone automatically." and that files and directories will be permanently
   renamed, moved or deleted, and requires `I understand these changes will modify my vault files
   (<kinds>)` before **Apply N changes** becomes clickable. **Cancel** abandons the apply.
5. Read the result banner: `N applied, M failed` with `✓` or `⚠`, plus each failure's operation kind,
   target path and error message, and any warnings. A fully successful apply reports
   `Applied N Weaver operation(s) successfully.` and refreshes the vault, card catalog and crashpad
   catalog. Apply stops at the first failure: later operations come back as `Skipped due to previous
   failure.` and the status bar reads `Applied X/Y operation(s). Z failed. Check the results.`
## 8. Card metadata: familiarity and next review

**Familiarity** and **Next review** belong to the card, not to the note. They are edited in the
crashpad card editor's **Edit** mode — **Familiarity** (a number; a non-numeric entry is stored as
`0`) and **Next review** (`ISO date or blank`) — and written when you press **Save**.

Everywhere else they are read-only: the card detail **Meta data** tab shows **Familiarity**,
**Next review** (falling back to `Not scheduled`), the **Current reference** note and its **Boundary
lines**, the **Card file** path and the number of **Linked references**; in the crashpad's
**Metadata** preview tab the values are the ones currently in the editor.

> Open question: familiarity is stored as a plain number with no range or scale enforced by the
> editor, and nothing in the UI updates it from review. Constrain the field, or leave it as loose
> scheduling state until the review loop exists?
## 9. Errors and edge states

The status bar below the editor carries status and error messages; the crashpad editor repeats them inline.

| Situation | What you see |
| --- | --- |
| No vault open | Explorer reads `Select a vault to load markdown notes and crashpad files.`; `CP` is disabled; saving, refreshing and card-store actions report `Select a vault before ...` / `Open a vault before ...`; the Weaver panel says `Open a crashpad to start a Weaver session in the right panel.` |
| No crashpad or no card for a weave | `Open an active crashpad before using Weaver.` or `Attach or focus a crashpad card before generating a Weaver proposal.` |
| Missing target note during apply | That operation fails with `Note not found: <path>`, later operations are skipped, and the failure is listed in the apply result |
| Target text moved since the plan was generated | `Target text not found in note "<path>". The note may have been modified since the plan was generated.` |
| An operation would escape the vault | `Path escapes vault root: <path>` |
| An edit would break the boundary pairs | The write is refused and the operation fails with `Boundary integrity check failed for <path>: [<code>] <message>` |
| A heading named in an operation no longer exists | Not fatal: the insert falls back to the start or end of the note, and the apply result carries a warning such as `Heading "<h>" not found; appended to end of note.` |
| Malformed boundaries in a note | The note still opens. In the **Cards** view a **Parser Diagnostics** panel lists each problem as `Line N` plus a message — for example `Card start boundary must follow the format %%CW_CARD_START uid:<UID>%%.`, `Card end boundary for X does not match the active start boundary Y.` or `Card start boundary for X does not have a matching end boundary.` — and the note's pill shows the diagnostic count. With no readable pairs it instead reads `This note does not currently contain any CW_CARD_START and CW_CARD_END boundary pairs.` |
| A card UID that is taken, empty, or has illegal characters | `Card <uid> is already in this crashpad.`, `Card title / ID is required.` or `Card title / ID must use only letters, numbers, underscores, or dashes.` |
| An unexpected render error | `AppErrorFallback` replaces the window with `Something went wrong in CrashWeaver`, **Reload** and **Copy details**, and a note that your vault files have not been modified |
## 10. Limits, and where CrashWeaver writes

Three places say so out loud: the `+` widget button only posts `Widget extensions will be added here
in a later stage.`, the card list carries a **Future vault card picker** hint, and the Info panel
notes the crashpad stays source-only. There is also no UI for naming a crashpad, and no review loop.

| Path | Contents |
| --- | --- |
| `.crashweaver/index.json` | The vault index, rebuilt on open, on save and on refresh |
| `.crashweaver/cards/<UID>.json` | The default card store: one file per card (configurable in Settings) |
| `.crashweaver/crashpads/<id>.crashpad.json` | A crashpad: card UIDs with their origin, plus deleted-card snapshots |
| `.crashweaver/weaver-request-logs/*.jsonl` | Weaver session history |

CrashWeaver only ever reads and writes inside the vault you opened.
