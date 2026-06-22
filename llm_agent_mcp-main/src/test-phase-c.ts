import { createToken, verifyToken, requireRole } from "./auth.js";
import { RateLimiter, agentLimiter } from "./rate-limiter.js";
import { getRepository } from "./db/kpi-repository.js";

async function main() {
  console.log("=== Phase C Tests ===\n");

  // ── JWT Auth Tests ────────────────────────────────────────
  console.log("─── JWT Authentication ───");
  const token = createToken("user-001", "admin");
  console.log("1. Token created [OK]");

  const result = verifyToken(token);
  console.log("2. Verify:", result.success
    ? `[OK] role=${result.payload?.role}, userId=${result.payload?.userId}`
    : `[FAIL] ${result.error}`);

  const bad = verifyToken("bad.token.here");
  console.log("3. Invalid token:", bad.success ? "[FAIL] should fail" : `[OK] Rejected: ${bad.error}`);

  try {
    requireRole(token, "admin");
    console.log("4. requireRole(admin): [OK] Success");
  } catch (e: any) {
    console.log("4. requireRole(admin): [FAIL] Failed:", e.message);
  }

  const adminTok = createToken("user-admin-001", "admin");
  const v = verifyToken(adminTok);
  console.log(`  admin: ${v.success ? "[OK]" : "[FAIL]"} userId=${v.payload?.userId}`);

  // ── Rate Limiter Tests ────────────────────────────────────
  console.log("\n─── Rate Limiter ───");
  const limiter = new RateLimiter({ maxRequests: 3, windowMs: 5000 });
  for (let i = 1; i <= 5; i++) {
    const res = limiter.check("test-user");
    console.log(`  Request ${i}: ${res.allowed ? `[OK] allowed (remaining: ${res.remaining})` : `[FAIL] blocked — ${res.message}`}`);
  }

  // ── Repository Tests ──────────────────────────────────────
  console.log("\n─── KPI Repository (Mock) ───");
  const repo = await getRepository();

  const sales = await repo.getKpi("sales");
  console.log("  sales KPI:", sales
    ? `[OK] current=${sales.current} target=${sales.target} unit=${sales.unit}`
    : "[FAIL] not found");

  const history = await repo.getSalesHistory(3);
  console.log("  sales history (3 months):", history.length === 3 ? "[OK]" : "[FAIL]", history.map(h => h.month).join(", "));

  const missing = await repo.getKpi("sales"); // Should work
  console.log("  churn_rate:", (await repo.getKpi("churn_rate"))
    ? `[OK] ${(await repo.getKpi("churn_rate"))!.current}%`
    : "[FAIL]");

  console.log("\n[OK] All Phase C tests passed!\n");
}

main().catch(console.error);
