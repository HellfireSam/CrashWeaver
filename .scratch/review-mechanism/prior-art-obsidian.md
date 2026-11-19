# Prior art: Obsidian "Spaced Repetition" and "Periodic Notes"

Read from source: `st3v3nmw/obsidian-spaced-repetition` `main` @ `298c19f` (manifest v1.15.4) and
`liamcain/obsidian-periodic-notes` `main` @ `a8aa7e4` (v0.0.17). **(docs)** marks the plugin docs,
which lag the code in two places noted below. No recommendations here.

## Facts

- Only one of the two plugins reviews anything. **Spaced Repetition** is the review plugin;
  **Periodic Notes** has no review/spaced-repetition/familiarity code at all.
- Spaced Repetition has **two review flows**: flashcards (deck tree → card → answer → 4 buttons)
  and whole notes (a "Note Review Queue" in the right sidebar, rated from the file menu/commands).
- Flashcard ratings: **Again / Hard / Good / Easy**; notes: **Hard / Good / Easy** (+ Reset).
  There is **no 1–5 familiarity selector**; "familiarity" is the stored SM-2 ease number.
- **SM-2-OSR** and **FSRS** are both implemented for cards; **notes always use SM-2-OSR**.
- SM-2-OSR defaults: ease **250** (percentage points), initial interval **1 day**, Easy `+20` ease
  and `×1.3`, Good `×ease/100`, Hard `−20` ease and `×0.5`, Again `−20` ease and **interval 0**
  (requeued in the same session).
- State lives **in the markdown**: card comment `<!--SR:!2024-08-16,51,230-->`, note frontmatter
  `sr-due` / `sr-interval` / `sr-ease`; dates `YYYY-MM-DD`.
- **Neither plugin touches daily/periodic notes.** Nothing writes due cards into a daily note.

## A. Spaced Repetition (st3v3nmw)

### A1. Review UX

- **Flashcards.** Ribbon icon or command opens a deck list, then the card view: front →
  `Show answer` → rating buttons. The surface is an Obsidian item view
  (`spaced-repetition-tab-view`) or, by default, a **modal** (`SRModalView`), chosen by
  `openViewInNewTab` / `openViewInNewTabMobile`
  ([ui-manager.tsx](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/ui/ui-manager.tsx)).
- **Notes.** Separate right-sidebar view whose type is `REVIEW_QUEUE_VIEW_TYPE`, listing notes
  tagged `#review` (configurable) under New and due dates; shown at startup when
  `enableNoteReviewPaneOnStartup` (default true). **No note top bar** — note ratings are in the
  three-dot file menu, the queue's context menu, or commands
  ([notes.md](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/docs/docs/en/notes.md)).
- **Buttons:** `Show Answer`, then **Again, Hard, Good, Easy** (texts configurable). With
  `showIntervalInReviewButtons` (default true) each shows its resulting interval, e.g.
  `Good - 12d`. Cram mode shows only Again/Easy
  ([response-section.tsx](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.tsx)).
- **Keyboard** (card view, desktop): `Space`/`Enter` = show answer, then Good; `1`=Hard, `2`=Good,
  `3`=Easy, `0`=Reset; `S`=skip, `J`=jump. Again has a command but no built-in key
  ([card-container.tsx](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/ui/obsidian-ui-components/content-container/card-container/card-container.tsx)).
- **Queue type:** both — decks of flashcards parsed from note text, plus a queue of whole notes.

### A2. Scheduling algorithm

`SM-2-OSR`, "a variant of Anki's algorithm … based on SM-2" with ternary hard/good/easy reviews
**(docs)**, plus a fourth `Again`; enum `Easy, Good, Hard, Again, Reset`
([algorithms.md](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/docs/docs/en/algorithms.md),
[repetition-item.ts](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/scheduling/algorithms/base/repetition-item.ts)).
One function `osrSchedule()` serves cards and notes. Defaults: `baseEase` 250, `easyBonus` 1.3,
`lapsesIntervalChange` 0.5, `maximumInterval` 36525, ease floor 130
([note-scheduling.ts](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/scheduling/algorithms/osr/note-scheduling.ts),
[settings.ts](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/data/settings.ts)):

| Response | Ease | Interval |
| --- | --- | --- |
| Easy | `ease += 20` | `interval × ease/100 × 1.3` |
| Good | unchanged | `interval × ease/100` |
| Hard | `max(130, ease − 20)` | `max(1, interval × 0.5)` |
| Again | `max(130, ease − 20)` | `0` (due today, requeued in-session) |

- **Initial:** interval `1.0` day; ease = `baseEase`, or for notes the link-weighted
  `(1−c)·baseEase + c·avgEase`, `c = maxLinkFactor·min(1, log(links+0.5)/log(64))` (PageRank),
  averaged with the note's card ease. **No repetition counter** — state is only due/interval/ease.
- **Fuzz** is deterministic load-balancing in code: when `loadBalance` (default true) and
  interval > 7, the interval moves to the least-used day within ±1 (≤21), ±3 (≤180) or ±7 (>180)
  days. The docs' random `±ceil(0.05·interval)` fuzz is stale **(docs, stale)**.
- **FSRS** is implemented for cards (`ts-fsrs`, `fsrsDesiredRetention` 0.9); note scheduling
  delegates to SM-2-OSR unconditionally (`noteDelegate = new SRAlgorithmOsr`)
  ([sr-algorithm-fsrs.ts](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/scheduling/algorithms/fsrs/sr-algorithm-fsrs.ts)).
  The docs still list FSRS as "Planned" **(stale)**.

