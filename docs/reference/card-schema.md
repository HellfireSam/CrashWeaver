# Card schema

A Crash Card is the core unit of the knowledge base: the knowledge to remember, its
categorisation, its mnemonic aids and its review state. In the card store a card is one JSON
document whose shape is `CardDocument` in `electron/vault-contract.ts`. The UID boundary grammar
that attributes a note span to a card belongs to [boundary-format.md](./boundary-format.md); where
cards sit inside the vault is [data-model.md](../architecture/data-model.md). Terms used here are
the ones defined in [CONTEXT.md](../../CONTEXT.md).

## Where the schema is defined

`CardDocument` and its nested interfaces — `CardMetadata`, `CardMemoryTricks`, `CardQaPair` and
`CardNoteReference` — are declared once in `electron/vault-contract.ts` and imported by both
processes. Every field is required by the type; missing or wrongly typed JSON is tolerated at
runtime by the card store. The runtime shape rules live in `electron/cardStoreService.ts`:
`coerceCardDocument(uid, value, fallbackBlockContent)` normalises on both read and write and builds
a fresh object from the known fields only, `createDefaultCardDocument(uid, blockContent)` builds the
document used when a boundary pair references a card with no file, and `assertValidCardUid(uid)`
guards the public store writes (`writeCardDocument`, `deleteCardDocument`, `createCardDocument`)
and the `vaultService` commands; `upsertCardReference`, `removeCardReference` and the Weaver apply
handlers write card JSON without it.

Card documents are consumed by:

| Layer    | Consumer                                                                                                                                                                                                        | Use                                                                                                                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `electron/cardStoreService.ts`                                                                                                                                                                                  | Reads, writes, lists and deletes one card file per UID; owns normalisation.                                                                                                                                                                                                            |
| Main     | `electron/cardSyncService.ts`                                                                                                                                                                                   | `enrichParsedCardsWithStoreState`, `syncParsedCrashCards` and `rebuildCardStoreFromNotes` create and refresh cards from note boundaries; only `enrichParsedCardsWithStoreState` attaches the stored card to each `ParsedCrashCard` as `linkedCard`, the other two returning summaries. |
| Main     | `electron/vaultService.ts`                                                                                                                                                                                      | Orchestrates `createCard`, `saveCard`, `renameCard`, `deleteCard` and `restoreDeletedCard` over the `card-store:*` IPC channels.                                                                                                                                                       |
| Main     | `electron/services/crashpadCardMutationService.ts`, `electron/services/cardReferenceMutationService.ts`                                                                                                         | Rewrite UIDs in crashpad entries and snapshots on rename, and rewrite or remove UID boundaries in notes from a card's `referenced_in`.                                                                                                                                                 |
| Main     | `electron/weaver/weaveContextService.ts`                                                                                                                                                                        | `buildWeaveContextSnapshot` reads the focused card and uses `uid`, `type`, `raw_content`, `memory_tricks` and `referenced_in` to build retrieval tokens and prompt context.                                                                                                            |
| Main     | `electron/weaver/weaveApplyService.ts`                                                                                                                                                                          | Reads cards to rewrite `referenced_in` during note rename, move and delete; creates a default card document when `create-note` targets a UID with no file.                                                                                                                             |
| Preload  | `electron/preload.ts`                                                                                                                                                                                           | Declares the typed `window.crashWeaver` card surface, mirrored in `src/vite-env.d.ts`.                                                                                                                                                                                                 |
| Renderer | `src/lib/cards.ts`                                                                                                                                                                                              | Maps `CardDocument` to the camelCase `CardViewRecord` the UI renders.                                                                                                                                                                                                                  |
| Renderer | `src/components/CardMetadataPanel.tsx`, `src/components/CardsWorkspace.tsx`, `src/components/CrashpadWorkspace.tsx` with `src/hooks/useCrashpadCardEditor.ts` and `src/hooks/useCrashpadCardMutationActions.ts` | Reads card fields for display; the crashpad editor is the only surface that edits them.                                                                                                                                                                                                |

`ReviewMetadata` in the same file is not part of a card. It belongs to `VaultIndexEntry.review`,
the vault index entry for a note, and carries `familiarity`, `lastReviewedAt`, `nextReviewAt`,
`intervalDays`, `repetition` and `easeFactor`; `createDefaultReviewMetadata` in
`electron/services/vaultIndexService.ts` supplies them. A card's scheduling state is the smaller
`CardMetadata` described below.

