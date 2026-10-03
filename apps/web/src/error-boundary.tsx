import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  // Compact fallback used inside a panel; omit for the full-page fallback.
  inline?: boolean;
  title?: string;
  message?: string;
};

type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { inline, title, message } = this.props;
    // A reload also refreshes stale asset hashes after a new deployment.
    const reload = () => window.location.reload();

    return (
      <div className={`state-panel state-panel--error${inline ? ' state-panel--inline' : ''}`} role="alert">
        <strong>{title ?? 'Đã xảy ra lỗi hiển thị'}</strong>
        <span>{message ?? 'Không thể hiển thị nội dung này. Vui lòng thử lại.'}</span>
        <div className="state-panel__actions">
          <button className="button-secondary" type="button" onClick={reload}>Thử lại</button>
          {!inline && <button className="button-secondary" type="button" onClick={() => window.history.back()}>Quay lại</button>}
        </div>
      </div>
    );
  }
}
