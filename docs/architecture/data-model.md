# Data model

This document describes the domain data layer: what CrashWeaver persists, where, and which
symbols own each artefact. It uses the vocabulary of [CONTEXT.md](../../CONTEXT.md) —
vault, note, card, card store, UID, UID boundary, reference, orphaned card, crashpad,
diagnostic — and states no meaning beyond that glossary.

The boundary grammar is in [boundary-format.md](../reference/boundary-format.md) and the
field-by-field card contract in [card-schema.md](../reference/card-schema.md). This
document covers how those artefacts are stored, guarded and kept in sync; the
main/renderer split is in [process-model.md](./process-model.md) and a broad map of the
system is in [overview.md](./overview.md).

## Where the data lives

| Artefact | Location | Owner |
| --- | --- | --- |
| Notes | Markdown files anywhere under the vault root, excluding `.crashweaver/` | `vaultService` |
| Note index | `.crashweaver/index.json`; a legacy `index.json` at the vault root is read as a fallback only | `services/vaultIndexService` |
| Cards (card store) | One `<uid>.json` per card, default `.crashweaver/cards/` | `cardStoreService` |
| Crashpads | `.crashweaver/crashpads/<id>.crashpad.json` | `crashpadService` |
| Weaver embedding cache | `.crashweaver/embeddings.json` | `weaver/weaverEmbeddingService` |
| Per-vault settings | `crashweaver-settings.json` in Electron `userData` | `settingsService` |

Note paths crossing to the renderer are vault-relative POSIX (`toPosixPath` in
`electron/utils/paths.ts`), so a note is `web/http.md`, never an absolute path.

## The vault

A vault is an existing directory the user opens as their knowledge base. Opening one
returns a `VaultDescriptor` (`electron/vault-contract.ts`): `rootPath`, `indexFilePath`,
`notes` (`VaultNoteSummary[]`), `index` (`VaultIndex`), `cardStore` (`CardStoreConfig`),
`imageDirectories`, `lastCardSync` and `lastCardRebuild`.

`openVault` in `electron/vaultService.ts` is exactly `updateIndex`, so opening a vault runs
the whole sequence in one pass: `resolveVaultDescriptorContext` validates the root and reads
`getCardStoreConfig` plus `getImageDirectories`; `listVaultNotes` reads every note;
`rebuildCardStoreFromNotes` re-derives every card's references; `writeIndex` writes the
index; and `toDescriptor` assembles the descriptor with the rebuild summary as `lastCardRebuild`.

`assertVaultRoot` is the gate every exported `vaultService` entry point passes through,
directly or via `resolveVaultCardStoreContext`/`resolveVaultDescriptorContext`. It
resolves the path, `fs.stat`s it, rejects a missing path (`Vault path does not exist`) or
a non-directory (`Vault path is not a directory`) and returns the resolved root.

Indexing is note-level, not card-level. `collectMarkdownFiles` recurses from the root,
skips the `.crashweaver` directory by name, keeps files whose extension is `.md`
(case-insensitively) and returns them sorted. Each note becomes a `VaultIndexEntry`:

| Field | Source |
| --- | --- |
| `id` | `createEntryId` — first 16 hex characters of the SHA-1 of the note's vault-relative path |
| `filePath`, `title` | the vault-relative POSIX path; the basename with `.md` removed |
| `tags` | `extractTags` — `#tag` tokens matched by `/(^|\s)#([A-Za-z0-9/_-]+)/gm`, lower-cased and sorted |
| `updatedAt` | the file's `mtime` as ISO 8601 |
| `review` | `ReviewMetadata`, preserved from a previous entry with the same path or defaulted by `createDefaultReviewMetadata` |

`VaultIndex.version` is the literal `1`. `readVaultIndex` reads the internal file first
and falls back to the legacy root file; writes always target `.crashweaver/index.json`.

### The vault-root guard

Three guards enforce the rule that the app reads and writes only inside the vault, each
at the point where a relative path enters filesystem code:

| Guard | Module | Behaviour |
| --- | --- | --- |
| `resolveNotePath` with `isOutsideRoot` | `electron/vaultService.ts` | Resolves the normalised note path against the root and throws `Note paths must stay inside the selected vault.` when it escapes |
| `resolveReferenceNotePath` | `electron/services/noteReferenceMutationService.ts` | Returns `null` instead of throwing; callers treat `null` as "skip this reference" |
| `assertWithinVault` | `electron/weaver/weaveApplyService.ts` | Resolves root and target through symlinks (`fs.realpath`), walking up to the nearest existing ancestor when the target does not exist yet, and throws `Path escapes vault root: …` |

