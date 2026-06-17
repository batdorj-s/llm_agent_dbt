/**
 * test-gemini.ts — Gemini Flash ашиглан агентийг тест хийх
 *
 * Ажиллуулахаасаа өмнө .env файлд GOOGLE_API_KEY тавина уу:
 *   GOOGLE_API_KEY=AIzaSy...
 *
 * Ажиллуулах:
 *   npm run test:gemini
 */

import { setupKnowledgeBase } from "./rag.js";
import { printProviderStatus, detectProvider } from "./llm-provider.js";
import { runAgent } from "./agent.js";
import { runMultiAgent } from "./multi-agent.js";

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║       Gemini Flash — Enterprise AI Agent Test        ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Provider статус харах
  printProviderStatus();

  const provider = detectProvider();
  if (provider.provider === "none") {
    console.error("❌ API key олдсонгүй!");
    console.error("   .env файлд GOOGLE_API_KEY тавина уу:");
    console.error("   GOOGLE_API_KEY=AIzaSy...\n");
    console.error("   Key авах: https://aistudio.google.com/app/apikey\n");
    process.exit(1);
  }

  console.log(`✅ Provider: ${provider.provider.toUpperCase()} — ${provider.model}`);
  console.log(`   Хязгаар: ${provider.rateLimit} | Үнэгүй: ${provider.isFree ? "тийм 🆓" : "үгүй 💳"}\n`);

  // Knowledge Base тохируулах
  await setupKnowledgeBase();

  // ── Test 1: Энгийн RAG + LLM query ───────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 1: RAG + Gemini Flash (Phase 2 Agent)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  await runAgent("What is the definition and current target of Sales?");

  // ── Test 2: Multi-Agent routing with LLM ─────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 2: Finance Agent — LLM Routing (admin user)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  await runMultiAgent("What are our sales targets and how are we performing?", "admin", "gemini-test-1");

  // ── Test 3: Intelligent routing test ─────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 3: Tech Agent — Routing with ambiguous query");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  await runMultiAgent("Can you help me analyze and visualize our revenue numbers?", "admin", "gemini-test-2");

  // ── Test 4: Finance Agent test ──────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 4: Finance Agent — RAG context query");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  await runMultiAgent("Show me the financial targets", "admin", "gemini-test-3");

  // ── Test 5: Self-Healing Data Lake Agent execution ───────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 5: Self-Healing Data Lake & E2B execution");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  await runMultiAgent("superstore_sales хүснэгтээс 2015 оны сар сарын борлуулалтын өөрчлөлтийн тайлан гаргаж өгнө үү.", "admin", "gemini-test-4");

  console.log("\n✅ Бүх тест дууслаа!\n");
}

main().catch((err) => {
  console.error("❌ Алдаа:", err.message);
  process.exit(1);
});
