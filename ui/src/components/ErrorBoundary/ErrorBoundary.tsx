import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

// Stops a render error in one area (e.g. the viewer) from blanking the whole UI.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error('[dojo] UI error:', error); }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--hostile)', fontFamily: 'var(--font)' }}>
          <h3>Something broke in this view.</h3>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--muted)', marginTop: 8 }}>{String(this.state.error.message || this.state.error)}</pre>
          <button onClick={this.reset} style={{ marginTop: 12, background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 3, padding: '4px 12px' }}>Dismiss</button>
        </div>
      );
    }
    return this.props.children;
  }
}
