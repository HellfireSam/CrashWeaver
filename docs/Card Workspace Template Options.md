# Card Workspace Template Options

These are UI templates for future card rendering in the Cards workspace. None of them are wired into the app yet.

## 1. Split Workspace

- left rail lists cards
- center panel shows full card detail
- right panel hosts the future LLM companion
- memory tricks live in expandable sections under the card body

## 2. Study Deck

- one focused flashcard at a time with previous and next navigation
- front shows the card title or ID, tags, familiarity, and current note reference
- back reveals raw content and memory tricks
- Q&A prompts appear in a drill tray below the card, including prompts that use blanks directly in the question text

## 3. Inspector Ledger

- dense table-like card list for scanning many cards at once
- selecting a row opens an inspector with every card attribute
- references and metadata are always visible
- memory tricks appear as tabbed inspector sections

## 4. Review Queue

- cards are presented as a queue ordered by familiarity or next review
- each card has quick actions like reveal answer, practice prompts, skip, and pin
- references sit in a small provenance area
- memory tricks are shown after the reveal step

## 5. Notebook Card

- card looks like a structured research note
- card title or ID and raw content are dominant
- tags, familiarity, next review, and references sit in a slim side gutter
- memory tricks appear as collapsible notebook callouts

## 6. Atlas Card

- focused card in the center, related cards and references orbit around it
- tags, references, and note origins are emphasized visually
- raw content is split into concept summary and full detail
- memory tricks appear in a radial tools drawer or slide-out pane

## 7. Practice Lab

- card detail is secondary to practice widgets
- top area shows the card title or ID, tags, and source note references
- center focuses on Q&A prompts, with blanks represented directly inside the question text
- raw content and memory technique are available in a side reveal panel

## 8. Timeline Card

- useful for process or sequence-heavy cards
- references and metadata appear above a linear content timeline
- raw content is chunked into milestones or sections
- memory tricks appear as checkpoints the user can reveal while advancing

## 9. Comparison Board

- ideal for cards with structured contrasts, tradeoffs, or alternatives
- card content is shown as two or more comparison columns
- metadata and references live in a summary strip
- memory tricks become prompts under each comparison column

## 10. Reference Sheet

- compact printable look for high-density study notes
- all core attributes are visible at once: card title or ID, type, content, metadata, references
- memory tricks are hidden behind small chips or drawers to reduce clutter
- future LLM panel would attach as a lightweight contextual sidebar

## Suggested Attribute Mapping

Every future template should account for these fields:

- uid
- card title or ID, stored in `uid`
- type tags
- raw content
- metadata.familiarity
- metadata.next_review
- referenced_in note path and line range
- memory_tricks.memory_technique
- memory_tricks.qa_pairs

## Suggested Future Companion Hooks

When the LLM process layer is added later, every template should expose:

- focused card title / ID
- focused window or subpanel
- visible memory tricks mode
- current practice mode such as Q&A with optional blanks in the prompt text
- current reference context such as active note path