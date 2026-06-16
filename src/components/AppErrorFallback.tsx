import { useCallback } from 'react';

interface AppErrorFallbackProps {
  error: Error;
  /** Resets the error boundary and re-renders children. */
  onReset: () => void;
}

/**
 * Fallback UI rendered when an unhandled render error crashes a boundary.
 *
 * Provides:
 *  - A human-readable error summary.
 *  - A "Reload" button that resets the boundary and re-mounts the tree.
 *  - A "Copy details" button so the user can share diagnostics.
 */
export function AppErrorFallback({ error, onReset }: AppErrorFallbackProps) {
  const handleCopy = useCallback(() => {
    const detail = [
      `Error: ${error.message}`,
      `Stack: ${error.stack ?? 'No stack trace available.'}`,
    ].join('\n\n');

    navigator.clipboard.writeText(detail).catch(() => {
      // Clipboard unavailable — silently ignore.
    });
  }, [error]);

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: 'var(--cw-bg, #1e1e1e)',
        color: 'var(--cw-fg, #cccccc)',
        gap: '1rem',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', margin: 0 }}>
        Something went wrong in CrashWeaver
      </h1>

      <p
        style={{
          maxWidth: '42rem',
          textAlign: 'center',
          color: 'var(--cw-muted, #888)',
          lineHeight: 1.5,
        }}
      >
        An unexpected render error occurred. Your vault files have not been
        modified. You can try reloading the window — if the error persists,
        please copy the diagnostic details and report them.
      </p>

      <div
        style={{
          maxWidth: '42rem',
          width: '100%',
          padding: '1rem',
          backgroundColor: 'var(--cw-surface, #2d2d2d)',
          borderRadius: '6px',
          border: '1px solid var(--cw-border, #444)',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '12rem',
          overflowY: 'auto',
        }}
      >
        {error.message}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: '0.5rem 1.25rem',
            backgroundColor: 'var(--cw-accent, #007acc)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Reload
        </button>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: '0.5rem 1.25rem',
            backgroundColor: 'var(--cw-surface, #2d2d2d)',
            color: 'var(--cw-fg, #ccc)',
            border: '1px solid var(--cw-border, #444)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Copy details
        </button>
      </div>
    </main>
  );
}
