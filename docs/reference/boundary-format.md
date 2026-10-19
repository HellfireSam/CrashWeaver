# Boundary format

A **UID boundary** is the paired marker that attributes a span of a [note](../../CONTEXT.md) to one
card. The pair carries the card's UID and nothing else: `raw_content`, metadata and memory tricks live
in the card store, and the note holds only the markers and the prose they wrap. The position of a pair
is stored per card in `referenced_in`, whose field shapes are specified in
[Card schema](./card-schema.md); how boundaries participate in a weave is described in
[The weave pipeline](../architecture/weave-pipeline.md).

`electron/cardParser.ts` is the only parser of the format. `parseCrashCardsFromNote` turns note text
into a `ParsedCrashCardsNote` — parsed cards plus parser reports — and `electron/cardSyncService.ts`
wraps it as `parseCrashCardsNote`. Other modules test for marker text without parsing the grammar
(the Weaver's plan validation and the renderer's diff previews look for the literal
`%%CW_CARD_START`). Everything else in this document either formats markers, consumes the parse
result, or mutates the text.

## Marker syntax

The two patterns are defined verbatim in `electron/cardParser.ts`:

```ts
const START_BOUNDARY_PATTERN = /^%%CW_CARD_START\s+uid:([A-Za-z0-9_-]+)%%$/;
const END_BOUNDARY_PATTERN = /^%%CW_CARD_END\s+uid:([A-Za-z0-9_-]+)%%$/;
```

| Slot        | Accepted form                               | Notes                                                                                                                                                                      |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marker text | literal `%%CW_CARD_START` / `%%CW_CARD_END` | No case folding: both patterns are case-sensitive, and the fallback prefix checks use `String.prototype.startsWith` with the same literal.                                 |
| Separator   | `\s+`                                       | One or more whitespace characters between the marker text and `uid:`.                                                                                                      |
| UID key     | literal `uid:`                              | Lowercase only. No whitespace is permitted between `uid:` and the UID, or between the UID and `%%`.                                                                        |
| UID         | `[A-Za-z0-9_-]+`                            | ASCII letters, digits, underscore and hyphen; at least one character. The card store enforces the same alphabet with `CARD_UID_PATTERN` in `electron/cardStoreService.ts`. |
| Terminator  | `%%` at end of line                         | The patterns are anchored with `^` and `$`, and the parser matches one trimmed line at a time.                                                                             |

A marker is recognised only when it is a whole line. `parseCrashCardsFromNote` computes
`const line = rawLine.trim()` before matching, so indentation and trailing whitespace are tolerated
around an otherwise exact marker. `formatCardStartBoundary` and `formatCardEndBoundary` emit the
canonical single-space form, `%%CW_CARD_START uid:<UID>%%`, and that is what the app's own mutation
services and the manual copy-embed path produce. It is **not** guaranteed for a Weaver-supplied
block: `applyInsertBoundaryPair` persists the plan's `boundaryBlock` as written, and
`assertBoundaryBlockIncludesCard` only requires the focused card's canonical markers to appear
somewhere in it. A plan can therefore place a pair the parser accepts (with `\s+` between the
prefix and `uid:`) but the mutation services cannot strip or rename, because they compare against
the canonical marker exactly.

## Pairing rules

`parseCrashCardsFromNote` walks the note line by line, keeps at most one `activeBoundary`
(`{ uid, line }`), and closes it when the matching end marker arrives.

- A start marker opens the active boundary and records its 1-based line.
- An end marker whose UID equals the active UID closes the pair and produces a `ParsedCrashCard`.
- An end marker whose UID differs is reported and ignored; the active boundary stays open.
- An end marker with no active boundary is reported and ignored.
- A start marker while a boundary is already active is reported and ignored, whatever UID it names.
- A still-active boundary at end of file is reported once.

