import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineBanner } from "@/components/OfflineBanner";

describe("OfflineBanner", () => {
  it("renders nothing when online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders offline message when offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineBanner />);
    expect(
      screen.getByText(/Та интернетэд холбогдоогүй байна/),
    ).toBeInTheDocument();
  });
});
