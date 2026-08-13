/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  await page.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle" });
  await page.locator("input").nth(0).fill(adminEmail);
  await page.locator("input").nth(1).fill(adminPassword);
  await page.locator("button[type=submit]").click();
  await page.waitForURL("http://localhost:3000/admin", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const results = [];
  for (const [name, path, checks] of [
    ["users", "/admin/users", ["Хэрэглэгч нэмэх"]],
    ["observability", "/admin/observability", ["Зөвшөөрөх", "Reject", "Хүлээгдэж буй санал хүсэлт"]],
    ["api-keys", "/admin/api-keys", ["Сүүлийн хэрэглээ"]],
  ]) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3500);
    const body = await page.textContent("body");
    const missing = checks.filter((c) => !body.includes(c));
    results.push({ name, ok: missing.length === 0, missing });
  }

  await page.screenshot({ path: "/tmp/admin-users.png" });
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