Each guard compares `path.relative(root, target)` against a leading `..` or an absolute
remainder. `electron/utils/paths.ts` exports only `toPosixPath`, a separator normaliser and
not a containment guard. The renderer adds `isPathInsideVault` in `src/lib/editorPaths.ts`,
a string check that rejects drive-letter and leading `../` paths before the UI sees them.

> Open question: the card store is configurable to any directory (`setCardStorePath` in
> `settingsService` stores `path.resolve(cardStorePath)` with no vault check), so card
> JSON can live outside the opened vault while the glossary says the app reads and writes
> inside the vault and never outside. Should the card store be constrained to the vault,
> or is it an intentional second storage root? Recommendation: treat it as an explicitly
> configured second root and scope the glossary claim to notes; if that is wrong, add a
> containment check in `setCardStorePath`.

## Notes

A note is a Markdown file in the vault. It holds prose and, where cards are placed, the
paired UID boundaries delimiting the span attributed to each card — never a card's full
payload. `readNoteDocument` produces the app's notion of a note as a `VaultNoteDocument`:
the summary fields above plus `content`, `parsedCards`, `parseDiagnostics` and
`cardSync`.

`normalizeNotePath` is the path rule: backslashes become forward slashes, the string is
trimmed, leading slashes are stripped, and `.md` is appended unless the path already ends
in `.md` case-insensitively. An empty result raises `A note path is required.`. Case is
preserved, so `Notes/Idea.md` and `notes/idea.md` are different notes; traversal is
handled afterwards by `resolveNotePath`.

Line endings are normalised in two places. `parseCrashCardsFromNote` in
`electron/cardParser.ts` replaces `\r\n` with `\n` before splitting, so boundary line
numbers are logical whatever the file's line-ending style. `removeCardBoundaryLines`,
`replaceCardBoundaryUids` and `restoreCardBoundaryLines` in
`electron/services/cardBoundaryService.ts` also normalise and always re-join with `\n`, so
a rewritten note comes back with LF endings even if it was stored with CRLF. `writeNote`
writes the caller's content byte-for-byte, so untouched notes keep their endings.

Reads go through `readNoteDocument`: `fs.readFile` and `fs.stat` in parallel, a relative
POSIX path, parse, then `enrichParsedCardsWithStoreState` to attach `cardFilePath`,
`cardExists` and `linkedCard` to each parsed card. A missing note is not caught, so its
`ENOENT` propagates through `readNote` to the caller. Writes go through `writeNote`, which
resolves and guards the path, `mkdir`s the parent recursively, calls
`writeTextAtomically`, syncs the note to the card store, then re-reads the note and
rewrites the whole index.

## Cards and the card store

A card is a `CardDocument` (`electron/vault-contract.ts`), the full payload described in
[card-schema.md](../reference/card-schema.md). `electron/cardStoreService.ts` owns its
persistence as a flat directory of JSON files, one per card: `getCardFilePath` is
`path.join(cardStorePath, `${uid}.json`)`. The UID is therefore both the card's identity
and its filename. `assertValidCardUid` trims it and rejects an empty UID (`Card title / ID
is required.`) or one not matching `^[A-Za-z0-9_-]+$` (`Card title / ID must use only
letters, numbers, underscores, or dashes.`); that pattern also makes a UID unusable as a
traversal vector.

The default store is `<vault>/.crashweaver/cards` (`getDefaultCardStorePath`).
`getCardStoreConfig` returns the per-vault override recorded in `cardStoreByVault` keyed
by resolved vault path, or the default, marking which applied through
`CardStoreConfig.isDefaultPath`. `setCardStorePath` persists a resolved absolute path, and
`updateVaultCardStore` in `vaultService` persists it and re-runs `updateIndex` so
references are rebuilt against the new location.

Reading is tolerant. `readCardDocument` parses `<uid>.json` through `coerceCardDocument`,
returning `null` on `ENOENT` and rethrowing other fs errors; `cardDocumentExists` maps
`ENOENT` to `false`. `listCardDocuments` reads every `*.json`, deriving each UID from the
filename rather than the file body — `coerceCardDocument(uid, …)` always sets `uid` to the
value it is given — skips an unreadable file with a `console.warn`, and yields `[]` for a
missing store directory. `coerceCardDocument` defaults missing `type`, `metadata`,
`memory_tricks` and `referenced_in`, merges the legacy `fill_in_the_blanks` array into
`qa_pairs`, drops reference entries without a `note_path`, clamps line numbers to at least
`1`, and falls back to a supplied block of text when `raw_content` is blank.

