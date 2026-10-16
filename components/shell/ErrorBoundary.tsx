import { Component, type ErrorInfo, type ReactNode } from 'react';
import { PageErrorFallback } from '../../pages/system/SystemPages';

interface Props {
  children: ReactNode;
  /** Custom fallback renderer. */
  fallback?: (reference: string, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  reference: string;
}

function referenceFor(error: unknown): string {
  const requestId = (error as { requestId?: unknown } | null)?.requestId;
  if (typeof requestId === 'string' && requestId) return requestId;
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `UI-${Date.now().toString(36).toUpperCase()}-${rnd}`;
}

/**
 * Catches render errors inside the page area so the shell stays usable (SH-07#AC1). Mount it with a `key`
 * that changes on navigation so moving to another page clears the error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reference: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, reference: referenceFor(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // PL-17 (Sentry) would report here; until then keep a console trace with the reference.
    console.error(`[PMO Capacity Planner] page error ${this.state.reference || ''}`, error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null, reference: '' });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.reference, this.reset);
      return <PageErrorFallback reference={this.state.reference} onReload={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
