# CrashWeaver Card Insert Templates

Each template below shows two things:

- the lightweight inserted card block as it appears in an Obsidian markdown note
- the matching JSON card file stored in the user-configured card store folder

The note block begins with a `%%CW_CARD_START%%` comment and ends with a `%%CW_CARD_END%%` comment. Both comments reference the same UID. The card file holds the full payload plus every note reference, including `note_path`, `start_line`, and `end_line`.

Pick the template that best matches the kind of knowledge you are capturing.

---

## Template A — Concept Card

**Use for:** Definitions, explanations of what something is, core ideas, vocabulary.

```md
%%CW_CARD_START uid:CW-001%%

### Polymorphism

Polymorphism allows objects of different types to be treated as instances of a shared supertype.
A single interface can represent many underlying forms — for example, a `Shape` base class
whose subclasses `Circle` and `Rectangle` each override a `draw()` method.

%%CW_CARD_END uid:CW-001%%
```

```json
{
  "uid": "CW-001",
  "type": ["concept", "oop"],
  "topic": "Polymorphism",
  "raw_content": "Polymorphism is a core OOP principle that allows a single interface to represent different underlying types. There are two main kinds: compile-time polymorphism (achieved through method overloading — same method name, different parameter signatures) and runtime polymorphism (achieved through method overriding — a subclass provides its own implementation of a method defined in the supertype). At runtime the correct method is selected based on the actual object type, not the declared variable type. For example, a base class Shape declares draw(); subclasses Circle and Rectangle each override draw() with their own logic. A variable typed as Shape can hold either, and calling draw() dispatches to the correct implementation automatically. This removes large chains of type-checking conditionals and makes code open for extension without modification.",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "Poly = many, morph = forms → one interface, many shapes",
    "qa_pairs": [
      {
        "q": "What problem does polymorphism solve?",
        "a": "It lets a single interface work with different underlying types, removing type-checking conditionals and making code open for extension without modification."
      }
    ],
    "fill_in_the_blanks": [
      { "sentence": "Polymorphism lets you treat different types through a _____ interface.", "answers": ["shared / common"] },
      { "sentence": "The two main kinds are ___-time (overloading) and ___-time (overriding) polymorphism.", "answers": ["compile", "run"] }
    ]
  },
  "referenced_in": [
    {
      "note_path": "programming/oop.md",
      "start_line": 42,
      "end_line": 50
    }
  ]
}
```

---

## Template B — Process Card

**Use for:** Step-by-step procedures, workflows, how-to sequences, algorithms.

```md
%%CW_CARD_START uid:CW-002%%

### Git Rebase Workflow

1. Fetch the latest upstream: `git fetch origin`
2. Switch to your feature branch: `git checkout feature/my-work`
3. Rebase onto main: `git rebase origin/main`
4. Resolve any conflicts, then continue: `git rebase --continue`
5. Force-push the rebased branch: `git push --force-with-lease`

> **Warning:** Never rebase commits that have already been merged into a shared branch.

%%CW_CARD_END uid:CW-002%%
```

```json
{
  "uid": "CW-002",
  "type": ["process", "git", "workflow"],
  "topic": "Git Rebase Workflow",
  "raw_content": "Git rebase replays your branch commits on top of another branch tip, producing a linear history. Workflow: (1) git fetch origin — pulls the latest remote state without merging; (2) git checkout feature/my-work — switches to the branch to be rebased; (3) git rebase origin/main — replays your commits one by one on top of the updated main; (4) if conflicts arise, resolve them in the affected files, then stage with git add and run git rebase --continue to proceed; git rebase --abort cancels and restores the branch to its original state; (5) git push --force-with-lease — rewrites the remote branch history safely; --force-with-lease rejects the push if the remote has received new commits since your last fetch, preventing accidental overwrites. Critical rule: never rebase commits that have already been merged into a shared branch because it rewrites commit hashes and forces every collaborator to reconcile their history.",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "Fetch → Switch → Rebase → Resolve → Push (F-S-R-R-P)",
    "qa_pairs": [
      {
        "q": "Which flag should you use when force-pushing a rebased branch and why?",
        "a": "`--force-with-lease` — it refuses to overwrite if someone else has pushed to the branch since your last fetch, preventing accidental history loss."
      }
    ],
    "fill_in_the_blanks": [
      { "sentence": "After resolving a rebase conflict you run `git rebase _____` to continue.", "answers": ["--continue"] },
      { "sentence": "Never rebase commits that are already on a _____ branch.", "answers": ["shared"] }
    ]
  },
  "referenced_in": [
    {
      "note_path": "git/workflows.md",
      "start_line": 18,
      "end_line": 30
    }
  ]
}
```

