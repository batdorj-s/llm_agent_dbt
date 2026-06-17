import { setupKnowledgeBase } from "./rag.js";
import { runMultiAgent } from "./multi-agent.js";

async function main() {
    console.log("--- Initializing Phase 3 (Multi-Agent, RBAC, Sandbox) ---");
    await setupKnowledgeBase();

    // Test 1: Tech Agent with Mock Sandbox
    await runMultiAgent(
        "Can you write some python code to analyze this data?", 
        "admin", 
        "thread_1"
    );

    // Test 2: Finance Agent
    await runMultiAgent(
        "What are the sales targets?", 
        "admin", 
        "thread_2"
    );

    // Test 3: Tech Agent (SQL Analysis)
    await runMultiAgent(
        "retail_sales хүснэгтэд нийт хэдэн гүйлгээ байгаа вэ?", 
        "admin", 
        "thread_3"
    );
}

main();
