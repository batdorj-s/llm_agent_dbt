/**
 * test-semantic-quality.ts — End-to-end semantic search quality test
 *
 * Loads the full knowledge base, runs 20 real queries, and reports
 * which documents are found — verifying BM25 + hybrid search accuracy.
 *
 * Usage: npx tsx src/test-semantic-quality.ts
 */

import { setupKnowledgeBase, searchKnowledgeBase, searchKnowledgeBaseWithFilter, knowledgeDocuments } from "./rag.js";
import { buildBM25Index, bm25Search, hybridSearch, getSemanticSearchStatus, type BM25Index } from "./rag/semantic-search.js";

interface TestCase {
  query: string;
  expectedDocIds: string[];
  expectedKeywords: string[];   // at least one should appear in top results
  category?: string;
  description: string;
}

const TEST_CASES: TestCase[] = [
  // ── Exact keyword match ──────────────────────────────────────
  {
    query: "sales",
    expectedDocIds: ["doc1"],
    expectedKeywords: ["sales", "revenue", "target"],
    category: "finance",
    description: "Exact English keyword → sales definition doc",
  },
  {
    query: "revenue",
    expectedDocIds: ["doc1", "glossary_revenue"],
    expectedKeywords: ["revenue", "sales", "income"],
    description: "English keyword → revenue/sales glossary",
  },
  {
    query: "churn rate",
    expectedDocIds: ["doc2", "glossary_churn"],
    expectedKeywords: ["churn", "retention", "users"],
    description: "Exact term → churn definition",
  },

  // ── Mongolian exact match ────────────────────────────────────
  {
    query: "борлуулалт",
    expectedDocIds: ["doc1", "finance-glossary-5"],
    expectedKeywords: ["борлуулалт", "sales", "revenue"],
    category: "finance",
    description: "Mongolian keyword → sales/revenue docs",
  },
  {
    query: "зардал",
    expectedDocIds: ["finance-glossary-4"],
    expectedKeywords: ["зардал", "зарлага", "cost", "expense"],
    category: "finance",
    description: "Mongolian keyword → cost definition",
  },
  {
    query: "цэвэр ашиг",
    expectedDocIds: ["glossary_net_profit"],
    expectedKeywords: ["цэвэр ашиг", "net profit", "revenue", "cost"],
    category: "business_policy",
    description: "Mongolian business term → net profit formula",
  },
  {
    query: "ашгийн хувь",
    expectedDocIds: ["glossary_profit_margin"],
    expectedKeywords: ["ашгийн хувь", "profit margin", "margin"],
    category: "business_policy",
    description: "Mongolian term → profit margin definition",
  },
  {
    query: "харилцагчийн алдагдал",
    expectedDocIds: ["glossary_churn"],
    expectedKeywords: ["churn", "алдагдал", "харилцагч"],
    category: "business_policy",
    description: "Mongolian phrase → churn definition",
  },
  {
    query: "дундаж захиалгын үнэ",
    expectedDocIds: ["glossary_aov"],
    expectedKeywords: ["aov", "average order value", "дундаж"],
    category: "business_policy",
    description: "Mongolian phrase → AOV definition",
  },
  {
    query: "өсөлтийн хувь",
    expectedDocIds: ["glossary_growth_rate"],
    expectedKeywords: ["growth", "өсөлт", "growth rate"],
    category: "business_policy",
    description: "Mongolian term → growth rate formula",
  },

  // ── Technical queries ────────────────────────────────────────
  {
    query: "SQL query best practices",
    expectedDocIds: ["doc6"],
    expectedKeywords: ["sql", "ilike", "postgresql"],
    category: "technical",
    description: "English technical → SQL best practices",
  },
  {
    query: "ILIKE хэрхэн ашиглах вэ",
    expectedDocIds: ["doc6"],
    expectedKeywords: ["ilike", "sql", "case-insensitive"],
    category: "technical",
    description: "Mongolian+English technical → SQL ILIKE guide",
  },
  {
    query: "dashboard бүтээх",
    expectedDocIds: ["doc7"],
    expectedKeywords: ["dashboard", "widget", "chart"],
    category: "technical",
    description: "Mongolian → dashboard design guide",
  },
  {
    query: "Python анализ хийх",
    expectedDocIds: ["doc8"],
    expectedKeywords: ["python", "pandas", "matplotlib", "sandbox"],
    category: "technical",
    description: "Mongolian → Python sandbox guide",
  },

  // ── Business / KPI queries ──────────────────────────────────
  {
    query: "KPI target sales",
    expectedDocIds: ["doc1"],
    expectedKeywords: ["kpi", "target", "sales"],
    category: "finance",
    description: "English business → sales KPI target",
  },
  {
    query: "customer segment",
    expectedDocIds: ["glossary_customer_segment"],
    expectedKeywords: ["segment", "customer", "харилцагч"],
    category: "business_policy",
    description: "English business → customer segment",
  },

  // ── Semantic / synonym test ──────────────────────────────────
  {
    query: "мөнгө олох",
    expectedDocIds: ["finance-glossary-0", "finance-glossary-5"],
    expectedKeywords: ["мөнгө", "орлого", "revenue", "sales"],
    category: "finance",
    description: "Semantic: 'earn money' → internal transfer + amount docs",
  },
  {
    query: "Тухайн бизнесийн орлого хэр нэмэгдсэн бэ",
    expectedDocIds: ["finance-glossary-2", "finance-glossary-1"],
    expectedKeywords: ["орлого", "revenue", "growth", "өсөлт"],
    category: "finance",
    description: "Full Mongolian sentence → other income + owner loan docs",
  },

  // ── Negative / irrelevant ────────────────────────────────────
  {
    query: "цахим гар утас",
    expectedDocIds: [],
    expectedKeywords: [],
    description: "Irrelevant query → no results expected",
  },
  {
    query: "өвлийн хүйтэн",
    expectedDocIds: [],
    expectedKeywords: [],
    description: "Irrelevant query → no results expected",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function checkResult(
  foundIds: string[],
  expectedIds: string[],
  expectedKeywords: string[]
): { found: boolean; matchedExpected: string[]; missedExpected: string[]; keywordHit: boolean } {
  const matchedExpected = expectedIds.filter(id => foundIds.includes(id));
  const missedExpected = expectedIds.filter(id => !foundIds.includes(id));
  const found = expectedIds.length === 0
    ? foundIds.length === 0  // negative case: should find nothing
    : matchedExpected.length > 0;
  const keywordHit = expectedKeywords.some(kw =>
    foundIds.some(id => {
      const doc = knowledgeDocuments.find(d => d.id === id);
      return doc && (
        doc.text.toLowerCase().includes(kw.toLowerCase()) ||
        doc.keywords.some(k => k.toLowerCase().includes(kw.toLowerCase()))
      );
    })
  );
  return { found, matchedExpected, missedExpected, keywordHit };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        Semantic Search Quality Test — End-to-End           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 1. Setup knowledge base
  console.log("[1/4] Loading knowledge base...");
  await setupKnowledgeBase();
  console.log(`       ${knowledgeDocuments.length} documents loaded\n`);

  // 2. Build BM25 index
  console.log("[2/4] Building BM25 index...");
  const bm25Index = buildBM25Index(knowledgeDocuments);
  console.log(`       BM25 index: ${bm25Index.docCount} docs, avg ${Math.round(bm25Index.avgDocLength)} tokens\n`);

  // 3. Check embedding status
  console.log("[3/4] Checking Gemini embedding status...");
  // Wait a bit for async embedding to progress
  await new Promise(r => setTimeout(r, 2000));
  const status = getSemanticSearchStatus();
  console.log(`       Gemini embeddings: ${status.geminiEmbeddings ? "ACTIVE" : "NOT AVAILABLE"}`);
  console.log(`       Embedded docs: ${status.cachedDocCount}`);
  console.log(`       Query cache: ${status.cachedQueryCount}\n`);

  // If embeddings are still loading, wait more
  if (status.cachedDocCount === 0 && status.geminiEmbeddings) {
    console.log("       Waiting for embeddings to load...");
    await new Promise(r => setTimeout(r, 5000));
    const status2 = getSemanticSearchStatus();
    console.log(`       Embedded docs after wait: ${status2.cachedDocCount}\n`);
  }

  // 4. Run test cases
  console.log("[4/4] Running test cases...\n");

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const results: { query: string; pass: boolean; details: string }[] = [];

  for (const tc of TEST_CASES) {
    totalTests++;
    const categories = tc.category ? [tc.category] : undefined;

    // Run BM25-only search
    const bm25Results = bm25Search(tc.query, knowledgeDocuments, bm25Index, 5, categories);
    const bm25Ids = bm25Results.map(r => r.doc.id);

    // Run hybrid search (BM25 + Gemini if available)
    const hybridResults = await hybridSearch(tc.query, knowledgeDocuments, bm25Index, 5, categories);
    const hybridIds = hybridResults.map(r => r.doc.id);

    // Use hybrid results as primary; fall back to BM25 only for positive cases
    // For negative cases (expectedDocIds=[]), always use hybrid to verify filtering
    const primaryIds = (hybridIds.length > 0 || tc.expectedDocIds.length === 0)
      ? hybridIds
      : bm25Ids;
    const check = checkResult(primaryIds, tc.expectedDocIds, tc.expectedKeywords);

    const pass = check.found || (tc.expectedDocIds.length === 0 && primaryIds.length === 0);
    if (pass) passedTests++;
    else failedTests++;

    const icon = pass ? "✅" : "❌";
    console.log(`${icon} [${totalTests}/20] ${tc.description}`);
    console.log(`   Query: "${tc.query}"`);
    console.log(`   Expected: [${tc.expectedDocIds.join(", ")}]`);
    console.log(`   Found (BM25):     [${bm25Ids.join(", ")}]`);
    console.log(`   Found (Hybrid):   [${hybridIds.join(", ")}]`);
    if (check.matchedExpected.length > 0) {
      console.log(`   Matched: ${check.matchedExpected.join(", ")}`);
    }
    if (check.missedExpected.length > 0) {
      console.log(`   Missed:  ${check.missedExpected.join(", ")}`);
    }

    // Show top 3 scores for hybrid
    if (hybridResults.length > 0) {
      const topScores = hybridResults.slice(0, 3).map(r =>
        `${r.doc.id}(${r.score.toFixed(3)}=sem:${r.semanticScore.toFixed(3)}+bm25:${r.bm25Score.toFixed(3)})`
      );
      console.log(`   Top scores: ${topScores.join(" > ")}`);
    } else if (bm25Results.length > 0) {
      const topScores = bm25Results.slice(0, 3).map(r =>
        `${r.doc.id}(${r.score.toFixed(3)})`
      );
      console.log(`   Top scores (BM25): ${topScores.join(" > ")}`);
    }
    console.log();

    results.push({
      query: tc.query,
      pass,
      details: pass
        ? `Matched: ${check.matchedExpected.join(", ")}`
        : `Missed: ${check.missedExpected.join(", ")}`,
    });
  }

  // 5. Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                         SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Total:  ${totalTests}`);
  console.log(`  Passed: ${passedTests} ✅`);
  console.log(`  Failed: ${failedTests} ❌`);
  console.log(`  Rate:   ${((passedTests / totalTests) * 100).toFixed(0)}%`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (failedTests > 0) {
    console.log("FAILED CASES:");
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  ❌ "${r.query}" → ${r.details}`);
    }
    console.log();
  }

  // 6. Embedding quality check (if available)
  if (status.geminiEmbeddings && status.cachedDocCount > 0) {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("              SEMANTIC vs BM25 COMPARISON");
    console.log("═══════════════════════════════════════════════════════════════");

    const semanticQueries = [
      { query: "мөнгө олох", expectBetter: "glossary_revenue" },
      { query: "business income generation", expectBetter: "glossary_revenue" },
      { query: "customer loss rate", expectBetter: "glossary_churn" },
    ];

    for (const sq of semanticQueries) {
      const bm25R = bm25Search(sq.query, knowledgeDocuments, bm25Index, 5);
      const hybridR = await hybridSearch(sq.query, knowledgeDocuments, bm25Index, 5);

      const bm25Rank = bm25R.findIndex(r => r.doc.id === sq.expectBetter) + 1;
      const hybridRank = hybridR.findIndex(r => r.doc.id === sq.expectBetter) + 1;

      const bm25Label = bm25Rank > 0 ? `#${bm25Rank}` : "not found";
      const hybridLabel = hybridRank > 0 ? `#${hybridRank}` : "not found";
      const improved = (hybridRank > 0 && (bm25Rank === 0 || hybridRank < bm25Rank));

      console.log(`\n  Query: "${sq.query}"`);
        console.log(`    Expected top doc: ${sq.expectBetter}`);
        console.log(`    BM25 rank:    ${bm25Label}`);
        console.log(`    Hybrid rank:  ${hybridLabel} ${improved ? "← IMPROVED" : ""}`);
    }
    console.log();
  }

  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
