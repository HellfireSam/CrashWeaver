# CrashWeaver domain glossary

The project's domain vocabulary. Each term has exactly one meaning here, and the words
below are the words to use in code, issues, tests and documentation. This is a glossary
only: it holds no architecture and no implementation detail, and it deliberately states
no naming rules.

Architecture lives in [`docs/architecture/`](./docs/architecture/overview.md).

| Term                  | Definition                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Crash Card**        | The core unit. Holds a piece of knowledge to remember, its categorisation, its mnemonic aids, and its review state. Short form in prose: "card".                                     |
| **Note**              | A markdown file in the vault. Holds prose and, where cards are placed, the boundaries marking which text belongs to which card — never a card's full payload.                        |
| **Vault**             | The folder the user opens as their knowledge base. Notes and their boundaries stay inside it; the card store lives inside it by default but can be configured elsewhere.             |
| **Card store**        | The folder holding the full payload of every card, one file per card.                                                                                                                |
| **UID**               | A card's unique identifier and title — the only thing linking a note's boundaries to a card's payload. It may contain spaces.                                                        |
| **UID boundary**      | The paired start/end markers delimiting the span of a note attributed to one card.                                                                                                   |
| **Reference**         | A link from a card to a specific line span in a specific note where that card appears. A card holds many. `referenced_in` is only the field that stores references, not the concept. |
| **Orphaned card**     | A card whose references have all gone.                                                                                                                                               |
| **Crashpad**          | The authoring surface where cards are composed and arranged before being woven into notes.                                                                                           |
| **Weaver**            | The LLM agent that acts on the user's behalf: reads the vault, reasons, proposes changes.                                                                                            |
| **weave**             | One run of the Weaver, ending in one plan.                                                                                                                                           |
| **Weave plan**        | The ordered set of proposed operations a weave produces, reviewed by the user before anything is written.                                                                            |
| **Weave operation**   | One proposed change within a plan.                                                                                                                                                   |
| **Approval gate**     | The point where the user accepts or rejects a plan. No note, boundary or card payload is written before it.                                                                          |
| **Guided insert**     | A weave kind that adds one specific card to a note.                                                                                                                                  |
| **Intelligent weave** | A weave kind that restructures notes and folders.                                                                                                                                    |
| **Weave strength**    | How much autonomy a weave is granted (light / standard / go ham). Changes autonomy only, never model routing.                                                                        |
| **Memory tricks**     | A card's mnemonic aids: one technique phrase plus question/answer pairs.                                                                                                             |
| **Familiarity**       | How well the user knows a card, as scheduling state: one of four levels — Again, Hard, Good or Easy — assigned by a Review. `_Avoid_: difficulty, ease.`                             |
| **Next review**       | The calendar date on which a card next becomes Due.                                                                                                                                  |
| **Due**               | A card whose Next review is today or earlier.                                                                                                                                        |
| **Review**            | Assessing a Due card's Familiarity, which recomputes its Next review.                                                                                                                |
| **Review session**    | A run of Reviews over the Due cards, ending when none remain or the user stops.                                                                                                      |
| **Diagnostic**        | A parser report of a malformed boundary.                                                                                                                                             |