### A3. Data storage

- **Cards:** HTML comment after the card, `<!--SR:!<due>,<interval>,<ease>-->`, e.g.
  `<!--SR:!2024-08-16,51,230-->`. Siblings share one comment, concatenated `!d,i,e!d,i,e…`; an
  unreviewed sibling uses the sentinel `2000-01-01`. Same-line placement and a
  `> [!sr|card-metadata]` callout variant are optional.
- **Notes:** frontmatter `sr-due` (`YYYY-MM-DD`), `sr-interval` (number, may be fractional),
  `sr-ease` (number); reading also accepts `DD-MM-YYYY` and `ddd MMM DD YYYY`. Optional `sr-id`
  ([note-file.ts](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/data/data-structures/file/note-file.ts)).
- **FSRS cards:** `<!--SR:!fsrs,<ISO due>,<interval>,<stability>,<difficulty>,<state>,<reps>,<lapses>,<learningSteps>,<ISO lastReview>-->`.
- **`data.json`** holds only settings, `buryDate`/`buryList` (hashes of buried siblings) and
  `historyDeck`; a `scheduleData` structure exists but only the `NOTES` storage type is implemented
  ([data-store.ts](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/src/data/data-store/base/data-store.ts)).
- **(docs)** [data-storage.md](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/docs/docs/en/data-storage.md)
  confirms the comment and frontmatter formats; the single scheduling file is not implemented.

### A4. Daily / periodic-note integration

- **None.** No path writes due cards into a daily note; no dependency on the core daily-notes
  plugin or Periodic Notes; no "periodic" concept in `src/` (grep).
- Instead: the sidebar note queue, a status-bar counter (`Review: N note(s)`), review reminders
  (`reviewReminder*`, optional `reviewReminderAutoOpen`), `openRandomNote`, `autoNextNote`.
- So "periodic notes" plays **no role** in either plugin's review feature.

### A5. "Familiarity"

No familiarity field, scale, or label exists in code (no match for "familiar"). The user picks one
of four responses (three for notes); "familiarity" is *derived*: `sr-ease` (percentage, default
250, floor 130), interval in days, due date.

## B. Periodic Notes (liamcain)

- Creates/opens **daily, weekly, monthly, quarterly, yearly** notes from per-calendar-set config
  `{ enabled, openAtStartup, format, folder, templatePath }`; commands for current/next/previous;
  ribbon icons; timeline view; NL-dates switcher if `nldates-obsidian` is installed
  ([types.ts](https://github.com/liamcain/obsidian-periodic-notes/blob/main/src/types.ts)).
- **Templating:** `{{date}}`, `{{time}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`, day names
  `{{monday:YYYY-MM-DD}}` (weekly), `{{month}}`/`{{quarter}}`/`{{year}}` with formats and offsets
  ([utils.ts](https://github.com/liamcain/obsidian-periodic-notes/blob/main/src/utils.ts)).
- **Auto-open:** the note whose granularity has `openAtStartup` opens at startup
  (`findStartupNoteConfig`).
- **No review/spaced-repetition/familiarity features** — zero matches for
  spaced/review/memory/recall/familiar in `src/` and `README.md`.
- **Relation to core Daily notes:** it replaces, not wraps. It reads the core plugin via
  `app.internalPlugins.getPluginById("daily-notes")` only to migrate format/folder/template into
  its first calendar set, and its Getting Started banner offers a button to disable the core plugin
  ([settings/utils.ts](https://github.com/liamcain/obsidian-periodic-notes/blob/main/src/settings/utils.ts)).

## C. Rating-scale conventions

| Scale | Values | Mapping |
| --- | --- | --- |
| Anki SM-2 ([FAQ](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm)) | Again / Hard / Good / Easy | Again: ease −20 pp, interval × new-interval setting, relearning. Hard: ease −15 pp, interval × hard interval (1.2). Good: interval × ease. Easy: interval × ease × easy bonus, ease +15 pp. Interval modifier applies to the last three; 4 buttons replace SM-2's 6. |
| Anki FSRS | same 4 buttons | Grades 1–4 feed Difficulty/Stability/Retrievability. |
| Obsidian Spaced Repetition | Again / Hard / Good / Easy (notes: Hard/Good/Easy) | Table in A2; same buttons map to FSRS grades 1–4 (`reviewResponseToFsrsGrade`). |
| SM-2 original ([SuperMemo](https://www.supermemo.com/en/archives1990-2015/english/ol/sm2)) | q 0–5, labelled 5 perfect … 0 blackout | `EF' = EF + (0.1 − (5−q)(0.08 + (5−q)·0.02))`, `EF ≥ 1.3`; `q < 3` restarts repetitions; `I(1)=1`, `I(2)=6`, `I(n)=I(n−1)·EF`. |

A "familiarity 1–5" selector amounts to a compressed SM-2 quality scale. Neither Obsidian plugin
reviewed has one: both use 4 discrete buttons, and the numeric ease is computed, never chosen.

**Verified vs. community summary.** Every mechanic above was read from the repos at the commits
given (Anki/SuperMemo: official docs). The only inference is describing "familiarity" as derived
ease — an inference from the data model, not a term the plugin uses.
