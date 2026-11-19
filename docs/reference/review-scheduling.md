# Review scheduling

A **Review** is the user's assessment of how familiar a **Due** card is. Selecting one of four
responses records the card's **Familiarity** and recomputes its **Next review**. The domain terms
are defined in [CONTEXT.md](../../CONTEXT.md); the decision to use this algorithm is
[ADR-0004](../adr/0004-sm2-osr-review-scheduling.md).

## The card's scheduling state

Scheduling state lives on the card (`CardDocument.metadata`) and nowhere else — see
[ADR-0003](../adr/0003-card-level-review-state.md). Every field is required by the type; the card
store supplies the default when a file is missing one.

| Field           | Type             | Default | Meaning                                                                                                               |
| --------------- | ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `familiarity`   | `number`         | `0`     | The last response: `0` = never reviewed, `1` = Again, `2` = Hard, `3` = Good, `4` = Easy.                             |
| `next_review`   | `string \| null` | `null`  | The calendar date (`YYYY-MM-DD`) the card becomes due. `null` means never reviewed, so the card is due.               |
| `interval_days` | `number`         | `0`     | Whole days between the review and the next one. `0` means due today (never reviewed, or rated Again).                 |
| `ease_factor`   | `number`         | `2.5`   | The SM-2 ease. Floored at `1.3`; Good leaves it unchanged, Easy raises it by `0.2`, Hard and Again lower it by `0.2`. |

The store normalises on both read and write, so a hand-edited card or a card file written before
these fields existed cannot introduce invalid state: `familiarity` is rounded and clamped to
0–4 (non-number/NaN → 0), `next_review` must be a real `YYYY-MM-DD` (anything else → `null`),
`interval_days` is truncated to an integer and floored at 0, and `ease_factor` is rounded to two
decimals and floored at 1.3.

## The four responses

`I` is `max(1, interval_days)`. Intervals are whole days (`Math.round`) and capped at 36,525.

| Response | Familiarity | Ease                   | Next interval                        |
| -------- | ----------- | ---------------------- | ------------------------------------ |
| Again    | `1`         | `max(1.3, ease − 0.2)` | `0` — due today, requeued in-session |
| Hard     | `2`         | `max(1.3, ease − 0.2)` | `max(1, round(I × 0.5))`             |
| Good     | `3`         | unchanged              | `max(1, round(I × ease))`            |
| Easy     | `4`         | `ease + 0.2`           | `max(1, round(I × ease × 1.3))`      |

Two details are easy to get wrong and are deliberate:

- **The base is `max(1, interval_days)`.** Again stores `interval_days: 0`; without the floor the
  next rating would multiply zero and the card would never leave today.
- **Easy applies the raised ease before computing the interval**, so the same rating both makes the
  card easier and lengthens this interval.

A never-reviewed card (`interval_days: 0`, `ease_factor: 2.5`) therefore schedules Again → today,
Hard → 1 day, Good → 3 days, Easy → 4 days. `next_review` is the review date plus the interval;
Again stores the review date itself.

This is the reference plugin's SM-2-OSR variant with a decimal ease. It deliberately has **no
repetition counter**, **no random fuzz or load balancing**, **no late-review compensation** and
**no user-configurable parameters**. Those are recorded as future possibilities in
[ADR-0004](../adr/0004-sm2-osr-review-scheduling.md), not as settings.

## Dates and due cards

- A review date is a **local calendar date**, not an instant: a card due on `2026-11-19` is
  reviewable from local midnight. The app stores no timezone.
- A card is **Due** when `next_review` is `null` or `<=` today.
- Date arithmetic parses dates as UTC midnight and formats back from UTC, so a daylight-saving
  transition cannot move an interval by a day (`electron/utils/calendarDate.ts`).

## The review session queue

`selectDueCards` in `src/lib/reviewQueue.ts` builds the session:

1. Keep every card whose `next_review` is `null` or today-or-earlier. Orphaned cards and
   crashpad-created cards count. A hand-dropped card file whose filename is outside the UID grammar
   can still enter the queue, because the renderer lists cards by filename; its preview fails the
   store's UID validation, the session reports that error and drops the card, and the rest of the
   queue continues.
2. Order new cards first, then the oldest `next_review`, then UID.
3. A rating persists immediately. **Again** leaves the card due today and puts it at the end of the
   same session's queue, so it can be rated again before the session ends.
4. The session has no card cap and ends when the queue is empty (a summary is shown) or when the
   user exits. Leaving early abandons the session only; every rating already written stands.

## Where the scheduling runs

The renderer never computes a schedule. `electron/reviewService.ts` owns the write path:

- `previewCardReview(rootPath, uid)` re-reads the card and returns the interval each of the four
  responses would produce, so the rating buttons can show `Good · 3 days` before the user commits.
- `scheduleCardReview(rootPath, uid, response)` re-reads the card, validates the response, computes
  the new `CardMetadata`, writes the whole card through the card store (which normalises it), and
  returns the stored card plus the next preview.

Re-reading in the main process is what stops a stale renderer copy from clobbering a card the vault
watcher changed; the review write is the only writer of scheduling state. The channels are
`review:preview-card` and `review:schedule-card` in `electron/ipcChannels.ts`; both sides are proved
to agree by `tests/electron/ipcChannels.test.ts`.

The pure algorithm is `electron/services/reviewScheduling.ts`: given stored `CardMetadata`, a
response and the review date, `scheduleCardMetadata` returns the next state. It reads no clock and
touches no filesystem, which is why `tests/electron/reviewScheduling.test.ts` can pin every response,
the ease floor, the interval cap, the Again-then-Good recovery and month/leap-day arithmetic.

## Migration and the vault index

The vault index used to carry a six-field `ReviewMetadata` per note entry, which nothing consumed.
It was removed rather than migrated: `VaultIndex.version` is now `2`, a version 1 index is read
tolerantly (ids and entries preserved) and rewritten without the field. See
[ADR-0003](../adr/0003-card-level-review-state.md).
