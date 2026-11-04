import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("app crashed", error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="grid min-h-screen place-items-center px-6 text-center">
                <div className="space-y-4">
                    <div className="text-base font-medium">页面出现异常，请刷新后重试。</div>
                    <button type="button" className="h-10 bg-stone-950 px-6 text-sm text-white dark:bg-stone-100 dark:text-stone-950" onClick={() => window.location.reload()}>
                        刷新页面
                    </button>
                </div>
            </div>
        );
    }
}