Writing is `writeCardDocument`, which validates the UID, ensures the directory exists,
coerces the document and writes it with `writeJsonAtomically`. `createCardDocument`
produces an empty default card, and `vaultService.createCard` refuses a UID that already
has a file. `deleteCardDocument` unlinks the file and reports `false` when it was already
gone. `upsertCardReference` and `removeCardReference` are the two reference-level writes.

All JSON in the data layer goes through the same atomic writer. Cards, crashpads and settings
serialise through `writeJsonAtomically` (two-space indentation plus a trailing newline), which
delegates to `writeTextAtomically` in `electron/utils/jsonFile.ts`; `writeVaultIndex` serialises
the index itself and calls `writeTextAtomically` directly with the same shape. That helper writes
to a sibling file named with a random UUID and renames it into place; where renaming over
an existing file fails (`EEXIST`/`EPERM`, notably Windows) it moves the old file to a UUID
backup, renames the temp file in, and restores the backup if that rename fails. Readers
never observe a partially written file.

## References

A reference is a `CardNoteReference` — `note_path`, `start_line`, `end_line` — and a card
holds them in `referenced_in`. The first reference for a card appears when a boundary pair
is parsed: `upsertCardReference` either creates a default card seeded with the span's text
or adds the reference to the existing card. A card holds at most one reference per
`note_path`; an existing entry for the same note is replaced in place, and the list is kept
sorted by `note_path`. Results are reported as `created`, `updated`, `unchanged`
(serialised card identical) or `removed-reference` in `CardSyncSummary.changes`.

`start_line` is the 1-based line number of the start boundary and `end_line` the 1-based line
number of the end boundary — not the last content line. `buildCard` in `electron/cardParser.ts`
slices `lines.slice(startLine, endLine - 1)` for the block content, and
`restoreCardBoundaryLines` reconstructs the span from `end_line - start_line - 1` content
lines. The stored `note_path` is the vault-relative POSIX path, matching the note's `filePath`.

### What triggers a sync

| Trigger | Path through the code |
| --- | --- |
| Vault open and index refresh | `vault:open` → `openVault`, and `vault:update-index` → `updateIndex`; both run `rebuildCardStoreFromNotes`, which syncs every note and then drops references pointing at note paths that no longer exist |
| Note save | `vault:write-note` → `writeNote` → `syncNoteToCardStore` for that note, before the index is rewritten |
| External change | `watchVault` in `electron/main.ts` runs a chokidar watcher on the vault root; `add`/`change`/`unlink` events go to `handleWatcherEvent`, which syncs the file or, on `ENOENT`, calls `removeNoteReferencesFromCardStore` |
| Card rename, delete or restore | `renameCardBoundariesAcrossReferences`, `removeCardBoundariesAcrossReferences` and `reinsertCardBoundariesForReferences` each rewrite boundaries in the affected notes and re-sync every note they rewrote |

The watcher ignores dotfiles and dot-directories, everything under `**/.crashweaver/**` and
the card store path itself, so the app's own metadata and card-store writes do not feed back into
the sync loop. Note writes do feed back: a saved note reaches the watcher like any other change.
After a debounce window it sends the accumulated relative paths to the renderer as
`vault:external-change`. The sync itself is `syncNoteToCardStore` → `parseCrashCardsNote` →
`syncParsedCrashCards`, which reduces a UID appearing more than once in one note to its
first occurrence via `dedupeParsedCards` (recording a diagnostic per duplicate), then drops
the note from every card that still references it but no longer contains its UID, through
`removeCardReference`. That pruning is skipped, and each affected card reported with the
`skipped` action instead, when the note produced any diagnostic of severity `error`
(`hasBlockingDiagnostics`) — a malformed note never silently erases references.

### Orphaned cards

A card is orphaned when every reference it held has been removed. No code path deletes a
card file as a consequence of reference removal: `removeCardReference`,
`syncParsedCrashCards` and `rebuildCardStoreFromNotes` only rewrite `referenced_in`, and
`getPreferredReference` in `src/lib/cards.ts` simply returns `null` for an empty list. The
one place the term is surfaced to the user is `applyDeleteNote` in
`electron/weaver/weaveApplyService.ts`, which collects the UIDs left with no references,
preserves their files and reports a warning that they remain in the card store and must be
deleted manually.

## Crashpads