## Fields

Every field is required by `CardDocument`. The final column states what the card store does when
the field is absent or wrongly typed on disk.

| Field                            | Type                  | Required | Meaning                                                                                                                                                         | Default and normalisation                                                                                                                                                                    |
| -------------------------------- | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uid`                            | `string`              | yes      | The card's UID: the only thing linking a note's UID boundaries to the card's payload, and the name of the card file.                                            | No default. `assertValidCardUid` trims it, rejects an empty value and rejects anything outside `[A-Za-z0-9_-]` — the same alphabet as the boundary pattern in `electron/cardParser.ts`.      |
| `type`                           | `string[]`            | yes      | The card's categorisation. The crashpad editor labels the field "Tags" and edits it as a comma-separated list; the Weaver uses the entries as retrieval tokens. | `[]`. A non-array becomes `[]` and non-string entries are dropped; duplicates are kept.                                                                                                      |
| `raw_content`                    | `string`              | yes      | The card's markdown payload: the knowledge the card stands for, and what a boundary span stands in for.                                                         | `''`. A non-string or whitespace-only value falls back to the parsed note block; if there is none, `''`. A card created from a boundary pair gets the block trimmed.                         |
| `metadata`                       | `CardMetadata`        | yes      | The review-state container.                                                                                                                                     | The defaults below; a non-object is replaced wholesale.                                                                                                                                      |
| `metadata.familiarity`           | `number`              | yes      | How well the user knows the card, as scheduling state.                                                                                                          | `0`. Accepted only when `typeof` is `number`, so `NaN` passes through. Nothing clamps or scales it.                                                                                          |
| `metadata.next_review`           | `string \| null`      | yes      | The date the card becomes due for review.                                                                                                                       | `null`. Any string is accepted verbatim — the store never parses, validates or reformats it, and an empty string stays empty on disk. The editor turns a blank input into `null`.            |
| `memory_tricks`                  | `CardMemoryTricks`    | yes      | The card's mnemonic aids.                                                                                                                                       | The defaults below; a non-object is replaced wholesale.                                                                                                                                      |
| `memory_tricks.memory_technique` | `string`              | yes      | One technique phrase or keyword for the card.                                                                                                                   | `''`. Non-strings become `''`.                                                                                                                                                               |
| `memory_tricks.qa_pairs`         | `CardQaPair[]`        | yes      | Question and answer prompts.                                                                                                                                    | `[]`. A non-array becomes `[]`; entries that are not objects are dropped; `q` and `a` are forced to strings, and an entry with both sides empty is dropped.                                  |
| `memory_tricks.qa_pairs[].q`     | `string`              | yes      | A prompt.                                                                                                                                                       | `''`.                                                                                                                                                                                        |
| `memory_tricks.qa_pairs[].a`     | `string`              | yes      | The answer to the prompt.                                                                                                                                       | `''`.                                                                                                                                                                                        |
| `referenced_in`                  | `CardNoteReference[]` | yes      | The card's References: every note span where the card appears. A card holds many.                                                                               | `[]`. A non-array becomes `[]`.                                                                                                                                                              |
| `referenced_in[].note_path`      | `string`              | yes      | Vault-relative posix path of the note holding the span.                                                                                                         | No default: an entry whose `note_path` is not a non-empty string is dropped.                                                                                                                 |
| `referenced_in[].start_line`     | `number`              | yes      | 1-based line number of the `%%CW_CARD_START%%` marker.                                                                                                          | `1`. A number is truncated and clamped to at least 1, except a non-finite one, which passes through unchanged; a non-number becomes 1. A JSON file on disk cannot carry a non-finite number. |
| `referenced_in[].end_line`       | `number`              | yes      | 1-based line number of the matching `%%CW_CARD_END%%` marker.                                                                                                   | `1`, normalised the same way as `start_line`.                                                                                                                                                |

`familiarity` and `next_review` are the inputs to a planned review-scheduling function: the user
reviews notes, and the app uses each card's familiarity together with a standard spaced-repetition
algorithm to compute the next recommended review time. The store enforces no range or format today;
the field meanings above are the contract until that function lands.

## Parsed and storage shapes around the card

| Type                          | Shape                                                                                                                                                           | Role                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ParsedCrashCard`             | `uid`, `startLine`, `endLine`, `blockContent`, plus optional `cardFilePath`, `cardExists`, `linkedCard`                                                         | One parsed boundary pair. `startLine` and `endLine` are the marker lines; `blockContent` is the text strictly between them. `enrichParsedCardsWithStoreState` adds the store state.                                                                                 |
| `CardViewRecord`              | `src/lib/cards.ts`: `uid`, `type`, `rawContent`, `metadata`, `memoryTricks`, `references`, `currentReference`, `cardFilePath`, `cardExists`, `source`, `origin` | The renderer's camelCase view of a card. Not persisted.                                                                                                                                                                                                             |
| `CrashpadCardEntry`           | `uid`, `origin` (`'existing' \| 'new'`), `addedAt`                                                                                                              | A crashpad's membership record: a UID reference, not a payload. `origin` defaults to `'new'` and `addedAt` to the current time when a crashpad file is read.                                                                                                        |
| `CrashpadDeletedCardSnapshot` | `uid`, `origin`, `deletedAt`, `removeNoteBoundaries`, `card`                                                                                                    | The full `CardDocument` a crashpad keeps when a card is deleted, so it can be restored. `removeNoteBoundaries` defaults to `true`. `coerceDeletedSnapshot` passes the nested card through without field normalisation; it is normalised when the restore writes it. |

