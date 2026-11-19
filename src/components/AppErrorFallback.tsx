import { useCallback } from 'react';
import { AppIcon } from './AppIcon';

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
        alignItems: 'flex-start',
        justifyContent: 'center',
        height: '100vh',
        padding: '2.5rem',
        fontFamily: 'var(--font-ui, system-ui, sans-serif)',
        backgroundColor: 'var(--bg-app, #0b0c0e)',
        color: 'var(--text-primary, #ececee)',
        gap: '0.85rem',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '2.4rem',
          height: '2.4rem',
          borderRadius: '8px',
          backgroundColor: 'var(--error-wash, rgba(224, 122, 114, 0.1))',
          color: 'var(--error-strong, #f2928a)',
          fontSize: '1.2rem',
        }}
      >
        <AppIcon name="alert-triangle" />
      </span>

      <h1 style={{ fontSize: '1.35rem', fontWeight: 600, margin: 0 }}>
        Something went wrong in CrashWeaver
      </h1>

      <p
        style={{
          maxWidth: '46rem',
          color: 'var(--text-muted, #8d9199)',
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        An unexpected render error occurred. Your vault files have not been modified. You can try
        reloading the window — if the error persists, please copy the diagnostic details and report
        them.
      </p>

      <div
        style={{
          maxWidth: '46rem',
          width: '100%',
          padding: '0.9rem 1rem',
          backgroundColor: 'var(--bg-panel, #121417)',
          borderRadius: '8px',
          border: '1px solid var(--border-soft, #24272d)',
          color: 'var(--error-strong, #f2928a)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '12rem',
          overflowY: 'auto',
        }}
      >
        {error.message}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
        <button
          type="button"
          className="actionButton primary"
          onClick={onReset}
          style={{ minHeight: '2rem', padding: '0.4rem 1rem' }}
        >
          Reload
        </button>
        <button
          type="button"
          className="actionButton"
          onClick={handleCopy}
          style={{ minHeight: '2rem', padding: '0.4rem 1rem' }}
        >
          Copy details
        </button>
      </div>
    </main>
  );
}
