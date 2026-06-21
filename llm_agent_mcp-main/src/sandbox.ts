import { Sandbox } from "@e2b/code-interpreter";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

let _sandboxInstance: any = null;

const SANDBOX_TIMEOUT_MS = 20_000;
const SANDBOX_CREATE_TIMEOUT_MS = 60_000;
const SANDBOX_MAX_OUTPUT_CHARS = 10_000;

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
    let handle: ReturnType<typeof setTimeout>;
    const timeout = new Promise<T>((_, reject) => {
        handle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(handle!));
}

function preparePythonCode(code: string): string {
    const safeLines = [
        "# [WARN] Memory safety: sampling first rows to prevent OOM",
        "import pandas as pd",
        "_orig_read_csv = pd.read_csv",
        "_orig_read_excel = pd.read_excel",
        "def _safe_read_csv(*args, **kwargs):",
        "    if 'nrows' not in kwargs:",
        "        kwargs['nrows'] = 1000",
        "    if 'dtype' not in kwargs:",
        "        kwargs['dtype'] = 'object'",
        "    return _orig_read_csv(*args, **kwargs)",
        "pd.read_csv = _safe_read_csv",
        "def _safe_read_excel(*args, **kwargs):",
        "    if 'nrows' not in kwargs:",
        "        kwargs['nrows'] = 1000",
        "    return _orig_read_excel(*args, **kwargs)",
        "pd.read_excel = _safe_read_excel",
        "_orig_head = pd.DataFrame.head",
        "def _safe_head(df, n=5):",
        "    return _orig_head(df, min(n, 500))",
        "pd.DataFrame.head = _safe_head",
        "",
    ];
    return safeLines.join("\n") + "\n" + code;
}

// Mock sandbox for development/PoC if no E2B API Key is provided
export async function runPythonCode(code: string, timeoutMs: number = SANDBOX_TIMEOUT_MS, skipMemorySafe: boolean = false): Promise<string> {
    const hasKey = process.env.E2B_API_KEY && process.env.E2B_API_KEY !== 'your_e2b_api_key_here';

    if (!hasKey) {
        console.warn("[WARN] No E2B_API_KEY found. Running Sandbox in Mock Mode.");
        const mockChartPath = path.join(process.cwd(), "analysis_plot.png");
        if (fs.existsSync(mockChartPath)) {
            const base64 = fs.readFileSync(mockChartPath).toString("base64");
            return [
                "##CHART_SAVED##",
                `##BASE64_IMAGE:${base64}`,
                "",
                "(Mock Sandbox Output — E2B_API_KEY not configured)",
                "----------------------------------------------",
                `Executed Python code snippet:`,
                code.length > 200 ? code.slice(0, 200) + "..." : code,
                "",
                "Result: In a real environment, this code would be executed in an E2B MicroVM."
            ].join("\n");
        }
        return [
            "(Mock Sandbox Output — E2B_API_KEY not configured)",
            "----------------------------------------------",
            `Executed Python code snippet:`,
            code.length > 200 ? code.slice(0, 200) + "..." : code,
            "",
            "Result: In a real environment, this code would be executed in an E2B MicroVM."
        ].join("\n");
    }

    try {
        console.log(" Accessing E2B MicroVM Sandbox...");
        if (!_sandboxInstance) {
            console.log(" Initializing new E2B Sandbox MicroVM (takes ~2s)...");
            _sandboxInstance = await withTimeout(
                Sandbox.create({ apiKey: process.env.E2B_API_KEY }),
                "Sandbox creation",
                SANDBOX_CREATE_TIMEOUT_MS
            );
        } else {
            console.log(" Reusing cached E2B Sandbox MicroVM (instant)...");
        }

        // Dynamically write/seed datasets if they exist in local workspace
        const datasets = ["superstore_sales.csv", "retail_sales_dataset.csv"];
        for (const file of datasets) {
            if (fs.existsSync(file)) {
                const csvData = fs.readFileSync(file, "utf8");
                await _sandboxInstance.files.write(file, csvData);
                console.log(` Seeded ${file} into E2B Sandbox.`);
            }
        }

        const safeCode = skipMemorySafe ? code : preparePythonCode(code);
        console.log(`Python Executing Python Code${skipMemorySafe ? " (full data mode)" : " (memory safe)"}...`);
        const execution: any = await withTimeout(
            _sandboxInstance.runCode(safeCode, { timeout: timeoutMs }),
            "Python execution",
            timeoutMs
        );

        let output = "";
        if (execution.logs.stdout.length > 0) {
            const stdout = execution.logs.stdout.join('\n');
            output += `STDOUT:\n${stdout.slice(0, SANDBOX_MAX_OUTPUT_CHARS)}\n`;
            if (stdout.length > SANDBOX_MAX_OUTPUT_CHARS) output += "\n[Output truncated — too large]\n";
        }
        if (execution.logs.stderr.length > 0) {
            const stderr = execution.logs.stderr.join('\n');
            output += `STDERR:\n${stderr.slice(0, SANDBOX_MAX_OUTPUT_CHARS)}\n`;
        }

        try {
            const chartContent = await _sandboxInstance.files.read("analysis_plot.png");
            if (chartContent) {
                const base64 = Buffer.from(chartContent).toString("base64");
                output += `\n##CHART_SAVED##\n##BASE64_IMAGE:${base64}\n`;
            }
        } catch {
            console.log(" No chart file found in sandbox output.");
        }

        return output || "Execution complete. No output.";
    } catch (error: any) {
        // Reset the instance on error so it spins up a fresh one next time
        _sandboxInstance = null;
        console.error("E2B Sandbox execution error:", error);
        return `E2B Execution Error: ${error.message}`;
    }
}
