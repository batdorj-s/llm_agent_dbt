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

test.describe("RBAC enforcement", () => {
  test("viewer is forbidden from admin endpoints (403)", async ({ request }) => {
    const token = readAuthToken();
    for (const url of ["/api/admin/feedback/pending", "/api/admin/files"]) {
      const res = await request.get(`${API_BASE}${url}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status(), url).toBe(403);
    }
  });

  test("viewer can call regular endpoints (200)", async ({ request }) => {
    const token = readAuthToken();
    const res = await request.get(`${API_BASE}/api/kpi/sales`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe("admin access (requires E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD)", () => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!adminEmail || !adminPassword, "Admin credentials not provided — skipping");

  test("admin can access admin endpoints (200)", async ({ request }) => {
    const login = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: adminEmail, password: adminPassword },
    });
    expect(login.status()).toBe(200);
    const { token } = await login.json();

    const res = await request.get(`${API_BASE}/api/admin/feedback/pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });
});