---

## Template C — Fact / Formula Card

**Use for:** Formulas, quick facts, dates, laws, constants, rules of thumb.

```md
%%CW_CARD_START uid:CW-003%%

### Big-O of Common Sorting Algorithms

| Algorithm      | Best     | Average  | Worst    | Space  |
|----------------|----------|----------|----------|--------|
| Bubble Sort    | O(n)     | O(n²)    | O(n²)    | O(1)   |
| Merge Sort     | O(n log n) | O(n log n) | O(n log n) | O(n) |
| Quick Sort     | O(n log n) | O(n log n) | O(n²)  | O(log n) |
| Heap Sort      | O(n log n) | O(n log n) | O(n log n) | O(1) |

%%CW_CARD_END uid:CW-003%%
```

```json
{
  "uid": "CW-003",
  "type": ["fact", "algorithms", "complexity"],
  "topic": "Big-O of Common Sorting Algorithms",
  "raw_content": "Bubble Sort: compares adjacent pairs and swaps them repeatedly; best O(n) when already sorted, average and worst O(n²); space O(1). It is rarely used in practice due to poor average performance. Merge Sort: divides the array in half recursively, sorts each half, then merges; always O(n log n) in all cases; space O(n) for the temporary merge buffer; stable sort. Quick Sort: picks a pivot, partitions elements smaller to the left and larger to the right, then recurses; best and average O(n log n); worst O(n²) when the pivot is consistently the minimum or maximum (e.g. already-sorted input with a naive pivot); space O(log n) for the call stack; not stable; in practice often faster than Merge Sort due to cache locality. Heap Sort: builds a max-heap, then repeatedly extracts the maximum; always O(n log n) in all cases; space O(1); not stable; slower in practice than Quick Sort due to poor cache behaviour.",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "Merge and Heap are always n log n; Quick degrades to n² on bad pivots; Bubble is the slow one",
    "qa_pairs": [
      {
        "q": "Which sort has O(n²) worst case but O(n log n) average case?",
        "a": "Quick Sort — worst case occurs when pivots are consistently the smallest or largest element, such as on an already-sorted array with a naive first-element pivot."
      },
      {
        "q": "Which O(n log n) sort uses O(1) extra space?",
        "a": "Heap Sort."
      }
    ],
    "fill_in_the_blanks": [
      { "sentence": "Merge Sort always runs in O(_____) time but requires O(_____) extra space.", "answers": ["n log n", "n"] },
      { "sentence": "Quick Sort degrades to O(_____) when pivot selection is consistently poor.", "answers": ["n²"] }
    ]
  },
  "referenced_in": [
    {
      "note_path": "algorithms/sorting.md",
      "start_line": 63,
      "end_line": 74
    }
  ]
}
```

---

## Template D — Comparison Card

**Use for:** Two or more options, trade-offs, vs. breakdowns, decision criteria.

