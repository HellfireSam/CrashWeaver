import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppErrorFallback } from './AppErrorFallback';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback. Defaults to AppErrorFallback. */
  fallback?: (error: Error, onReset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React Error Boundary for the CrashWeaver renderer.
 *
 * Catches unhandled errors during rendering, in lifecycle methods, and in
 * constructors of the child tree.  Prevents the "white screen of death" and
 * gives the user a recoverable fallback UI.
 *
 * Does NOT catch errors in:
 *  - Event handlers (use try/catch or .catch() there)
 *  - Async code (same)
 *  - Errors thrown inside the ErrorBoundary itself
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[CrashWeaver] Unhandled render error caught by ErrorBoundary.\n',
      `Error: ${error.message}\n`,
      `Component stack:\n${info.componentStack ?? '(not available)'}`,
    );

    // Future: wire to a crash reporter / telemetry endpoint here.
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      return (
        <AppErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
