# Interface and visual system

How the renderer looks and why, and where to change it. This is the reference for the application
shell, its tokens and its shared primitives. The surfaces themselves are described in
[the user guide](../guides/using-crashweaver.md); the process split is in
[the process model](../architecture/process-model.md).

## Where the styles live

`src/styles.css` imports one stylesheet per concern, in cascade order:

| File                                                | Owns                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`foundation.css`](../../src/styles/foundation.css) | Design tokens, the document reset, button/input/focus/scrollbar primitives, the Weaver palette variables     |
| [`layout.css`](../../src/styles/layout.css)         | Title bar, widget rail, sidebar, inspector shell, splitters, property list, explorer tree                    |
| [`editor.css`](../../src/styles/editor.css)         | Tab strip, view-mode tabs, source header, markdown preview, source textarea, status bar                      |
| [`cards.css`](../../src/styles/cards.css)           | Cards workspace and the crashpad surface                                                                     |
| [`review.css`](../../src/styles/review.css)         | The review session, rating controls, completion state                                                        |
| [`settings.css`](../../src/styles/settings.css)     | The settings modal and its section/callout primitives                                                        |
| [`weaver.css`](../../src/styles/weaver.css)         | The Weaver composer, plan review, progress feed, session history, diff preview, confirm dialog, unified diff |
| [`welcome.css`](../../src/styles/welcome.css)       | The no-vault welcome surface                                                                                 |
| [`responsive.css`](../../src/styles/responsive.css) | Narrow-window collapse rules                                                                                 |

`foundation.css` owns every colour, radius and type-size token. A surface stylesheet uses the
tokens; it does not restate a literal colour. The Weaver stylesheet was written against a
`--weaver-*` variable layer and `foundation.css` supplies it, so the agent surface shares the app
palette without a per-rule rewrite.

## Tokens

| Group    | Tokens                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces | `--bg-app`, `--bg-base`, `--bg-panel`, `--bg-panel-raised`, `--bg-input`, `--bg-card`, `--bg-hover`, `--bg-active`, `--bg-selected` |
| Lines    | `--border-subtle`, `--border-soft`, `--border-strong`, `--border-accent`                                                            |
| Text     | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle`, `--text-faint`                                               |
| Brand    | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-wash`, `--accent-contrast`                                                |
| Semantic | `--success`, `--warning`, `--error`, `--error-strong`, `--info` and their `*-wash` backgrounds                                      |
| Type     | `--font-ui`, `--font-mono`, the `--font-size-*` scale and `--line-height-*`                                                         |
| Geometry | `--radius-*`, `--size-control`                                                                                                      |
| Depth    | `--shadow-*`, `--focus-ring`                                                                                                        |
| Motion   | `--ease`, `--duration`                                                                                                              |

The theme is dark. `color-scheme: dark` is set so native controls follow, and
`prefers-reduced-motion` disables transitions.

The accent is a warm amber (`--accent`) used sparsely: the primary call to action (**Generate**,
**Apply**, **Open a vault**), the active tab underline, the selected tree row and the focus ring.
Destructive and success states use their own semantic colours, never the accent.

## Typography

The UI font is the system stack with Inter first (`--font-ui`); the mono stack starts at JetBrains
Mono (`--font-mono`). The editor's prose size is the user's **Editor font size** setting, passed in
as `--editor-font-size`; everything else uses the fixed token scale. Prose markdown is rendered by
`src/lib/markdownPreview.ts` and styled under `.markdownPreview` and `.cardContentMarkdown`.

## Iconography

`src/components/AppIcon.tsx` is the only icon set. It exports `AppIconName`, a union of every icon
the UI uses, and `AppIcon`, a 24-viewBox stroked SVG that inherits `currentColor` and sizes itself
from `1em`. A parent may override the size with its own `svg { width; height }` rule; several
surfaces do. There are no unicode glyph or emoji icons in the chrome — the empty, success and
failure markers a user sees are `AppIcon` names too. A new icon is added to the union and the
`PATHS` record; an icon-only button carries both `title` and `aria-label`.

## Surfaces and states

- **Title bar** (`AppChrome`): the brand, the open vault's alias, and the right-panel/settings
  controls. It is the only chrome above the layout grid, so no surface has to reserve space for
  floating window controls.
- **Widget rail**: pane toggle, daily crashpad, review. Icon-only with tooltips; disabled while no
  vault is open.
- **Sidebar / inspector**: flat panels separated by `--border-subtle`; the explorer row selection
  is an accent wash with a 2px inline accent bar.
- **Status bar**: the bottom strip of the editor pane. It shows the last status message with a
  success dot or the last error with an error dot; the crashpad editor repeats messages inline.
- **Welcome surface**: shown in the editor pane when no vault is open. The one primary action opens
  a vault; settings is secondary; three lines explain what the app does.
- **Review**: the card sits on a raised card surface with the four rating controls in a 2×2 grid
  under 760px. The controls tint on hover by response, and the response key is a small mono badge.
- **Weaver**: the inspector surface is flat — one accent call to action at the bottom of the
  composer. An operation wraps its title over up to two lines before truncating so the narrow
  panel stays legible; session rows lay out status, kind, time, card, intent and metadata on
  separate grid areas rather than one clipped line.
- **Modals** (settings, diff, confirm): a dimmed and blurred overlay, a `--bg-panel` card with
  `--shadow-lg`, and a header that stays visible while the body scrolls.

Interaction states are consistent: hover lifts a surface to `--bg-hover`, active presses to
`--bg-active`, disabled drops to 42% opacity, and keyboard focus draws `--focus-ring` with
`:focus-visible` so pointer clicks do not leave a ring behind. Transitions run at `--duration` with
`--ease` and are removed under reduced motion.

## Rules for a new surface

1. Add styles to the file that owns the surface, or add a new file and import it from
   `src/styles.css`; do not inline a colour literal in a component.
2. Take colour, radius spacing and type from `foundation.css` tokens.
3. Use `AppIcon` for any icon, with `title` and `aria-label` on an icon-only control.
4. Provide the surface's empty, loading and error states; an empty pane should say what to do next.
5. Verify against the built app (the headless launch harness in the workspace is the current way to
   screenshot a real window), not only in the component test renderer.

An accessibility audit was **not** part of the rework; focus-visible styling and accessible names
on the icon-only controls are in place, but there is no keyboard-navigation or screen-reader
conformance work.
