import { runMultiAgent } from "./src/multi-agent.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    console.log("--- Testing Graphic Mode Rendering ---");
    
    // Simulate a query that warrants a visual, with graphic mode enabled (visualRequest = true)
    const query = "2023 оны борлуулалтыг бүтээгдэхүүний ангиллаар (Product_Category) харьцуулж харуул.";
    
    console.log(`\n\nQuery: "${query}"`);
    // Pass visualRequest: true
    await runMultiAgent(query, "admin", `verify-visual-${Date.now()}`, true);
}

main().catch(console.error);
