# ADR-0004: Four-response SM-2-OSR scheduling

- **Status:** accepted
- **Date:** 2026-11-19
- **Ticket:** [#28](https://github.com/HellfireSam/CrashWeaver/issues/28)

## Context

The review loop needs one scheduling algorithm, and the choice fixes the card schema, the review
surface and the behaviour a user will experience for years of accumulated scheduling state. The
reference the feature was requested from is Obsidian's Spaced Repetition plugin
(`st3v3nmw/obsidian-spaced-repetition`, verified at source), which uses **SM-2-OSR** — a variant of
Anki's SM-2 with four responses (`Again`, `Hard`, `Good`, `Easy`), a decimal ease, and no
repetition counter. Anki and current spaced-repetition practice use the same four responses;
FSRS is the modern alternative but needs a review history.

A 1–5 "familiarity" self-rating was considered and rejected: it is SM-2's original 0–5 quality
input, but no Obsidian plugin exposes it, five-point self-ratings are noisier than discrete outcome
buttons, and the plugin-faithful four buttons double as the recall outcome.

## Decision

Schedule with an SM-2-OSR variant over these card fields: `familiarity` (`1=Again`, `2=Hard`,
`3=Good`, `4=Easy`, `0` = never reviewed), `next_review` (calendar date), `interval_days`, and
`ease_factor`. Formulas:

- `Again`: ease `max(1.3, ease − 0.2)`, interval `0` (due today, requeued in-session).
- `Hard`: ease `max(1.3, ease − 0.2)`, interval `max(1, round(I × 0.5))`.
- `Good`: ease unchanged, interval `max(1, round(I × ease))`.
- `Easy`: ease `ease + 0.2`, interval `max(1, round(I × ease × 1.3))`.

`I = max(1, interval_days)` is the exact plugin behaviour and is what prevents Again's `0` from
producing a zero-interval loop; Easy applies the raised ease _before_ computing the interval
(again the plugin's order). Whole-day intervals, ease floor `1.3`, cap 36,525 days. No random fuzz
(no clock-dependent, unordered behaviour), no load balancing, no late-review compensation, no
configurable settings in v1.

## Consequences

- A pure function, exhaustively testable without a clock: given stored state plus a response and a
  review date it returns the next state.
- The card schema is fixed to four scheduling fields; a future switch to FSRS would require a
  review-history field and a data migration, which is the cost this ADR accepts.
- "Again" is deliberately recoverable in the same session: the card returns with interval `0` and
  the next rating starts from a one-day base, so the loop terminates on a normal rating.
- Absent fuzz or load balancing, cards rated in one batch share a due date. That is predictable
  and testable now; balancing can be added later as a scheduling change with its own tests.