| Note content                                 | Result                                                                                                                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid start and end for the same UID         | One card, no diagnostic.                                                                                                                                                                                                                                  |
| Nested start (`START a`, then `START b`)     | `nested-start-boundary` for `b`; `b`'s start is ignored. A later `END b` becomes `mismatched-boundary-uid` while `END a` closes the outer card, whose block swallows the inner markers; if `END a` comes first, `END b` becomes `unmatched-end-boundary`. |
| Crossing pairs (`START a`, `END b`, `END a`) | `mismatched-boundary-uid` at `END b`; the `a` card still closes at `END a`, so its block contains the stray `END b` line.                                                                                                                                 |
| Duplicate UID pairs in one note              | The parser emits no diagnostic; `dedupeParsedCards` in `electron/cardSyncService.ts` keeps the first card and reports the rest.                                                                                                                           |
| Unpaired start                               | `unmatched-start-boundary` at the start marker's line.                                                                                                                                                                                                    |
| Unpaired end                                 | `unmatched-end-boundary` at the end marker's line.                                                                                                                                                                                                        |

Malformed markers do not stop the walk. A line whose trimmed text begins with `%%CW_CARD_START` but
does not match `START_BOUNDARY_PATTERN` is reported, ignored, and does not open a boundary; the same
applies to `%%CW_CARD_END`. Because the non-matching fallbacks are still case-sensitive prefix tests, a
lowercase `%%cw_card_start uid:x%%` is silently ignored rather than reported.

## Diagnostic taxonomy

`CardParseDiagnosticCode` in `electron/vault-contract.ts` names the parser codes; the shape is
`CardParseDiagnostic` (`code`, `line`, `message`, `severity`, optional `uid`).

| Code                       | Cause                                                                | Line reported          | `uid`      |
| -------------------------- | -------------------------------------------------------------------- | ---------------------- | ---------- |
| `invalid-start-boundary`   | A line starts with `%%CW_CARD_START` but does not match the pattern. | The offending line.    | absent     |
| `invalid-end-boundary`     | A line starts with `%%CW_CARD_END` but does not match the pattern.   | The offending line.    | absent     |
| `nested-start-boundary`    | A start marker arrives while a boundary is active.                   | The nested start line. | nested UID |
| `mismatched-boundary-uid`  | An end marker's UID differs from the active start UID.               | The end marker line.   | end UID    |
| `unmatched-end-boundary`   | An end marker arrives with no active boundary.                       | The end marker line.   | end UID    |
| `unmatched-start-boundary` | A boundary is still active at end of file.                           | The start marker line. | start UID  |

The parser's `createDiagnostic` helper hardcodes `severity: 'error'`, so every diagnostic above blocks.
`electron/cardSyncService.ts` adds one more report of its own through `createDiagnostic`, reusing the
code `mismatched-boundary-uid` when `dedupeParsedCards` drops a second pair for a UID already seen in
the same note; its `line` is the dropped card's `startLine`. `hasBlockingDiagnostics` treats any
`severity === 'error'` diagnostic as blocking.

The severity is error-only in practice. `CardParseDiagnostic.severity` allows `'warning'`, but no
producer emits it, and the duplicate pair above is reported under the existing
`mismatched-boundary-uid` code. A non-blocking tier — and a distinct code for duplicate pairs — is a
tracked gap; see [the roadmap](../roadmap.md).

## Line ranges and `referenced_in`

`buildCard` in `electron/cardParser.ts` constructs the range from the marker lines:

- `startLine` is the 1-based line number of the start marker, and `endLine` is the 1-based line number
  of the end marker. Both marker lines are inside the range.
- `blockContent` is `lines.slice(startLine, endLine - 1).join('\n')`, that is, exactly the lines
  strictly between the two markers, joined with LF. The marker lines are excluded from the block text.

Line numbers are computed on the CRLF-normalised content, so they are independent of the file's line
endings. The sync layer copies the range into the card JSON: `syncParsedCrashCards` calls
`upsertCardReference`, which writes `{ note_path, start_line, end_line }` into `referenced_in`, keyed by
`note_path` — a card holds at most one reference per note, replaced in place when the pair moves. On
read, `toCardReferences` coerces each entry to an integer of at least 1. `removeCardReference` drops a
reference by `note_path` without touching the note. When a parse produced any error-severity
diagnostic, `syncParsedCrashCards` still upserts references for the pairs that did parse, but
refuses to remove stale ones and reports `skipped` changes instead, so a malformed note keeps its
previous `referenced_in` entries alongside the new ones. Ranges are consumed as 1-based
inclusive line numbers; for example `electron/weaver/weaveContextService.ts` slices an excerpt from
`start_line - REFERENCE_EXCERPT_PADDING_LINES` through `end_line + REFERENCE_EXCERPT_PADDING_LINES`.

