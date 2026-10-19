# Card insert templates

This file is an example catalog of card payloads for authoring. It defines no schema of its own: every
field below is a use of the payload defined in [Card schema](./card-schema.md), and where the two
disagree the schema wins. The templates are starting points for composing one card well — a concept, a
procedure, a drill — not an enumeration of card kinds, and no code branches on template shape.

## What works in `type` today

`CardDocument.type` is a `string[]` and nothing in the app enumerates allowed values. The Crashpad
labels the field "Tags (comma-separated)" (`src/components/CrashpadWorkspace.tsx`) and
`src/hooks/useCrashpadCardEditor.ts` normalises it by splitting on commas, trimming and dropping
empty entries; `coerceCardDocument` keeps only string entries (`toStringArray`). Every card stored
under `fixtures/mock-vault/.crashweaver/cards/` currently carries `"type": []`.

Any non-empty string therefore works, and the firm rules are mechanical: keep the entries strings and
pick the words you would search for. Tags are not decorative — `extractNoteSearchTokens` folds
`card.type` into the Weaver's note-search tokens and `buildQueryEmbedding` includes them in the
embedding query.

The intended direction is to keep `type` free-form and, inside the application, list the types
already used in the selected vault so they can be reused instead of retyped.

The template names below are labels chosen for this catalog, not reserved values: no parser, sync or
insert behaviour branches on them, and the archived catalog's "Template A–F" families are names too.

## Templates

Each payload is a complete card-store document with the six `CardDocument` keys. Four conventions apply:

- `uid` may use only letters, numbers, underscores and dashes — `assertValidCardUid` rejects anything
  else, and the boundary patterns in `cardParser` accept exactly that set.
- `referenced_in` is produced by the card sync from the note's UID boundaries: leave it `[]`.
- `raw_content` is the prose the boundary pair wraps; `upsertCardReference` seeds an empty card from
  the wrapped span's text.
- A new card starts at `familiarity: 0` and `next_review: null`.

### Concept card

Use when one idea and its edges need fixing. The content opens with a heading, states the idea, then
gives the test that tells it apart from its neighbours; the memory trick carries the hook.

```json
{
  "uid": "concept-polymorphism",
  "type": ["concept", "oop"],
  "raw_content": "## Polymorphism\n\nOne interface, many concrete implementations. The caller codes against a shared contract and runtime dispatch picks the behaviour.\n\nThe useful test: adding an implementation does not change the calling code.",
  "metadata": { "familiarity": 0, "next_review": null },
  "memory_tricks": {
    "memory_technique": "One plug, many sockets — the contract is the socket.",
    "qa_pairs": [
      {
        "q": "What decides which implementation runs?",
        "a": "Runtime dispatch on the value, not the calling code."
      },
      {
        "q": "How do you know a seam is polymorphic?",
        "a": "Adding an implementation leaves the caller untouched."
      }
    ]
  },
  "referenced_in": []
}
```

### Process card

Use for an ordered procedure whose steps matter in sequence. Keep the ordered list in `raw_content`,
put the stopping condition at the end, and let the mnemonic compress the step names.

```json
{
  "uid": "process-branch-rebase",
  "type": ["process", "git"],
  "raw_content": "## Rebasing a feature branch\n\n1. Fetch the base branch.\n2. Rebase the feature branch onto it.\n3. Resolve conflicts, then continue the rebase.\n4. Force-push with lease.\n\nStop and ask if a conflict would rewrite a commit a teammate has already reviewed.",
  "metadata": { "familiarity": 0, "next_review": null },
  "memory_tricks": {
    "memory_technique": "Fetch, rebase, resolve, push-with-lease.",
    "qa_pairs": [
      {
        "q": "Why force-push with lease?",
        "a": "It refuses the push if someone else moved the branch first."
      },
      {
        "q": "When do you stop and ask?",
        "a": "When resolving the conflict would rewrite a reviewed commit."
      }
    ]
  },
  "referenced_in": []
}
```

### Question and answer drill card

Use when recall should be driven by prompts rather than by reading prose: `memory_tricks.qa_pairs`
does the work, so keep each `q` answerable from memory and each `a` to one fact, with `raw_content` as
a short orientation block. Cards write `qa_pairs` directly.