```md
%%CW_CARD_START uid:CW-004%%

### REST vs. GraphQL

**REST**
- Resource-based endpoints (one URL per resource)
- Client gets a fixed shape — may over-fetch or under-fetch
- Caching is straightforward with HTTP semantics
- Widely understood; excellent tooling support

**GraphQL**
- Single endpoint; client declares the exact shape it needs
- Eliminates over-fetching and under-fetching
- Caching is more complex (no standard HTTP cache keys)
- Higher upfront schema design cost

**When to prefer REST:** public APIs, simple CRUD, when caching is critical.  
**When to prefer GraphQL:** complex nested data, multiple client types, rapid front-end iteration.

%%CW_CARD_END uid:CW-004%%
```

```json
{
  "uid": "CW-004",
  "type": ["comparison", "api", "web"],
  "topic": "REST vs. GraphQL",
  "raw_content": "REST (Representational State Transfer): architectural style where each resource has its own URL (e.g. /users/42, /posts/7). The server defines the response shape, so clients may receive more fields than needed (over-fetching) or have to make multiple requests to gather related data (under-fetching). HTTP verbs (GET, POST, PUT, DELETE) map to CRUD operations. HTTP-layer caching works out of the box via cache headers and URL-keyed responses. REST is widely understood, has mature tooling, and suits public APIs and simple CRUD services. GraphQL: query language and runtime with a single endpoint (typically /graphql). Clients write queries that declare exactly which fields they need, eliminating over- and under-fetching. Supports queries (read), mutations (write), and subscriptions (real-time). Caching is more complex because all requests go to one URL via POST, requiring client-side caches (e.g. Apollo Client) or persisted queries. Schema design and resolver implementation have a higher upfront cost. Best suited for complex nested data, multiple client types with different data needs, and rapid front-end iteration without back-end changes.",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "REST = rigid menu (you get what's on it); GraphQL = custom order (you specify exactly what you want)",
    "qa_pairs": [
      {
        "q": "Why is caching harder with GraphQL than REST?",
        "a": "REST responses map to unique URLs which HTTP can cache natively via cache headers; GraphQL sends all requests as POSTs to one endpoint, so there is no standard HTTP cache key — client-side caches like Apollo or persisted queries are needed instead."
      }
    ],
    "fill_in_the_blanks": [
      { "sentence": "REST may cause ___-fetching because the server decides the response shape.", "answers": ["over"] },
      { "sentence": "GraphQL sends all queries to a _____ endpoint.", "answers": ["single"] }
    ]
  },
  "referenced_in": [
    {
      "note_path": "web/apis.md",
      "start_line": 27,
      "end_line": 42
    }
  ]
}
```

---

## Template E — Q&A / Drill Card

**Use for:** Cards whose primary purpose is active recall — flashcard-style, interview prep, exam practice.

```md
%%CW_CARD_START uid:CW-005%%

### What is the difference between `==` and `===` in JavaScript?

**`==` (loose equality)**  
Performs type coercion before comparing.  
`0 == "0"` → `true`

**`===` (strict equality)**  
Compares value and type with no coercion.  
`0 === "0"` → `false`

**Rule of thumb:** always use `===` unless you explicitly need coercion.

%%CW_CARD_END uid:CW-005%%
```

```json
{
  "uid": "CW-005",
  "type": ["qa", "javascript", "language-basics"],
  "topic": "== vs === in JavaScript",
  "raw_content": "JavaScript == (loose equality) converts both operands to a common type before comparing (Abstract Equality Comparison algorithm). Examples: 0 == '0' → true (string coerced to number); null == undefined → true (special rule); [] == false → true ([] → '' → 0, false → 0); 0 == false → true. JavaScript === (strict equality) compares value and type with no coercion; if the types differ the result is immediately false. Examples: 0 === '0' → false; null === undefined → false; 1 === 1 → true. Rule of thumb: always use === unless you have a specific reason to allow coercion. The only widely accepted use of == is the null check (x == null) which catches both null and undefined in one expression. typeof always returns a string, so typeof x === 'number' is the correct pattern — never typeof x == 'number' (though it works, it is misleading).",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "Three equals = three things must match (value, type, sanity)",
    "qa_pairs": [
      {
        "q": "What does `null == undefined` evaluate to?",
        "a": "true — this is a special rule in the Abstract Equality Comparison algorithm. `null === undefined` is false because the types differ."
      },
      {
        "q": "What does `[] == false` evaluate to and why?",
        "a": "true — [] is coerced to an empty string, then to 0; false is coerced to 0; 0 == 0 is true."
      }
    ],
    "fill_in_the_blanks": [
      { "sentence": "`0 == '0'` evaluates to _____ because == performs type _____.", "answers": ["true", "coercion"] },
      { "sentence": "`0 === '0'` evaluates to _____ because the types do not _____.", "answers": ["false", "match"] }
    ]
  },
  "referenced_in": [
    {
      "note_path": "javascript/equality.md",
      "start_line": 91,
      "end_line": 103
    }
  ]
}
```

