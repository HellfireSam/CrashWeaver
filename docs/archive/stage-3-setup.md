> **Superseded.** Archived 2026-10-11 from `docs/Stage 3 Setup.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# Stage 3 Setup

## Manual Stage 3 Validation Flow

1. Launch app with npm run dev.
2. Open a vault.
3. Confirm card-store path in settings.
4. Optionally choose a custom card-store folder and confirm rebuild completes.
5. Add valid card boundaries to a markdown note.
6. Save note and confirm matching UID.json exists in card store.
7. Confirm referenced_in includes note_path, start_line, and end_line.
8. Open Cards view and confirm parsed card plus diagnostics visibility.
9. Move boundary block lines and save; confirm reference line updates.
10. Remove boundary block and save; confirm reference removal when parse is clean.
11. Add malformed boundary and confirm diagnostics while destructive cleanup is blocked.
12. Modify or delete markdown externally and confirm watcher-driven sync behavior.

