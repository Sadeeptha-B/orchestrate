import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Button } from './Button';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('Orchestrate error boundary caught:', error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    handleResetAndClear = () => {
        try {
            localStorage.removeItem('orchestrate-day-plan');
        } catch { /* ignore */ }
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center p-6">
                    <div className="max-w-md w-full space-y-4 text-center">
                        <h1 className="text-xl font-semibold text-text">Something went wrong</h1>
                        <p className="text-sm text-text-light">
                            {this.state.error?.message ?? 'An unexpected error occurred.'}
                        </p>
                        <div className="flex justify-center gap-3">
                            <Button variant="primary" size="sm" onClick={this.handleReset}>
                                Try Again
                            </Button>
                            <Button variant="ghost" size="sm" onClick={this.handleResetAndClear}>
                                Reset Day &amp; Reload
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