## Text handling

- **Line endings.** `parseCrashCardsFromNote` applies `content.replace(/\r\n/g, '\n')` before splitting.
  Callers read files as UTF-8 text. A lone `\r` is not normalised, so a note separated only by bare CR
  would not parse as expected.
- **Trailing whitespace.** Matching trims each line, so `  %%CW_CARD_END uid:x%%  ` is matched against
  the patterns. The mutation helpers in `electron/services/cardBoundaryService.ts` also trim before
  comparing, but they compare with strict equality against the canonically formatted marker; an interior
  variation such as `%%CW_CARD_START  uid:x%%` parses yet is not removed or renamed.
- **Code fences.** The parser has no fence awareness: a marker line inside a fenced code block is a
  boundary like any other, and diagnostics are emitted for fenced malformed markers too.
- **Inline mentions.** A marker embedded mid-line is ignored silently. If the trimmed line _begins_
  with the marker text, the invalid-marker diagnostic fires instead, so `%%CW_CARD_START uid:x%% extra`
  is reported rather than accepted.
- **Marker visibility.** The marker form is a markdown comment, and it is intended to stay one. No
  code strips, hides or styles markers before the text is displayed, so they are plain text in the
  editor and in the rendered preview. Authors are expected to see them in edit mode so they can
  place a pair where it belongs; a future view mode may toggle their visibility (see
  [the roadmap](../roadmap.md)).

## Mutation operations

Pure text transforms live in `electron/services/cardBoundaryService.ts`; the exported services around
them read and write files. Every service that rewrites note text also calls `syncNoteToCardStore`, so
the card JSON references follow the text.

| Operation                       | Text transform                  | Service export                                                                                                                                                   | Reaches                                                                                                                      |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Insert a pair into a note       | none (the block is the payload) | `applyInsertBoundaryPair` in `electron/weaver/weaveApplyService.ts`, called from `applyWeaveOperations`                                                          | Note text, then card JSON through `syncNoteToCardStore`.                                                                     |
| Rewrite the text between a pair | none dedicated                  | no boundary-specific export: the Weaver's `edit-note-content` handler `applyEditNoteContent`, or a direct save through `writeNote` in `electron/vaultService.ts` | Note text; card JSON follows via the sync pass. The prose inside a pair is ordinary note text.                               |
| Strip ranges                    | `removeCardBoundaryLines`       | `removeCardBoundariesAcrossReferences` in `electron/services/cardReferenceMutationService.ts`, called from `deleteCard` in `electron/vaultService.ts`            | Note text (marker lines only, never the wrapped prose), then card JSON.                                                      |
| Rename a UID across references  | `replaceCardBoundaryUids`       | `renameCardBoundariesAcrossReferences` in the same service, called from `renameCard` in `electron/vaultService.ts`                                               | Note text, then card JSON; `renameCard` also writes the new card file, deletes the old one, and updates crashpad references. |
| Restore a removed pair          | `restoreCardBoundaryLines`      | `reinsertCardBoundariesForReferences` in `electron/services/cardRestoreMutationService.ts`, called from `restoreDeletedCard` in `electron/vaultService.ts`       | Note text, then card JSON.                                                                                                   |
| Drop references only            | none                            | `removeNoteReferencesFromCardStore` in `electron/cardSyncService.ts`, or `removeCardReference` in `electron/cardStoreService.ts`                                 | Card JSON only.                                                                                                              |

Details that follow from those implementations:

- `removeCardBoundaryLines` deletes every line equal to that UID's two canonical markers and reports
  how many lines it removed; it never deletes spanned content, so a card whose markers are stripped
  leaves the note prose intact.
- `replaceCardBoundaryUids` rewrites both markers in one pass and reports `replaced: false` when the
  UID is not present, which lets the caller skip the write.
