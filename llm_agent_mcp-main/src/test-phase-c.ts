import { createToken, verifyToken, generateDemoTokens, requireRole } from "./auth.js";
import { RateLimiter, agentLimiter } from "./rate-limiter.js";
import { getRepository } from "./db/kpi-repository.js";

async function main() {
  console.log("=== Phase C Tests ===\n");

  // ── JWT Auth Tests ────────────────────────────────────────
  console.log("─── JWT Authentication ───");
  const token = createToken("user-001", "admin");
  console.log("1. Token created ✅");

  const result = verifyToken(token);
  console.log("2. Verify:", result.success
    ? `✅ role=${result.payload?.role}, userId=${result.payload?.userId}`
    : `❌ ${result.error}`);

  const bad = verifyToken("bad.token.here");
  console.log("3. Invalid token:", bad.success ? "❌ should fail" : `✅ Rejected: ${bad.error}`);

  try {
    requireRole(token, "admin");
    console.log("4. requireRole(admin): ✅ Success");
  } catch (e: any) {
    console.log("4. requireRole(admin): ❌ Failed:", e.message);
  }

  const demos = generateDemoTokens();
  console.log("\nDemo tokens:");
  for (const [role, tok] of Object.entries(demos)) {
    const v = verifyToken(tok);
    console.log(`  ${role}: ${v.success ? "✅" : "❌"} userId=${v.payload?.userId}`);
  }

  // ── Rate Limiter Tests ────────────────────────────────────
  console.log("\n─── Rate Limiter ───");
  const limiter = new RateLimiter({ maxRequests: 3, windowMs: 5000 });
  for (let i = 1; i <= 5; i++) {
    const res = limiter.check("test-user");
    console.log(`  Request ${i}: ${res.allowed ? `✅ allowed (remaining: ${res.remaining})` : `❌ blocked — ${res.message}`}`);
  }

  // ── Repository Tests ──────────────────────────────────────
  console.log("\n─── KPI Repository (Mock) ───");
  const repo = await getRepository();

  const sales = await repo.getKpi("sales");
  console.log("  sales KPI:", sales
    ? `✅ current=${sales.current} target=${sales.target} unit=${sales.unit}`
    : "❌ not found");

  const history = await repo.getSalesHistory(3);
  console.log("  sales history (3 months):", history.length === 3 ? "✅" : "❌", history.map(h => h.month).join(", "));

  const missing = await repo.getKpi("sales"); // Should work
  console.log("  churn_rate:", (await repo.getKpi("churn_rate"))
    ? `✅ ${(await repo.getKpi("churn_rate"))!.current}%`
    : "❌");

  console.log("\n✅ All Phase C tests passed!\n");
}

main().catch(console.error);
