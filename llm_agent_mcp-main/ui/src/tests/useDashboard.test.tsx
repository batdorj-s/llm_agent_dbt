import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../hooks/useAuth";
import { useDashboard } from "../hooks/useDashboard";
import type { ReactNode } from "react";

const mockLogout = vi.fn();

vi.mock("../hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useAuth")>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      token: "test-token",
      user: { id: "u1", name: "T", email: "t@t", role: "viewer" },
      isLoggedIn: true,
      threadId: "t",
      setThreadId: vi.fn(),
      isAuthLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: mockLogout,
    })),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useDashboard", () => {
  beforeEach(() => {
    mockLogout.mockClear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls logout when an API call returns 401", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
    });

    renderHook(() => useDashboard("all", vi.fn()), { wrapper });

    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
  });

  it("does not call logout on non-401 errors", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
    });

    renderHook(() => useDashboard("all", vi.fn()), { wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(mockLogout).not.toHaveBeenCalled();
  });
});