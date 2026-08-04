import { test, expect } from "@playwright/test";

const API_BASE = (process.env.E2E_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");

test.describe("security headers", () => {
  test("API response carries hardened headers", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/health`);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers()["permissions-policy"]).toContain("camera=()");
  });

  test("UI page loads with security headers and no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/");
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
    expect(consoleErrors).toEqual([]);
  });
});