## Canonical example

This document matches `CardDocument` exactly: every field present, nested types respected, and
`end_line` greater than `start_line`.

```json
{
  "uid": "reliability-001",
  "type": ["concept", "engineering"],
  "raw_content": "A system is reliable when it keeps its promises under load.",
  "metadata": { "familiarity": 0, "next_review": null },
  "memory_tricks": {
    "memory_technique": "Promise keeper",
    "qa_pairs": [{ "q": "What makes a system reliable?", "a": "It keeps its promises under load." }]
  },
  "referenced_in": [{ "note_path": "notes/reliability.md", "start_line": 12, "end_line": 20 }]
}
```

## How a card arrives in the system

There are three entry points, and all three normalise.

1. From a UID boundary pair in a note. `parseCrashCardsFromNote` in `electron/cardParser.ts`
   produces `ParsedCrashCard` records; `syncParsedCrashCards` in `electron/cardSyncService.ts`
   deduplicates them by UID and calls `upsertCardReference` for each. With no card file,
   `createDefaultCardDocument` seeds `raw_content` from the boundary block and leaves
   `referenced_in` empty; `upsertCardReference` then adds the span. With one, a `structuredClone`
   of the coerced stored card is updated. This runs
   whenever a note is written (`writeNote` in `electron/vaultService.ts`), when a vault is opened
   or its index rebuilt (`rebuildCardStoreFromNotes`) and after Weaver operations that write notes
   (`syncNoteToCardStore` calls in `electron/weaver/weaveApplyService.ts`).
2. From the card store. `readCardDocument` and `listCardDocuments` parse the JSON and pass it
   through `coerceCardDocument`, which supplies every default in the field table. Results reach
   the renderer over the `card-store:list-cards` channel and become `CardViewRecord`s through
   `toCardViewRecordFromCard` or, for a parsed note card, `toCardViewRecordFromParsedCard`.
3. From the renderer. `useCrashpadCardEditor` assembles a `CardDocument` in `handleSave`
   (`buildEditableCard` maps a `CardViewRecord` back to the contract), and
   `handleSaveCrashpadCard` in `src/hooks/useCrashpadCardMutationActions.ts` sends it through
   `window.crashWeaver.saveCard` or, when the UID changed, `renameCard`; a new card goes through
   `createCard`. `createFallbackCard` in `src/lib/cards.ts` also builds a card-shaped object from
   a parsed span, but only for display when no card file is linked.

The exception is `applyCreateNote` in `electron/weaver/weaveApplyService.ts`: when a `create-note`
operation names a `cardUid` with no file, it writes a default card document straight through
`writeJsonAtomically` with an inline object literal. It matches the schema but is not produced by
`coerceCardDocument`; the next read normalises it.

## Where cards are stored on disk