A crashpad is the authoring surface where cards are composed and arranged before being
woven into notes. Files live under `.crashweaver/crashpads/`, one per crashpad, named
`<id>.crashpad.json` (`getCrashpadDirectory`, `getCrashpadFilePath` in
`electron/crashpadService.ts`). A crashpad ID is `normalizeCrashpadId(name)`: trimmed,
lower-cased, every run of characters outside `[a-z0-9_-]` collapsed to a single `-`, and
leading/trailing dashes removed; `getCrashpadFilePath` raises `Crashpad id is required.`
when the normalised ID is empty.

A `CrashpadDocument` holds `id` (the normalised ID, which is also the filename stem),
`name` (defaulting to the ID), `filePath`, `createdAt` and `updatedAt` (ISO timestamps;
`writeCrashpad` always refreshes `updatedAt`), `cards` and `deletedCards`:

- `cards` is a `CrashpadCardEntry[]` — `uid`, `origin` (`'existing'` or `'new'`) and
  `addedAt`.
- `deletedCards` is a `CrashpadDeletedCardSnapshot[]` — `uid`, `origin`, `deletedAt`,
  `removeNoteBoundaries` and a full `card` `CardDocument`.

`listCrashpads` returns `CrashpadSummary` rows (`id`, `name`, `filePath`, `updatedAt`,
counts of active and deleted cards) sorted by name, skipping an unreadable file with a
`console.warn` and yielding `[]` for a missing directory. `readCrashpad` returns `null` on
`ENOENT`. As with cards, `coerceCrashpadDocument` derives the ID from the filename when the
body has none and defaults every missing field, and `coerceDeletedSnapshot` treats
`removeNoteBoundaries` as true unless it is explicitly `false`.

Creation is `createCrashpad`: the name is normalised, falling back to
`crashpad-<base36 timestamp>` when it normalises to nothing, and the function then probes
candidate IDs with `-1`, `-2`, … suffixes until `fs.stat` reports `ENOENT` and writes the
new document there. Saving is `writeCrashpad`, which recomputes the path from `document.id`,
refreshes `updatedAt`, creates the directory and writes atomically.

A crashpad's `cards` array holds references, not payloads: each entry is a UID plus its
origin, so a card placed in a crashpad and a card placed in a note are the same
`CardDocument`. `origin` records whether the card already existed when it was added or was
authored inside the crashpad. Renaming a card's UID (`renameCard` in `vaultService`)
propagates through `renameCardUidAcrossCrashpads`, which rewrites both `cards` entries and
`deletedCards` snapshots. Deleting a card from a crashpad calls `deleteCard` in the vault service,
which unlinks the card JSON through `deleteCardDocument`, so the card file is removed and its
boundaries are optionally removed from notes,
while the snapshot keeps the entire deleted card so it can be restored; `restoreDeletedCard`
writes that `CardDocument` back and either reinserts missing boundary pairs or forgets the
saved references, depending on `CardRestoreMode`.

The daily crashpad naming rule lives in the renderer: `useDailyCrashpadActions` computes
`getTodayDateStamp()` as the local `YYYY-MM-DD` date and uses it as both the crashpad ID and
the file name (`.crashweaver/crashpads/<YYYY-MM-DD>.crashpad.json`), opening the existing one
if `openCrashpad` returns a document and otherwise calling `createCrashpad` with that stamp.

> Open question: there is no crashpad-level rename or delete entry point. `writeCrashpad`
> derives the file path from `document.id`, so changing the ID would write a second file and
> leave the first in place, and no IPC channel removes a crashpad file. Should renaming a
> crashpad move its file and carry its `cards`/`deletedCards` across, and should deletion
> remove the file? Recommendation: implement rename and delete in `crashpadService` with an
> explicit move and unlink plus matching IPC channels, rather than relying on `writeCrashpad`.

## Diagnostics

A diagnostic is a parser report of a malformed boundary, typed as `CardParseDiagnostic`
(`electron/vault-contract.ts`): `code`, `line`, `message`, `severity` and an optional `uid`.
The codes are `invalid-start-boundary`, `invalid-end-boundary`, `nested-start-boundary`,
`unmatched-start-boundary`, `unmatched-end-boundary` and `mismatched-boundary-uid`;
`createDiagnostic` in `electron/cardParser.ts` stamps every parser diagnostic with severity
`error`, and `cardSyncService.createDiagnostic` reuses `mismatched-boundary-uid` for the
duplicate-UID case it detects in `dedupeParsedCards`.

