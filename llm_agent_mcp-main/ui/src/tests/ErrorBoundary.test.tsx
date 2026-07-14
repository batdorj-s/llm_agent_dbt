import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "@/components/ErrorBoundary";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ThrowError: React.FC<{ message?: string }> = ({
  message = "Test error",
}) => {
  throw new Error(message);
};

const SafeChild: React.FC<{ text?: string }> = ({
  text = "Safe content",
}) => <div>{text}</div>;

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <SafeChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Safe content")).toBeInTheDocument();
  });

  it("renders error fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText("Sorry, an error occurred on this page."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reload Page")).toBeInTheDocument();
    expect(screen.getByText("Back Home")).toBeInTheDocument();
  });

  it("shows Retry button and ChunkLoadError title for dynamic import failures", () => {
    render(
      <ErrorBoundary>
        <ThrowError message="Failed to fetch dynamically imported module" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Failed to load page")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("Retry resets error state allowing children to render again", () => {
    // Render with chunk error first
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowError message="Failed to fetch dynamically imported module" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Failed to load page")).toBeInTheDocument();

    // Rerender with safe child, then click Retry
    rerender(
      <ErrorBoundary>
        <SafeChild text="After recovery" />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByText("After recovery")).toBeInTheDocument();
  });

  it("has a Home link pointing to /", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );
    const homeLink = screen.getByText("Back Home").closest("a");
    expect(homeLink).toHaveAttribute("href", "/");
  });

  it("shows offline-specific message when navigator is offline and chunk error occurs", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    render(
      <ErrorBoundary>
        <ThrowError message="Failed to fetch dynamically imported module" />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText(
        /Your network connection has been lost/,
      ),
    ).toBeInTheDocument();
  });
});