- `restoreCardBoundaryLines` is conservative. If both markers are already present it reports
  `alreadyPresent`; if only one is present it inserts nothing. Otherwise it locates the card's saved
  `raw_content` as a run of exactly matching note lines and wraps the occurrence nearest the saved
  `start_line`; if no run matches it falls back to inserting the markers at the saved range, and if
  that is not possible it inserts nothing. Both failure paths leave the note unchanged.
- `resolveReferenceNotePath` in `electron/services/noteReferenceMutationService.ts` refuses paths that
  escape the vault root, and missing notes are skipped rather than treated as errors
  (`isMissingReferenceNoteError` matches `ENOENT` only).

## Weaver validation and apply

Plan validation in `electron/weaver/weavePlanSchema.ts` constrains the markers a plan may contain:

- `validateInsertBoundaryPairOperation` requires a non-empty `payload.boundaryBlock`, a valid
  `payload.placement`, `headingText` for heading placements, and `selectedText` for
  `after-selection`. `payload.cardUid` must equal the focused request card.
- `assertBoundaryBlockIncludesCard` requires the block to contain both `%%CW_CARD_START uid:<UID>%%`
  and `%%CW_CARD_END uid:<UID>%%` as literal substrings for that UID. It is an exact-substring check
  with no whitespace tolerance, so a block that the parser would accept can still fail validation.
- `validatePlan` requires `plan.referencedCards` to include the focused request card. For a
  `guided-insert` request, `getAllowedOperationKinds` permits only `insert-boundary-pair` plus whichever
  of `edit-note-content` and `create-note` the request's permissions grant.
- `create-note` is exempt: `assertCreateNoteHasSubstantiveContent` ignores markers and only enforces a
  20-character trimmed length, so boundary markers are optional in created note content.

Apply in `electron/weaver/weaveApplyService.ts` touches markers as follows:

- `applyInsertBoundaryPair` reads the note, splits it into lines, and splices `payload.boundaryBlock`
  at the index implied by the placement. It uses the provided block as-is and synthesises a bare pair
  from `formatCardStartBoundary` / `formatCardEndBoundary` only when the block is empty. After the
  splice it calls `verifyBoundaryIntegrity`, which re-parses the assembled note and throws if any
  `severity === 'error'` diagnostic is present, so a write that would leave a malformed note is
  rejected before `writeTextAtomically`. When the requested heading or selection is not found, the
  handler returns `ok: true` with a warning and writes nothing.
- `applyEditNoteContent` replaces the target text and then runs the same integrity check before
  writing; the test `edit-note-content: fails when edit would break boundary integrity` pins the
  rejection of a replacement that would remove one marker of a pair.
- `applyRenameNote` and `applyDeleteNote` re-parse the note with `parseCrashCardsFromNote` to find the
  card UIDs it contains, then update or orphan the corresponding card JSON references.

The ordering of retrieval, planning, the Approval gate and apply is specified in
[The weave pipeline](../architecture/weave-pipeline.md).

## Worked example

A note with one pair, `notes/tcp.md`:

```markdown
# TCP notes

%%CW_CARD_START uid:CW-001%%
TCP establishes a connection with a three-way handshake.
%%CW_CARD_END uid:CW-001%%

Trailing prose.
```

`parseCrashCardsFromNote` returns no diagnostics and one `ParsedCrashCard`: `uid: "CW-001"`,
`startLine: 3`, `endLine: 5`, and `blockContent` equal to the single prose line. Sync stores the
derived reference as:

```json
{ "note_path": "notes/tcp.md", "start_line": 3, "end_line": 5 }
```

A malformed variant that changes only the end marker's UID:

```markdown
%%CW_CARD_START uid:CW-001%%
TCP establishes a connection with a three-way handshake.
%%CW_CARD_END uid:CW-002%%
```

The parser returns no cards and two diagnostics: `mismatched-boundary-uid` at line 3 with
`uid: "CW-002"` (the end marker does not close the active `CW-001` boundary), and
`unmatched-start-boundary` at line 1 with `uid: "CW-001"` (the boundary was still open at end of
file). A second variant, `%%CW_CARD_START CW-001%%` on its own line, produces a single
`invalid-start-boundary` at line 1 and no card, because the line begins with the marker text but omits
the required `uid:` key.
