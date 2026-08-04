import { test, expect } from "@playwright/test";
import path from "path";

/**
 * End-to-end chat flow. Requires real LLM calls (cost + latency),
 * so it is SKIPPED unless RUN_LLM_E2E=1 is set.
 */
const AUTH_STATE = path.join(__dirname, ".auth", "user.json");

test.use({ storageState: AUTH_STATE });

const QUESTION = "Танд ямар аналитик чадварууд байдаг вэ?";

test("user can send a question and receive an assistant answer", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_LLM_E2E !== "1", "RUN_LLM_E2E=1 not set — skipped (real LLM calls)");

  await page.goto("/");
  const chatInput = page.getByLabel("Асуулт бичих");
  await expect(chatInput).toBeVisible({ timeout: 15_000 });

  const response = page.waitForResponse(
    (resp) => resp.url().includes("/api/chat") && resp.status() === 200,
    { timeout: 90_000 }
  );

  await chatInput.fill(QUESTION);
  await chatInput.press("Enter");

  await response;

  // User bubble with the exact question text
  await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });

  // Assistant answer bubble (non-empty text after streaming finishes)
  const assistantBubble = page.locator("div.border-l.border-border.pl-4");
  await expect(assistantBubble.first()).toBeVisible({ timeout: 60_000 });
  await expect(assistantBubble.first().getByText(/.+/)).not.toBeEmpty({ timeout: 60_000 });

  testInfo.attach("chat-response", {
    body: (await assistantBubble.first().innerText()).slice(0, 2000),
    contentType: "text/plain",
  });
});