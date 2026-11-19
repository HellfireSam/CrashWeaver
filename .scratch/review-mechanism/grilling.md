# CrashWeaver — card review loop grilling record

**Status: grilling COMPLETE; implementation in progress on `feat/card-review-loop`.**
This file is the authoritative record of what was decided and why. Read it to resume. The
supporting prior-art research is [`prior-art-obsidian.md`](./prior-art-obsidian.md).

- **Repo:** `/root/CrashWeaver` (clone of `github.com/HellfireSam/CrashWeaver`)
- **Branch:** `feat/card-review-loop`, cut from `main` at `c189a35`
- **Session date:** recorded during the grilling session that created this file
- **Skill:** `/grill-with-docs` (grilling + domain modeling)

---

## 1. The goal

Implement the card review loop: the user reviews the cards that are due, selects how familiar the
card is, and the app computes the card's next review date with a standard spaced-repetition
algorithm. The user referenced the Obsidian "periodic notes" extension; research showed that
plugin has no review feature at all and the behaviour they described is the Obsidian **Spaced
Repetition** plugin.

## 2. What the code already had (measured, not assumed)

- A card carries `metadata.familiarity` (number, default `0`, unvalidated) and
  `metadata.next_review` (any string or `null`, never parsed). The crashpad editor was the only
  writer, as two free-text inputs; the metadata panel only displayed them.
- Vault-index entries carried a six-field `ReviewMetadata` (`lastReviewedAt`, `nextReviewAt`,
  `intervalDays`, `repetition`, `easeFactor`, `familiarity`) that nothing consumed. The rework
  session chose to keep it as a future note-level concept and said to revisit it at this stage.
- No due calculation, review queue, rating control or scheduling algorithm existed.

## 3. Research facts that shaped decisions

From the Obsidian Spaced Repetition plugin source (`st3v3nmw/obsidian-spaced-repetition` @
`298c19f`) and Periodic Notes (`liamcain/obsidian-periodic-notes` @ `a8aa7e4`):

- Periodic Notes has **zero** review code; Spaced Repetition is the review plugin.
- Spaced Repetition has no 1–5 familiarity selector; its four responses are **Again / Hard /
  Good / Easy** and it stores an SM-2 **ease** (250 = 2.5, floor 130 = 1.3).
- Its algorithm is **SM-2-OSR**: interval base `max(1, interval)`; Easy +20 ease then
  `interval × ease/100 × 1.3`; Good `interval × ease/100`; Hard `−20` ease and `interval × 0.5`;
  Again `−20` ease and interval `0` (due today, requeued in-session). No repetition counter.
- It has a dedicated card view (modal or new tab) plus a sidebar note-review queue; **nothing**
  integrates with daily/periodic notes.

## 4. Settled decisions

| # | Decision |
| --- | --- |
| Q1 | **Dedicated review session**, entered from the widget rail (`+` becomes Review). No in-place rating, no daily/periodic integration. |
| Q2 | **Four responses Again / Hard / Good / Easy**, stored in `metadata.familiarity` as `1=Again, 2=Hard, 3=Good, 4=Easy` (0 = never reviewed), with SM-2-OSR scheduling state in `next_review`, `interval_days`, `ease_factor`. |
| Q3 | **Card-level review state is the only review state.** Remove the note-level `ReviewMetadata` from the vault index; bump the index to version 2 with a tolerant read of version 1. |
| Q4 | **Remove the two free-text inputs** from the crashpad editor; scheduling state is read-only outside the review loop. No manual override in v1. |
| Q5 | **v1 is the review loop only.** No due badges/filters, statistics, reminders or daily/periodic entry points. |
| Q6 | The reviewer **reads the card payload** (rendered content, memory technique, QnA answers behind reveal) and rates; the whole payload is visible, only QnA answers are concealed. |
| Q7 | The session presents as an **editor-pane workspace** that replaces the editor surface; leaving early abandons the session (ratings already persist); re-entering rebuilds the queue from due cards. |
| Q8 | **Queue rules**: due = `next_review` null or today-or-earlier, over cards the store can address, including orphaned/crashpad cards; order = new first, then oldest due, then UID; Again requeues at the end of the session; no cap; every rating persists immediately; empty queue → summary + Done. |
| Q9 | **Dates and state**: `next_review` is a calendar date `YYYY-MM-DD`; due = `next_review <= local today`; reads normalise invalid state (next_review → null, familiarity → integer 0–4, interval_days → integer ≥ 0, ease_factor → ≥ 1.3); reviews are the only writer; index version 2. |
| Q10 | **SM-2-OSR with decimal ease**: Again `max(1.3, ease−0.2)` / 0 days; Hard `max(1.3, ease−0.2)` / `max(1, round(I×0.5))`; Good unchanged / `max(1, round(I×ease))`; Easy `ease+0.2` / `max(1, round(I×ease×1.3))`; `I = max(1, interval_days)`; initial `interval_days 0`, `ease_factor 2.5`; cap 36,525 days; **no fuzz/load-balancing**, no late-review compensation, no settings UI. |
| Q11 | **Main-process seam**: pure `electron/services/reviewScheduling.ts`, `electron/reviewService.ts` re-reads the card, applies, writes, returns it; new `review:` IPC channels; renderer builds the due queue with pure `src/lib/reviewQueue.ts`. |
| Q12 | **Two ADRs**: ADR-0003 card-level review state (removes the note-level field), ADR-0004 four-response SM-2-OSR scheduling. |
| Q13 | **One GitHub issue spec**, labelled `ready-for-agent`, referenced by the implementation commits. |
| Q14 | Implement on a short-lived branch, small Conventional Commits, push it and open a PR with gate evidence; the owner merges. |
| Q15 | The seven delivery assumptions were confirmed: editing preserved, constants fixed, index migration, gate evidence, docs and tests shipped with the code. |

## 5. Domain terms added to `CONTEXT.md`

`Familiarity` sharpened (four levels: Again, Hard, Good, Easy), `Next review` (calendar date), and
new `Due`, `Review`, `Review session`. The glossary stays implementation-free; the formulas live in
`docs/reference/review-scheduling.md`.

## 6. Deferred / out of scope

- Due badges and a due filter in the Cards workspace.
- A daily/periodic entry point (the reference the user started from).
- Statistics, review history, reminders, configurable algorithm parameters, manual scheduling
  override, active-recall (show-answer) mode, note-level review.
- The note-level `ReviewMetadata` shape is deleted, not migrated; a future note-level review
  specifies its own state.
