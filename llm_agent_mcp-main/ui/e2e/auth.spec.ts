import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const API_BASE = (process.env.E2E_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const AUTH_STATE = path.join(__dirname, ".auth", "user.json");

function readAuthToken(): string {
  const state = JSON.parse(fs.readFileSync(AUTH_STATE, "utf8"));
  const entry = state.origins[0].localStorage.find((item: { name: string }) => item.name === "shinjech_auth");
  if (!entry) throw new Error("shinjech_auth not found in storage state");
  return JSON.parse(entry.value).token;
}

test.use({ storageState: AUTH_STATE });

test.describe("authenticated viewer", () => {
  test("chat UI renders after login (token from storage)", async ({ page }) => {
    await page.goto("/");
    const chatInput = page.getByLabel("Асуулт бичих");
    await expect(chatInput).toBeVisible({ timeout: 15_000 });
    await expect(chatInput).toBeEnabled();
  });

  test("JWT from storage is accepted by /api/auth/me", async ({ request }) => {
    const token = readAuthToken();
    const res = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user.role).toBe("viewer");
  });

  test("conversation list is accessible", async ({ request }) => {
    const token = readAuthToken();
    const res = await request.get(`${API_BASE}/api/conversations?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});