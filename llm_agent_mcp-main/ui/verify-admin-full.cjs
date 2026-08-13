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
  for (const [name, path, checks, action] of [
    ["users", "/admin/users", ["Хэрэглэгч нэмэх"], null],
    ["api-keys", "/admin/api-keys", ["Сүүлийн хэрэглээ"], null],
    ["knowledge-base", "/admin/knowledge-base", ["Шинэ мэдээлэл хуулах", "Мэдлэгийн сан"], null],
    ["observability", "/admin/observability", ["Хүлээгдэж буй санал хүсэлт", "Түлхүүр үгээр шүүх", "Зөвшөөрөх", "Reject"], null],
    ["data-quality", "/admin/data-quality", ["Өгөгдлийн чанар", "Custom тестүүд", "Шинэ тест"], null],
    ["alerts", "/admin/alerts", ["Сануулга", "Одоогоор сануулга байхгүй"], null],
  ]) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3500);
    const body = await page.textContent("body");
    const missing = checks.filter((c) => !body.includes(c));
    if (name === "observability") {
      const searchInput = await page.locator('input[placeholder="Түлхүүр үгээр шүүх"]').count();
      if (searchInput === 0 && !missing.includes("Түлхүүр үгээр шүүх")) {
        missing.push("Түлхүүр үгээр шүүх (input placeholder)");
      } else {
        const i = missing.indexOf("Түлхүүр үгээр шүүх");
        if (i >= 0) missing.splice(i, 1);
      }
    }
    results.push({ name, ok: missing.length === 0, missing, url: page.url() });
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
