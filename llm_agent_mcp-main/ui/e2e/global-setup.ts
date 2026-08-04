import { request } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * Registers one fresh viewer user (if not already present) and persists
 * Playwright storageState so tests run authenticated without re-login.
 *
 * Registration is rate-limited to 3/hour/IP — this global setup performs
 * at most one registration per run.
 */
const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:3001";
const UI_ORIGIN = process.env.E2E_UI_ORIGIN ?? "http://localhost:3000";
const STATE_DIR = path.join(__dirname, ".auth");
const STATE_PATH = path.join(STATE_DIR, "user.json");

export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: API_BASE });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const email = `e2e_${today}@test.mn`;
  const password = "E2Epass123!";

  // Reuse an existing user for the day if possible — registration is rate-limited (3/hour/IP).
  const loginRes = await api.post("/api/auth/login", { data: { email, password } });
  let token: string;
  let user: { id: string; name: string; email: string; role: string };

  if (loginRes.ok()) {
    const body = await loginRes.json();
    token = body.token;
    user = body.user;
  } else {
    const registerRes = await api.post("/api/auth/register", {
      data: { email, password, name: "E2E User" },
    });
    const body = await registerRes.json();
    if (!registerRes.ok()) {
      throw new Error(`E2E user registration failed (${registerRes.status()}): ${JSON.stringify(body)}`);
    }
    token = body.token;
    user = body.user;
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: UI_ORIGIN,
        localStorage: [
          {
            name: "shinjech_auth",
            value: JSON.stringify({ token, user }),
          },
        ],
      },
    ],
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(storageState, null, 2));
  await api.dispose();
}
