import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  addDocumentToCatalog,
  searchKnowledgeBaseWithFilter,
  setupKnowledgeBase,
} from "../rag.js";

const FAILED_QUERIES_PATH = path.join(process.cwd(), "logs", "failed_queries.json");
let originalFailedQueries: string | null = null;
let originalKnowledgeDocuments: any[] = [];

describe("RAG Security & Multi-Tenant Isolation", () => {
  beforeAll(async () => {
    // Backup failed_queries.json
    if (fs.existsSync(FAILED_QUERIES_PATH)) {
      originalFailedQueries = fs.readFileSync(FAILED_QUERIES_PATH, "utf8");
    } else {
      const dir = path.dirname(FAILED_QUERIES_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // Backup current knowledge base documents list
    const ragModule = await import("../rag.js");
    originalKnowledgeDocuments = [...ragModule.knowledgeDocuments];
  });

  afterAll(async () => {
    // Restore failed_queries.json
    if (originalFailedQueries !== null) {
      fs.writeFileSync(FAILED_QUERIES_PATH, originalFailedQueries, "utf8");
    } else if (fs.existsSync(FAILED_QUERIES_PATH)) {
      fs.unlinkSync(FAILED_QUERIES_PATH);
    }

    // Restore knowledge base documents
    const ragModule = await import("../rag.js");
    // Clear and restore
    ragModule.knowledgeDocuments.length = 0;
    ragModule.knowledgeDocuments.push(...originalKnowledgeDocuments);
  });

  beforeEach(async () => {
    // Reset failed_queries to empty array for tests
    fs.writeFileSync(FAILED_QUERIES_PATH, "[]", "utf8");

    // Clear active catalog to system defaults for deterministic testing
    const ragModule = await import("../rag.js");
    ragModule.knowledgeDocuments.length = 0;
    ragModule.knowledgeDocuments.push(
      {
        id: "sys_doc1",
        text: "System Business Target is to grow sales by 10% annually.",
        metadata: { category: "finance", department: "sales", author: "admin", created_at: "2026-01-01", source_name: "Glossary" },
        keywords: ["sales", "target"]
      },
      {
        id: "sys_doc2",
        text: "Technical SQL guidelines: use ILIKE for case-insensitive matching.",
        metadata: { category: "technical", department: "engineering", author: "system", created_at: "2026-01-01", source_name: "Style Guide" },
        keywords: ["sql", "ilike"]
      }
    );
  });

  describe("R2 & R4: Multi-Tenant Isolation", () => {
    it("should isolate user documents so user A cannot see user B documents", async () => {
      // User A uploads a document
      await addDocumentToCatalog(
        "doc_user_a",
        "Confidential User A strategy: focus on luxury markets.",
        { category: "finance", department: "sales", author: "user_a", source_name: "Upload" },
        ["luxury", "strategy"]
      );

      // User B uploads a document
      await addDocumentToCatalog(
        "doc_user_b",
        "Confidential User B strategy: focus on budget markets.",
        { category: "finance", department: "sales", author: "user_b", source_name: "Upload" },
        ["budget", "strategy"]
      );

      // 1. Query as User A
      const searchUserA = await searchKnowledgeBaseWithFilter({
        query: "strategy",
        agentRole: "FinanceAgent",
        limit: 10,
        userId: "user_a"
      });

      const docsUserA = searchUserA.documents[0];
      expect(docsUserA.some(d => d.includes("luxury"))).toBe(true);
      expect(docsUserA.some(d => d.includes("budget"))).toBe(false);
      // System documents should also be visible
      expect(docsUserA.some(d => d.includes("sales by 10%"))).toBe(true);

      // 2. Query as User B
      const searchUserB = await searchKnowledgeBaseWithFilter({
        query: "strategy",
        agentRole: "FinanceAgent",
        limit: 10,
        userId: "user_b"
      });

      const docsUserB = searchUserB.documents[0];
      expect(docsUserB.some(d => d.includes("luxury"))).toBe(false);
      expect(docsUserB.some(d => d.includes("budget"))).toBe(true);
      expect(docsUserB.some(d => d.includes("sales by 10%"))).toBe(true);

      // 3. Query without userId (unauthenticated/general request)
      const searchUnauth = await searchKnowledgeBaseWithFilter({
        query: "strategy",
        agentRole: "FinanceAgent",
        limit: 10
      });
      const docsUnauth = searchUnauth.documents[0];
      expect(docsUnauth.some(d => d.includes("luxury"))).toBe(false);
      expect(docsUnauth.some(d => d.includes("budget"))).toBe(false);
    });
  });

  describe("R3 & R5: Negative Feedback & KB Poisoning", () => {
    it("should prevent RAG poisoning by requiring feedback approval before indexing", async () => {
      // Simulate negative feedback submission containing false/poisonous information
      const fakeFeedbackEntry = {
        id: "feedback_fake_123",
        userId: "malicious_user",
        message: "Sales target is 9,999,999 USD.",
        response: "Incorrect response",
        rating: "negative",
        status: "pending", // Moderation queue
        timestamp: new Date().toISOString(),
      };

      // Write to failed_queries.json
      fs.writeFileSync(FAILED_QUERIES_PATH, JSON.stringify([fakeFeedbackEntry], null, 2), "utf8");

      // Reload/Setup the KB
      await setupKnowledgeBase();

      // Search for the poisoned information
      const searchResultPending = await searchKnowledgeBaseWithFilter({
        query: "Sales target is 9,999,999 USD",
        agentRole: "DataScientistAgent",
        limit: 5
      });

      // The pending/poisonous feedback should NOT be returned
      const docsPending = searchResultPending.documents[0];
      expect(docsPending.some(d => d.includes("9,999,999"))).toBe(false);

      // Now approve the feedback entry (simulate moderation approval)
      fakeFeedbackEntry.status = "approved";
      fs.writeFileSync(FAILED_QUERIES_PATH, JSON.stringify([fakeFeedbackEntry], null, 2), "utf8");

      // Reload/Setup the KB (which loads approved feedbacks)
      await setupKnowledgeBase();

      // Search again
      const searchResultApproved = await searchKnowledgeBaseWithFilter({
        query: "Sales target is 9,999,999 USD",
        agentRole: "DataScientistAgent",
        limit: 5,
        userId: "malicious_user" // Approved document has author "malicious_user"
      });

      // Now the approved feedback SHOULD be searchable
      const docsApproved = searchResultApproved.documents[0];
      expect(docsApproved.some(d => d.includes("9,999,999"))).toBe(true);
    });
  });
});