The card store is a directory holding one file per card. `getCardFilePath` joins the store path
and `${uid}.json`, so a UID maps to a filename by direct substitution — the UID is the file's
basename without the extension. The store directory is per vault:

- `getDefaultCardStorePath` in `electron/settingsService.ts` returns `<vault>/.crashweaver/cards`.
- `getCardStoreConfig` reads the per-vault override from settings (`cardStoreByVault`, keyed by
  the resolved vault root) and reports it as `CardStoreConfig` `{ cardStorePath, isDefaultPath }`.
  `setCardStorePath` persists a different directory; its IPC channel is `card-store:set-path`,
  which rebuilds the vault index afterwards.
- `ensureCardStoreDirectory` creates the directory on demand before writes; `listCardDocuments`
  returns `[]` when it is missing.

Two consequences of the filename rule are worth stating. `listCardDocuments` takes the UID from
the filename and ignores the `uid` inside the JSON, so a mismatch is resolved silently in favour
of the filename. And every `*.json` file in the card store directory is treated as a card: there
is no registry or manifest.

Crashpads live beside the card store under `<vault>/.crashweaver/crashpads`, one
`<id>.crashpad.json` per crashpad (`getCrashpadDirectory`, `getCrashpadFilePath` in
`electron/crashpadService.ts`). A crashpad holds `CrashpadCardEntry` UID references and
`CrashpadDeletedCardSnapshot` payloads, not live cards. Removing a card's last Reference does not
delete the file: the card becomes an orphaned card, and `applyDeleteNote` in
`electron/weaver/weaveApplyService.ts` explicitly preserves it.

## Validation and tolerance

The parser (`electron/cardParser.ts`) is strict; the store is permissive.

Parsing. A boundary line must match `%%CW_CARD_START uid:<UID>%%` or `%%CW_CARD_END uid:<UID>%%`
after trimming, with `<UID>` matching `[A-Za-z0-9_-]+`. Every deviation becomes a
`CardParseDiagnostic` with severity `error` and one of the codes on `CardParseDiagnosticCode`:
`invalid-start-boundary`, `invalid-end-boundary`, `nested-start-boundary`,
`unmatched-start-boundary`, `unmatched-end-boundary` or `mismatched-boundary-uid`. A card is
produced only for a correctly paired start and end boundary with the same UID; content is
normalised to `\n` line endings before parsing. `syncParsedCrashCards` still creates and updates
cards for the pairs that did parse, but when a note has any error diagnostic it refuses to remove
stale References for that note and reports a `skipped` change instead. A UID appearing more than
once in one note is reduced to its first occurrence by `dedupeParsedCards`, with a diagnostic. A
malformed boundary never reaches a card document.

Store reads. `readCardDocument` returns `null` for a missing file and rethrows anything else, so one
unparseable JSON file makes that single-file read fail. `listCardDocuments` is more forgiving: it
catches per-file failures, logs a warning and skips the file, so one corrupt card does not hide
the rest of the store.

Store writes. `writeCardDocument` calls `assertValidCardUid(card.uid)` and then
`coerceCardDocument`, so a write is validated and normalised before it lands and the coerced
document is returned. `createCard` refuses an existing UID; `renameCard` refuses an existing target
UID and, when only the UID changes, rewrites it in the card file, in every referenced note's
boundaries and in every crashpad entry and snapshot. `deleteCardDocument` validates the UID,
removes the file and reports `false` when it was already absent.

Unknown and missing fields. `coerceCardDocument` constructs a new object from the known fields, so
unknown keys — top-level, inside `metadata`, or inside `memory_tricks` — are dropped on both read
and write. A read can therefore return a document that differs from the file on disk, and the next
write persists the reduced form.

The drop is deliberate. Preserving unrecognised keys would keep hand-edits intact, but it would also
let stale or malformed data live on indefinitely, so a new card field must arrive with a deliberate
migration rather than relying on passthrough.

## Field-level compatibility rules the code enforces

- UID charset and uniqueness. `assertValidCardUid` and the boundary patterns share the
  `[A-Za-z0-9_-]` alphabet, so only a boundary UID that is also a legal card UID can match a card
  file. `createCard` and `renameCard` enforce uniqueness across the store.
