# Stage 4 Setup

Canonical setup commands:
- docs/01-Development-Setup.md

## Manual Stage 4 Validation Flow

1. Launch app with npm run dev.
2. Open a vault.
3. Confirm .crashweaver tree visibility in explorer.
4. Use Crashpad widget and confirm daily crashpad open/create.
5. Confirm Source/Preview/Cards tabs appear only for markdown notes.
6. Create another crashpad and reopen it from explorer.
7. Create a new card by UID from crashpad.
8. Edit fields and save.
9. Confirm card JSON reflects edits.
10. Attach an existing card by UID.
11. Delete existing card and verify configured confirmation and boundary-removal defaults.
12. Use undo/redo and verify card-store plus crashpad state transitions.
13. Change crashpad delete preferences and verify persistence after restart.