They surface in three places: `ParsedCrashCardsNote.diagnostics`, which `readNoteDocument`
copies to `VaultNoteDocument.parseDiagnostics` for the note editor; `CardSyncSummary.diagnostics`,
returned to the renderer by `writeNote` as `cardSync` and stored on the descriptor as
`lastCardSync`; and `CardRebuildSummary.diagnostics`, the count across the rebuild performed by
`updateIndex`, surfaced through `formatCardRebuildSummary` in `src/lib/cards.ts`, whose sibling
`formatCardSyncSummary` renders the created/updated/removed/skipped counts and the diagnostic
count for a single sync.

Diagnostics are not only reporting: an error-severity diagnostic suppresses reference pruning
for that note, and `verifyBoundaryIntegrity` in `electron/weaver/weaveApplyService.ts`
re-parses content before a weave write and throws if any error-severity diagnostic remains.

## Path safety and failure handling

`getFsErrorCode` in `electron/utils/fsErrors.ts` is the single normaliser for filesystem errors:
it returns the `code` property of an `Error` when present and `undefined` otherwise. Every
service branches on that string rather than on message text.

| Situation | Behaviour |
| --- | --- |
| Vault root missing or not a directory | `assertVaultRoot` throws a descriptive `Error`; every exported `vaultService` entry point calls it |
| Path escapes the vault | `resolveNotePath` and `assertWithinVault` throw; `resolveReferenceNotePath` returns `null` and the caller skips that reference |
| Note missing on read | `readNoteDocument` does not catch, so `ENOENT` propagates through `readNote` and the IPC channel to the renderer |
| Referenced note missing | `readReferenceNoteContent` returns `null` so boundary rewrites skip it; `reinsertCardBoundariesForReferences` records the path in `skippedNotePaths`; `isMissingReferenceNoteError` is the shared `ENOENT` check |
| Watcher event for a deleted file | `handleWatcherEvent` treats `ENOENT` as deletion, calls `removeNoteReferencesFromCardStore`, then notifies the renderer so the file tree updates |
| Card file missing | `readCardDocument` returns `null`; the parsed card reports `cardExists: false`, and `src/lib/cards.ts` supplies `createFallbackCard` so the UID is editable before the file exists |
| Card or crashpad file unreadable | `listCardDocuments` and `listCrashpads` skip it with a warning and load the rest |
| Index or settings file missing or unparsable | `readStoredIndexFile` logs and treats it as absent so the next write builds a fresh index; `readSettings` falls back to `createDefaultSettings`, and mutations are serialised through `settingsMutationQueue` |
| Card store directory missing | `ensureCardStoreDirectory` creates it before any card write; readers treat `ENOENT` as empty |

## Invariants and where they are enforced

| Invariant | Enforced by |
| --- | --- |
| A UID names at most one card file | `getCardFilePath` maps a UID to one `<uid>.json`; `vaultService.createCard` and `renameCard` refuse an existing UID; `listCardDocuments` takes each UID from its filename |
| A UID is filesystem-safe | `assertValidCardUid` applies `^[A-Za-z0-9_-]+$` before any path is built from it |
| A card holds at most one reference per note | `upsertCardReference` replaces the entry with the same `note_path` instead of appending |
| One reference per UID per note | `dedupeParsedCards` keeps the first occurrence of a duplicated UID and emits a diagnostic |
| Boundaries are paired | `parseCrashCardsFromNote` reports unbalanced or mismatched pairs; `verifyBoundaryIntegrity` refuses to apply a weave operation while error-severity diagnostics exist; `hasBlockingDiagnostics` blocks reference pruning from a malformed note |
| A note's span never overwrites an existing card payload | `upsertCardReference` assigns `raw_content` from the parsed block only when the card's `raw_content` is blank |
| Card JSON is only ever written whole | `writeJsonAtomically` plus the temp-file rename in `writeTextAtomically` |
| Reference pruning never deletes card files | `removeCardReference`, `syncParsedCrashCards` and `rebuildCardStoreFromNotes` mutate only `referenced_in` |
| The index schema version is fixed | `VaultIndex.version` is the literal `1` in `coerceStoredIndex` and `buildIndex` |

Scheduling state exists in two places, and only one is in use. `CardMetadata` (`familiarity`,
`next_review`) inside each card file is the copy the UI reads and edits
(`useCrashpadCardEditor`, `CardMetadataPanel`). Each index entry's `ReviewMetadata`
(`familiarity`, `lastReviewedAt`, `nextReviewAt`, `intervalDays`, `repetition`, `easeFactor`) is
created with defaults and preserved across rebuilds, and its scheduling values are read nowhere. It
is **kept deliberately for the planned review loop**, not as a second live source: the card file
remains the copy in use. [The roadmap](../roadmap.md) reserves it for that loop.
