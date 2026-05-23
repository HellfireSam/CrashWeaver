# Stage 2 Setup

## Development Environment

1. Install Node.js 20 LTS or newer on Windows.
2. Open the project root in a terminal.
3. Run npm install.
4. Run npm run dev.

## Validation Commands

- npm run typecheck
- npm run build

## Manual Stage 2 Validation Flow

1. Launch app with npm run dev.
2. Click Open Vault.
3. Select a vault folder.
4. Confirm markdown notes are listed.
5. Confirm explorer starts with folders collapsed and toggles correctly.
6. Open a note, edit content, and save.
7. Confirm `.crashweaver/index.json` refresh works.
8. Switch source and preview modes and verify markdown plus math rendering.
9. Open card mode and confirm placeholder behavior for future stages.

## Stage 2 Deliverables

- vault open/read/write workflows
- note-level index generation
- source and preview editor workflows
- explorer and layout stabilization

## Clarified Scope Notes For Upcoming Work

The clarified product requires these future validations beyond Stage 2:

- parser validation for paired UID boundary comments
- card store folder selection and per-card JSON creation
- note reference tracking with note_path, start_line, and end_line
- sync behavior when a markdown file with cards is created, modified, or deleted
- rebuild or repair flow for card-store reconciliation
- card create/edit/delete-confirm/undo/redo on canvas
- weave mode execution planning
- accept-reject gate that prevents automatic LLM writes

These are not Stage 2 requirements and should be validated in upcoming stage setup guides.
