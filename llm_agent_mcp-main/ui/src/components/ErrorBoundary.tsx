"use client";

import React from "react";
import { AlertTriangle, RefreshCw, RotateCcw, Home } from "lucide-react";

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /(?:loading|failed to load) (?:css )?chunk/i.test(error.message) ||
    /Failed to fetch dynamically imported module/i.test(error.message)
  );
}

function getSubTitle(isChunkError: boolean, isOnline: boolean): string {
  if (!isChunkError) return "Уучлаарай, энэ хуудсанд алдаа гарлаа.";
  return isOnline
    ? "Хуудасны нөөцүүд ачаалагдахгүй байна. Дахин ачааллаад оролдоно уу."
    : "Таны интернет холболт тасарсан байна. Холболтоо шалгаад дахин ачааллана уу.";
}

function getTitle(isChunkError: boolean): string {
  return isChunkError ? "Хуудас ачаалагдсангүй" : "Алдаа гарлаа";
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isOnline: boolean;
  retryCount: number;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    retryCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidMount() {
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  componentWillUnmount() {
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
  }

  handleOnline = () => {
    this.setState({ isOnline: true });
    if (
      this.state.hasError &&
      this.state.error &&
      isChunkLoadError(this.state.error)
    ) {
      window.location.reload();
    }
  };

  handleOffline = () => {
    this.setState({ isOnline: false });
  };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError || !this.state.error) {
      return (
        <React.Fragment key={this.state.retryCount}>
          {this.props.children}
        </React.Fragment>
      );
    }

    const { error, isOnline } = this.state;
    const isChunkError = isChunkLoadError(error);

    return (
      <div className="flex items-center justify-center min-h-[300px] p-6">
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-red-50 dark:bg-red-900/20">
              <AlertTriangle className="w-12 h-12 text-red-500" />
            </div>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {getTitle(isChunkError)}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {getSubTitle(isChunkError, isOnline)}
          </p>
          <div className="flex justify-center gap-3">
            {isChunkError && (
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Дахин оролдох
              </button>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Хуудсыг дахин ачаалах
            </button>
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <Home className="w-4 h-4" />
              Нүүр хуудас
            </a>
          </div>
        </div>
      </div>
    );
  }
}
