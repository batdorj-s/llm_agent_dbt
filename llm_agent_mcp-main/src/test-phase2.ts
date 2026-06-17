import { setupKnowledgeBase } from "./rag.js";
import { runAgent } from "./agent.js";

async function main() {
    console.log("--- Initializing Phase 2 (RAG + Agent) ---");
    
    // 1. Setup Vector DB
    try {
        await setupKnowledgeBase();
    } catch (e) {
        console.error("Make sure ChromaDB is running via docker-compose!");
        process.exit(1);
    }

    // 2. Test the Agent with a query that should trigger RAG
    const query = "What is the definition and target of Sales?";
    await runAgent(query);
}

main();