```json
{
  "uid": "drill-http-status-classes",
  "type": ["drill", "http"],
  "raw_content": "## HTTP status classes\n\n2xx success, 3xx redirection, 4xx caller error, 5xx server error.\n\nThis card is carried by its question and answer pairs.",
  "metadata": { "familiarity": 0, "next_review": null },
  "memory_tricks": {
    "memory_technique": "Four is your fault, five is theirs.",
    "qa_pairs": [
      { "q": "Which class means the request was malformed?", "a": "4xx." },
      { "q": "Should a client retry a 404 unchanged?", "a": "No — the URL has to change first." },
      {
        "q": "When is retrying a 500 reasonable?",
        "a": "When the operation is idempotent and the server says retrying is safe."
      },
      { "q": "What does 304 mean?", "a": "The cached copy is still fresh and no body is sent." }
    ]
  },
  "referenced_in": []
}
```

### Comparison card

Use when two or more options must be told apart: put the alternatives in a table inside `raw_content` and record the decision rule, not just the difference.

```json
{
  "uid": "compare-cache-aside-vs-write-through",
  "type": ["comparison", "caching"],
  "raw_content": "## Cache-aside vs write-through\n\n| | Cache-aside | Write-through |\n| --- | --- | --- |\n| Writes | Cache, source updated by caller | Cache and source together |\n| Failure mode | Stale reads unless invalidation is explicit | Higher write latency |\n\nChoose write-through when staleness is unacceptable; otherwise cache-aside is the simpler default.",
  "metadata": { "familiarity": 0, "next_review": null },
  "memory_tricks": {
    "memory_technique": "Write-through pays on every write to never be stale.",
    "qa_pairs": [
      {
        "q": "Which option is stale by default?",
        "a": "Cache-aside, unless invalidation is explicit."
      }
    ]
  },
  "referenced_in": []
}
```

### Minimal capture card

Use for fast capture before the idea is shaped: a complete payload — the same six keys — with the
content reduced to a fragment and the mnemonic aids left empty for the Crashpad to fill in later.
`weaver_test` and `sdfg` in the mock vault are the empty extreme of this state: their `raw_content`
is `""` with no mnemonic aids, waiting for a first capture.

```json
{
  "uid": "capture-etag-tradeoff",
  "type": ["capture"],
  "raw_content": "ETag revalidation saves payload transfer but costs a round trip — work out when it pays.",
  "metadata": { "familiarity": 0, "next_review": null },
  "memory_tricks": { "memory_technique": "", "qa_pairs": [] },
  "referenced_in": []
}
```

## How a template reaches a note

A template is only a payload; the card becomes visible in a note through a UID boundary pair. The
marker format and its parser rules are specified in [Boundary format](./boundary-format.md).

**Manual path.** In the Crashpad, select the card and copy its embed: `handleCopyEmbed` puts
`%%CW_CARD_START uid:<UID>%%`, a blank line and `%%CW_CARD_END uid:<UID>%%` on the clipboard. Paste the
pair into the note and put the annotated prose between the markers, each marker alone on its own line.
Saving the note runs the card sync: `parseCrashCardsFromNote` reads the span and `upsertCardReference`
creates or updates `<UID>.json` in the card store with the reference. If the markers arrive first, the
span's text seeds `raw_content` and you finish the card in the Crashpad.

**Guided insert.** With a card selected in the Crashpad, a guided insert asks the Weaver for a plan of
kind `guided-insert`. The card insert is an `insert-boundary-pair` operation, carrying a `placement`
(`append-to-note`, `prepend-to-note`, `after-heading`, `before-heading`, or `after-selection`) and a
`boundaryBlock` that `weavePlanSchema` requires to contain both markers for the card's UID. The
heading and selection placements additionally require `headingText` and `selectedText`. A
guided-insert plan may also carry the permission-gated kinds — `edit-note-content` when
`permissions.editContent` is granted, `create-note` when `permissions.createNote` is. The plan is
reviewed at the Approval gate, and nothing in a note, boundary or card document is written before it
is accepted; applying it runs `applyWeavePlan`, which inserts the block — falling back to the two bare
markers when `boundaryBlock` is empty — and re-syncs the note into the card store. The full flow, and
the card payload it consumes, are described in [The weave pipeline](../architecture/weave-pipeline.md)
and [Data model](../architecture/data-model.md).

## Keep this true

Any template added to or changed in this file must satisfy the current card schema and the boundary
rules: it must survive `coerceCardDocument` without losing a field, its `uid` must match the pattern
the parser and the card store enforce, and the prose it wraps must sit between two marker lines the
parser accepts. When either moves, re-derive the examples from the code rather than trusting this file.