---

## Template F — Minimal Card

**Use for:** Quick notes, short references, or when you want maximum readability in the vault with minimal structure.

```md
%%CW_CARD_START uid:CW-006%%

A **pure function** always returns the same output for the same input and has no side effects.

%%CW_CARD_END uid:CW-006%%
```

```json
{
  "uid": "CW-006",
  "type": ["concept", "functional-programming"],
  "topic": "Pure Function",
  "raw_content": "A pure function has two defining properties. (1) Determinism: for the same arguments it always returns the same value — no randomness, no dependency on external mutable state, no reading of globals or I/O. (2) No side effects: it does not modify any state outside its own scope — no mutating arguments, no writing to globals, no I/O operations (network, disk, console), no triggering observable events. Benefits: pure functions are trivially testable (no mocking required), safely memoizable (cache the return value keyed on inputs), and safe to run in parallel (no shared mutable state). They are the foundation of functional programming. Impure functions include those that read Date.now(), Math.random(), mutate their arguments, or perform network calls. A function that calls a pure function is itself pure only if it introduces no impurity of its own.",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "Pure = predictable + isolated",
    "qa_pairs": [
      {
        "q": "Name two properties that define a pure function.",
        "a": "Deterministic output (same input → same output) and no side effects (no mutations or I/O outside the function's own scope)."
      }
    ],
    "fill_in_the_blanks": [
      { "sentence": "A pure function produces the same _____ for the same input every time.", "answers": ["output / return value"] },
      { "sentence": "Pure functions have no _____ _____.", "answers": ["side", "effects"] }
    ]
  },
  "referenced_in": [
    {
      "note_path": "functional/basics.md",
      "start_line": 12,
      "end_line": 16
    }
  ]
}
```

---

## Field Reference

All templates use the same payload schema in the card JSON file:

| Field | Description |
|---|---|
| `uid` | Unique card ID, matches the `%%CW_CARD_START%%` comment |
| `type` | Array of category/tag strings |
| `topic` | Human-readable card title |
| `raw_content` | Complete, self-contained knowledge detail — sufficient to understand the card without reading the surrounding note |
| `metadata.familiarity` | Spaced-repetition score; starts at `0` |
| `metadata.next_review` | ISO date string or `null` if not yet scheduled |
| `memory_tricks.memory_technique` | Short mnemonic phrase or keyword anchor |
| `memory_tricks.qa_pairs` | Array of `{ q, a }` objects for active recall |
| `memory_tricks.fill_in_the_blanks` | Array of `{ sentence, answers }` objects — `sentence` contains `_____` gaps, `answers` is an array of correct fills in blank order |
| `referenced_in[].note_path` | Relative path of a note that contains this card |
| `referenced_in[].start_line` | 1-based line number of the `%%CW_CARD_START%%` boundary in that note |
| `referenced_in[].end_line` | 1-based line number of the `%%CW_CARD_END%%` boundary in that note |

> The line numbers shown above are illustrative. CrashWeaver should maintain them automatically by reparsing affected notes.

> The exact JSON schema and boundary grammar will be finalized during Stage 3 implementation. These templates reflect the planned split model: lightweight note boundaries plus external per-card JSON storage with synchronized note references.
