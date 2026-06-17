import { Sandbox } from "@e2b/code-interpreter";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

let _sandboxInstance: any = null;

// Mock sandbox for development/PoC if no E2B API Key is provided
export async function runPythonCode(code: string): Promise<string> {
    const hasKey = process.env.E2B_API_KEY && process.env.E2B_API_KEY !== 'your_e2b_api_key_here';
    
    if (!hasKey) {
        console.warn("⚠️ No E2B_API_KEY found. Running Sandbox in Mock Mode.");
        return `(Mock Sandbox Output)\nExecuted: \n${code}\nResult: Successfully processed data in mock environment.`;
    }

    try {
        console.log("🔒 Accessing E2B MicroVM Sandbox...");
        if (!_sandboxInstance) {
            console.log("🔒 Initializing new E2B Sandbox MicroVM (takes ~2s)...");
            _sandboxInstance = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
        } else {
            console.log("🔒 Reusing cached E2B Sandbox MicroVM (instant)...");
        }

        // Dynamically write/seed datasets if they exist in local workspace
        const datasets = ["superstore_sales.csv", "retail_sales_dataset.csv"];
        for (const file of datasets) {
            if (fs.existsSync(file)) {
                const csvData = fs.readFileSync(file, "utf8");
                await _sandboxInstance.files.write(file, csvData);
                console.log(`🔒 Seeded ${file} into E2B Sandbox.`);
            }
        }
        
        console.log("🐍 Executing Python Code...");
        const execution = await _sandboxInstance.runCode(code);
        
        let output = "";
        if (execution.logs.stdout.length > 0) output += `STDOUT:\n${execution.logs.stdout.join('\n')}\n`;
        if (execution.logs.stderr.length > 0) output += `STDERR:\n${execution.logs.stderr.join('\n')}\n`;
        
        return output || "Execution complete. No output.";
    } catch (error: any) {
        // Reset the instance on error so it spins up a fresh one next time
        _sandboxInstance = null;
        console.error("E2B Sandbox execution error:", error);
        return `E2B Execution Error: ${error.message}`;
    }
}
