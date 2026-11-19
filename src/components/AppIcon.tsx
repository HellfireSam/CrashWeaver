/**
 * AppIcon — the application's one icon set.
 *
 * Every glyph the UI used to draw as a unicode character is an SVG here, so the
 * chrome, tree, tabs, reviews and Weaver share one optical weight and one size
 * contract. Icons inherit `currentColor` and size themselves from `1em` by
 * default; a parent may override with its own `svg` width/height rule.
 */
import type { ReactNode, SVGProps } from 'react';

export type AppIconName =
  | 'panel-left'
  | 'panel-right'
  | 'settings'
  | 'layers'
  | 'repeat'
  | 'chevron-right'
  | 'chevron-down'
  | 'file-text'
  | 'folder'
  | 'folder-open'
  | 'plus'
  | 'minus'
  | 'x'
  | 'check'
  | 'check-circle'
  | 'alert-triangle'
  | 'alert-circle'
  | 'info'
  | 'undo'
  | 'redo'
  | 'save'
  | 'trash'
  | 'search'
  | 'sparkles'
  | 'wrench'
  | 'clipboard-check'
  | 'flag'
  | 'arrow-right'
  | 'arrow-left'
  | 'book'
  | 'keyboard'
  | 'send'
  | 'loader';

type AppIconProps = {
  name: AppIconName;
  className?: string;
  size?: number | string;
} & Omit<SVGProps<SVGSVGElement>, 'name' | 'width' | 'height'>;

const PATHS: Record<AppIconName, ReactNode> = {
  'panel-left': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M3.5 8h1.9" />
      <path d="M10.6 8h9.9" />
      <circle cx="16" cy="16" r="2.6" />
      <path d="M3.5 16h9.9" />
      <path d="M18.6 16h1.9" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  repeat: (
    <>
      <path d="M20 11a8 8 0 0 0-14.2-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.2 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'file-text': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.7l1.9 2.2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19.2H6a2.5 2.5 0 0 1-2.5-2.5v-9.2Z" />
  ),
  'folder-open': (
    <>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.7l1.9 2.2H18a2.5 2.5 0 0 1 2.5 2.5V11" />
      <path d="M3.5 11h17.2a1 1 0 0 1 .97 1.24l-1.6 5.6a2.5 2.5 0 0 1-2.4 1.86H6.1a2.5 2.5 0 0 1-2.45-1.97L2.5 12.3" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  x: (
    <>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </>
  ),
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.4 12.2 2.4 2.4 4.8-5" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M10.3 4.6 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  save: (
    <>
      <path d="M5 4.5h11L19.5 8v11.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
      <path d="M8 4.5V9h7V4.5" />
      <rect x="7.5" y="13" width="9" height="7.5" rx="0.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V4.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.7" />
      <path d="M6 6.5 6.8 19a1.5 1.5 0 0 0 1.5 1.4h7.4a1.5 1.5 0 0 0 1.5-1.4L18 6.5" />
      <path d="M10.5 10.5v6" />
      <path d="M13.5 10.5v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.9 8l4.6 1.9-4.6 1.9L12 16.5l-1.9-4.7L5.5 9.9 10.1 8 12 3.5Z" />
      <path d="M18 15.5 18.8 17.2 20.5 18 18.8 18.8 18 20.5 17.2 18.8 15.5 18 17.2 17.2 18 15.5Z" />
    </>
  ),
  wrench: (
    <path d="M15.4 3.6a5.5 5.5 0 0 0-5.1 8.2l-6.6 6.6a1.6 1.6 0 0 0 0 2.2l.5.5a1.6 1.6 0 0 0 2.2 0l6.6-6.6a5.5 5.5 0 0 0 8.2-5.1l-3.2 3.2-2.6-.7-.7-2.6 3.2-3.2a5.5 5.5 0 0 0-2.5-2.5Z" />
  ),
  'clipboard-check': (
    <>
      <rect x="6" y="5" width="12" height="15.5" rx="2" />
      <path d="M9 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" />
      <path d="m9.2 13.4 2 2 3.6-3.8" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4.5" />
      <path d="M5 4.5c4-2.3 6.5 2.3 10.5 0v8c-4 2.3-6.5-2.3-10.5 0" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M4.5 12h14" />
      <path d="m13 6.5 5.5 5.5-5.5 5.5" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19.5 12h-14" />
      <path d="M11 6.5 5.5 12l5.5 5.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4v-13Z" />
      <path d="M20 4.5h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20v-13Z" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13.5h.01M18 13.5h.01" />
      <path d="M9.5 16.5h5" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 3.7 10.2a.6.6 0 0 0 0 1.1l6.4 2.6 2.6 6.4a.6.6 0 0 0 1.1 0l6.7-16.8Z" />
      <path d="M20.5 3.5 10.1 13.9" />
    </>
  ),
  loader: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
      <path d="M20.5 12h-3" />
    </>
  ),
};

export function AppIcon({ name, className, size, ...rest }: AppIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size ?? '1em'}
      height={size ?? '1em'}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
