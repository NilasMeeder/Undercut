import { Component, type ReactNode } from 'react';

type Props = {
  /** What to show instead, given the error and a way to try again. */
  fallback: (error: Error, retry: () => void) => ReactNode;
  children: ReactNode;
};

/** Catches a render error below it, so one broken panel (odd data, a bad shared layout) does not
 * take the whole app down with it. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    return error ? this.props.fallback(error, this.retry) : this.props.children;
  }
}

/** The app failed outside a panel. A broken dashboard is saved, so it would fail again after a
 * reload: offer to start the dashboards over. */
export function Crashed({ error }: { error: Error }) {
  const reset = () => {
    try {
      localStorage.removeItem('f1dash-dashboards');
    } catch {
      // Storage blocked: the reload alone has to do.
    }
    location.reload();
  };
  return (
    <div className="p-4 text-[12px]">
      <p>f1dash failed: {error.message}</p>
      <p className="mt-2 flex gap-3">
        <button className="underline" onClick={() => location.reload()}>
          Reload
        </button>
        <button className="underline" onClick={reset}>
          Reset the dashboards and reload
        </button>
      </p>
    </div>
  );
}