- One Reference per note. `upsertCardReference` looks up `referenced_in` by `note_path` and
  replaces the matching entry in place, so a UID appearing twice in one note keeps a single
  Reference; a new entry is appended and the array is sorted by `note_path`. `removeCardReference`
  filters out every entry for the note, and `dedupeNoteReferencesByPath` in
  `electron/services/noteReferenceMutationService.ts` applies the same rule before restore.
- Reference line ranges. `start_line` and `end_line` are 1-based boundary marker lines, not
  content lines: `blockContent` is `endLine - startLine - 1` lines long. Both are truncated to
  integers and clamped to at least 1, entry ordering is not validated, and a Reference with
  `end_line <= start_line` is still stored — but range-based reinsertion rejects it. For a
  non-empty `raw_content`, `restoreCardBoundaryLines` matches `raw_content` against the note first
  and falls back to `insertAtSavedLineRange` in `electron/services/cardBoundaryService.ts`, which
  returns no result when `preferredEndLine <= preferredStartLine`; only the empty `raw_content`
  branch goes straight to the range insert. When neither works the note is reported as skipped.
- `raw_content` fallback direction. During sync the block content only fills `raw_content` when it
  is blank (`upsertCardReference`); content already stored on the card is never overwritten by a
  note's boundaries. A renderer save, by contrast, always replaces `raw_content` with what the
  editor holds.
- Snapshot integrity. `restoreDeletedCard` runs `assertValidCardUid` on both `snapshot.uid` and
  `snapshot.card.uid` and throws when they differ. The restored card's `referenced_in` is cleared
  whenever `removeNoteBoundaries` is true and otherwise kept as stored, so `forget-note-references`
  on a snapshot that kept its boundaries keeps the references.
- Rename rewrites. `replaceCardBoundaryUids` rewrites the start and end marker lines for a UID and
  reports whether anything matched, so a Reference to a note that no longer contains the card is
  skipped rather than failing the rename.

## How the renderer reads and edits these fields

Reading. `src/lib/cards.ts` owns the mapping. `toCardViewRecordFromCard` converts a stored card
into a `CardViewRecord`, computing `currentReference` with `getPreferredReference` (the Reference
for the selected note, otherwise the first entry of `referenced_in` as stored) and deriving
`cardFilePath` as `<cardStorePath>/<uid>.json`. `toCardViewRecordFromParsedCard` handles a parsed
note card and calls `createFallbackCard` when no card file is linked. `App.tsx` builds its three
card collections from these functions: `currentNoteCards` from the active note's `parsedCards`,
`currentVaultCards` from the `listCards` catalog, and `crashpadCards` from the active crashpad's
entries filtered against the catalog.

Display. `src/components/CardsWorkspace.tsx` renders the `CardDetailTab` views `content`,
`memory-technique`, `qna` and `metadata` from a `CardViewRecord`. `CardMetadataPanel` shows
`metadata.familiarity`, `metadata.next_review` through `formatNextReview` (which prints
"Not scheduled" for `null`), `currentReference` with its `start_line` and `end_line`,
`cardFilePath`, and the count and list of `references`. These surfaces are read-only.

Editing. `src/hooks/useCrashpadCardEditor.ts` is the form model, and its state mirrors the contract
one-to-one: `cardUid`; `typeCsv`, a comma-separated string split and trimmed into `type`;
`rawContent`; `familiarity`, a string that `handleSave` converts with `Number`, falling back to 0
when not finite; `nextReview`, blank becoming `null`; `memoryTechnique`; and `qaPairs`, with
`updateQaPair` and `removeQaPair`. `handleSave` merges those into a `CardDocument` over
`buildEditableCard(focusedCard)`, leaving `referenced_in` untouched, and hands it to
`onSaveFocusedCard`. `src/components/CrashpadWorkspace.tsx` renders those fields plus the
`CardMetadataPanel` preview. `handleSaveCrashpadCard` in
`src/hooks/useCrashpadCardMutationActions.ts` then calls `renameCard` when the edited UID differs
from the stored one and `saveCard` otherwise; `applyCardRenameResult` in
`src/hooks/useCardRenameActions.ts` refreshes the catalog, the crashpad, the index and any open
card tab after a rename. Undo and redo replay the same calls from the `before`/`after` snapshots
kept by `src/hooks/useCrashpadHistoryActions.ts`. `handleCopyEmbed` composes the two UID boundary
markers for the current UID; it copies only the empty boundary pair, not the card payload.
