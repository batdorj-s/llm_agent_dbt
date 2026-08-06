/**
 * feedback-insights.ts — C2: analyze negative outcomes in sql_gen_log + manual
 * feedback to surface recurring answer-accuracy patterns and concrete next steps.
 *
 * Run: npm run insights -- --days=14
 * Reads from the same PostgreSQL datalake pool. Read-only; never mutates data.
 */

import { pool } from "../src/db/pool.js";
import fs from "fs";
import path from "path";

interface FailRow {
  query: string;
  outcome: string;
  table_name: string | null;
  error: string | null;
  created_at: string;
}

interface FeedbackEntry {
  id: string;
  userId: string | null;
  message: string;
  response: string;
  rating: "positive" | "negative";
  status: string;
  threadId: string | null;
  timestamp: string;
}

const DAYS = parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "7", 10);

async function run(): Promise<void> {
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);

  console.log(`\n=== SQL генерэйшн алдааны анализ (сүүлийн ${DAYS} хоног) ===\n`);

  const failsRes = await pool.query(
    `SELECT query, outcome, table_name, error, created_at
       FROM sql_gen_log
      WHERE created_at >= $1
        AND outcome IN ('total_failure','schema_error','rate_limit','fallback_success','llm_attempt_1_success')
      ORDER BY created_at`,
    [since.toISOString()]
  );
  const fails = failsRes.rows as FailRow[];

  const byTable = new Map<string, FailRow[]>();
  for (const row of fails) {
    const key = row.table_name ?? "(unknown_table)";
    byTable.set(key, [...(byTable.get(key) ?? []), row]);
  }

  if (fails.length === 0) {
    console.log("Амжилтгүй/сулхан үр дүн бүртгэгдээгүй байна.");
  } else {
    for (const [table, rows] of [...byTable.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const outcomes = new Map<string, number>();
      for (const r of rows) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
      console.log(`\n-- ${table} (${rows.length} тохиолдол) --`);
      for (const [outcome, count] of outcomes) console.log(`   ${outcome}: ${count}`);
      for (const row of rows.slice(0, 3)) {
        console.log(`   Асуулт: ${row.query.slice(0, 160)}`);
        if (row.error) console.log(`   Алдаа: ${row.error.slice(0, 200)}`);
      }
    }

    // Mongolian keywords that recur in failed queries — candidate gaps for
    // columnSynonyms.ts and deterministic templates
    const synonymCandidates = ["нийт", "нийлбэр", "дундаж", "харьцуулалт", "харьцаа", "өсөлт", "бууралт", "үнэлгээ", "салбар", "тоо", "хувь"];
    console.log("\n-- Давтамжтай монгол түлхүүр үгс (амжилтгүй query-уудад) --");
    for (const kw of synonymCandidates) {
      const hits = fails.filter((r) => r.query.toLowerCase().includes(kw)).length;
      if (hits > 0) console.log(`   "${kw}": ${hits}`);
    }
  }

  const FAILED_QUERIES_PATH = path.resolve(process.cwd(), "data", "failed-queries.json");
  let negativeFeedback: FeedbackEntry[] = [];
  try {
    if (fs.existsSync(FAILED_QUERIES_PATH)) {
      const raw = JSON.parse(fs.readFileSync(FAILED_QUERIES_PATH, "utf8")) as FeedbackEntry[];
      const sinceDate = since.toISOString();
      negativeFeedback = raw.filter((e) => e.rating === "negative" && e.timestamp >= sinceDate);
    }
  } catch { /* ignore malformed file */ }

  console.log(`\n=== Сөрөг feedback (сүүлийн ${DAYS} хоног): ${negativeFeedback.length} ===`);
  for (const fb of negativeFeedback) {
    console.log(`\n- [${fb.id}] (${fb.timestamp}) Query: ${fb.message.slice(0, 160)}`);
    if (fb.response) console.log(`  Системийн хариулт: ${fb.response.slice(0, 200)}`);
  }

  console.log("\n=== Зөвлөмж (дараагийн алхмууд) ===");
  console.log(`1. ${byTable.size} хүснэгтэд давтамжтай алдаа — columnSynonyms.ts + deterministic templates-д хяналт шинжилгээ хийх.`);
  console.log("2. Сөрөг feedback дээрх асуултуудыг admin /feedback/:id/approve аргаар мэдлэгийн санд оруулах.");
  console.log("3. Монгол үг ↔ баганын маппинг дээрхи давтагдах загваруудыг prompts.ts-ийн few-shot хэсэгт нэмэх.");

  await pool.end();
}

run().catch((err) => {
  console.error("Insight script failed:", err);
  process.exit(1);
});