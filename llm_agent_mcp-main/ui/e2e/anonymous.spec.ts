import { test, expect, type APIRequestContext } from "@playwright/test";

const API_BASE = (process.env.E2E_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");

async function apiContext(): Promise<APIRequestContext> {
  return (await import("@playwright/test")).request.newContext({ baseURL: API_BASE });
}

test.describe("guest access controls", () => {
  test("health/status endpoints are public (200 without token)", async () => {
    const api = await apiContext();
    const res = await api.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    await api.dispose();
  });

  test("protected endpoints reject unauthenticated calls (401)", async () => {
    const api = await apiContext();
    for (const url of ["/api/chat", "/api/admin/feedback/pending", "/api/conversations", "/api/search?q=test"]) {
      const res = await api.get(url, { data: url === "/api/chat" ? { message: "ping" } : undefined });
      expect(res.status(), url).toBe(401);
    }
    await api.dispose();
  });

  test("login page shows credentials form", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeVisible();
  });

  test("wrong credentials show an error message", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="email"]').fill(`nouser_${Date.now()}@test.mn`);
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('[role="alert"], .text-red-500, .text-red-600, p.text-red-500')).toBeVisible({
      timeout: 10_000,
    });
  });
});