import { test, expect } from "@playwright/test";
import path from "path";

const UI_ORIGIN = (process.env.E2E_UI_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const AUTH_STATE = path.join(__dirname, ".auth", "user.json");

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

/**
 * Admin CMS e2e — route guard for non-admins + admin dashboard flow.
 * Admin login tests require E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 */

const EMPTY_STATE = { cookies: [], origins: [] };

test.describe("Admin CMS route guard", () => {
  test.use({ storageState: AUTH_STATE });

  test("viewer session is redirected away from /admin", async ({ page }) => {
    await page.goto(`${UI_ORIGIN}/admin`);
    await page.waitForURL("**/admin/403", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/403/);
  });

  test("viewer session sees 403 content", async ({ page }) => {
    await page.goto(`${UI_ORIGIN}/admin/403`);
    await expect(page.locator("body")).toContainText(/Хандах эрхгүй|403|эрх/i, { timeout: 15_000 });
  });
});

test.describe("Admin CMS login (requires E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD)", () => {
  test.use({ storageState: EMPTY_STATE });
  test.skip(!adminEmail || !adminPassword, "Admin credentials not provided — skipping");

  test("unauthenticated visitor is redirected to /admin/login", async ({ page }) => {
    await page.goto(`${UI_ORIGIN}/admin`);
    await page.waitForURL("**/admin/login", { timeout: 15_000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("wrong credentials show an error", async ({ page }) => {
    await page.goto(`${UI_ORIGIN}/admin/login`);
    await page.fill('input[type="email"]', "viewer@test.mn");
    await page.fill('input[type="password"]', "WrongPass123!");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Invalid email or password")).toBeVisible({ timeout: 15_000 });
  });

  test("admin logs in and sees dashboard with summary cards", async ({ page }) => {
    await page.goto(`${UI_ORIGIN}/admin/login`);
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/admin", { timeout: 15_000 });
    await expect(page.locator("h1")).toContainText("Хянах самбар");
    await expect(page.locator("text=Хэрэглэгчид").first()).toBeVisible();
  });

  test("admin navigates to users and api-keys pages", async ({ page }) => {
    await page.goto(`${UI_ORIGIN}/admin/login`);
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin", { timeout: 15_000 });

    await page.goto(`${UI_ORIGIN}/admin/users`);
    await expect(page.locator("h1")).toContainText("Хэрэглэгчид");

    await page.goto(`${UI_ORIGIN}/admin/api-keys`);
    await expect(page.locator("h1")).toContainText("API түлхүүрүүд");
  });
});
