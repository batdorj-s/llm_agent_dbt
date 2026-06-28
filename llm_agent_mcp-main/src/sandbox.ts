import { Sandbox } from "@e2b/code-interpreter";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { traceToolCall } from "./observability/tracer.js";
import { withTimeout } from "./agents/agentState.js";


dotenv.config();

const _sandboxInstances = new Map<string, any>();

const SANDBOX_TIMEOUT_MS = 20_000;
const SANDBOX_CREATE_TIMEOUT_MS = 60_000;
const SANDBOX_MAX_OUTPUT_CHARS = 10_000;
const TEMP_DIR = "/var/folders/9z/_bgsb1152n9g37m6xn9h8thc0000gn/T/opencode";

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

/**
 * Execute Python code locally via subprocess as fallback when E2B is not available.
 */
async function runPythonLocally(code: string, timeoutMs: number): Promise<string> {
    const tmpFile = path.join(TEMP_DIR, `sandbox_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    const outputFile = tmpFile.replace(".py", "_out.txt");
    const chartFile = tmpFile.replace(".py", "_chart.png");

    // Prepend chart-save logic: redirect matplotlib to a known path
    const chartSaveCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
_orig_savefig = plt.savefig
def _savefig_wrapper(fname, **kwargs):
    _orig_savefig("${chartFile.replace(/\\/g, "\\\\")}", **kwargs)
plt.savefig = _savefig_wrapper
`;
    const fullCode = chartSaveCode + "\n" + code + `\n
# Save all output to file
import sys
with open("${outputFile.replace(/\\/g, "\\\\")}", "w") as _f:
    _f.write(str(globals().get("result", "")))
`;

    try {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
        fs.writeFileSync(tmpFile, fullCode, "utf8");

        await new Promise<void>((resolve, reject) => {
            const proc = execFile("python3", [tmpFile], {
                timeout: timeoutMs,
                maxBuffer: SANDBOX_MAX_OUTPUT_CHARS * 2,
                env: { ...process.env, PYTHONUNBUFFERED: "1" },
            }, (err, stdout, stderr) => {
                if (err && !fs.existsSync(outputFile)) {
                    reject(new Error(stderr.slice(0, SANDBOX_MAX_OUTPUT_CHARS) || err.message));
                } else {
                    resolve();
                }
            });
        });

        let output = "";
        if (fs.existsSync(outputFile)) {
            output = fs.readFileSync(outputFile, "utf8").slice(0, SANDBOX_MAX_OUTPUT_CHARS);
            fs.unlinkSync(outputFile);
        }

        if (fs.existsSync(chartFile)) {
            const base64 = fs.readFileSync(chartFile).toString("base64");
            output += `\n##CHART_SAVED##\n##BASE64_IMAGE:${base64}\n`;
            fs.unlinkSync(chartFile);
        }

        fs.unlinkSync(tmpFile);
        return output || "Execution complete. No output.";
    } catch (err: any) {
        // Cleanup temp files on error
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
        try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch {}
        try { if (fs.existsSync(chartFile)) fs.unlinkSync(chartFile); } catch {}
        throw err;
    }
}

export async function runPythonCode(code: string, timeoutMs: number = SANDBOX_TIMEOUT_MS, skipMemorySafe: boolean = false, userId: string = "anonymous"): Promise<string> {
    return traceToolCall("runPythonCode", async () => {
    const hasKey = process.env.E2B_API_KEY && process.env.E2B_API_KEY !== 'your_e2b_api_key_here';

    if (!hasKey) {
        const allowLocal = process.env.ALLOW_LOCAL_PYTHON === "true";
        if (allowLocal) {
          if (process.env.NODE_ENV === "production") {
            console.warn("[WARN] ALLOW_LOCAL_PYTHON=true but NODE_ENV=production — refusing host execution.");
            return [
              "(Python execution unavailable — E2B_API_KEY not configured)",
              "----------------------------------------------",
              "Host-local Python execution is disabled in production mode.",
              "Set E2B_API_KEY in .env to enable sandboxed Python execution.",
            ].join("\n");
          }
          console.warn("[WARN] ALLOW_LOCAL_PYTHON=true — executing on host machine (INSECURE).");
            const safeCode = skipMemorySafe ? code : preparePythonCode(code);
            return await runPythonLocally(safeCode, timeoutMs);
        }
        return [
            "(Python execution unavailable — E2B_API_KEY not configured)",
            "----------------------------------------------",
            `Executed Python code snippet:`,
            code.length > 200 ? code.slice(0, 200) + "..." : code,
            "",
            "Set E2B_API_KEY in .env to enable sandboxed Python execution.",
            "Set ALLOW_LOCAL_PYTHON=true to run on host (development only, INSECURE).",
        ].join("\n");
    }

    let instance = _sandboxInstances.get(userId);
    try {
        console.log(` Accessing E2B MicroVM Sandbox for user=${userId}...`);
        if (!instance) {
            console.log(` Initializing new E2B Sandbox MicroVM for user=${userId} (takes ~2s)...`);
            instance = await withTimeout(
                Sandbox.create({ apiKey: process.env.E2B_API_KEY }),
                "Sandbox creation",
                SANDBOX_CREATE_TIMEOUT_MS
            );
            _sandboxInstances.set(userId, instance);
        } else {
            console.log(` Reusing cached E2B Sandbox MicroVM for user=${userId} (instant)...`);
        }

        // Dynamically write/seed datasets if they exist in local workspace
        const datasets = ["superstore_sales.csv", "retail_sales_dataset.csv"];
        for (const file of datasets) {
            if (fs.existsSync(file)) {
                const csvData = fs.readFileSync(file, "utf8");
                await instance.files.write(file, csvData);
                console.log(` Seeded ${file} into E2B Sandbox.`);
            }
        }

        const safeCode = skipMemorySafe ? code : preparePythonCode(code);
        console.log(`Python Executing Python Code${skipMemorySafe ? " (full data mode)" : " (memory safe)"}...`);
        const execution: any = await withTimeout(
            instance.runCode(safeCode, { timeout: timeoutMs }),
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
            const chartContent = await instance.files.read("analysis_plot.png");
            if (chartContent) {
                const base64 = Buffer.from(chartContent).toString("base64");
                output += `\n##CHART_SAVED##\n##BASE64_IMAGE:${base64}\n`;
            }
        } catch {
            console.log(" No chart file found in sandbox output.");
        }

        return output || "Execution complete. No output.";
    } catch (error: any) {
        // Remove only this user's instance on error
        _sandboxInstances.delete(userId);
        console.error(`E2B Sandbox execution error for user=${userId}:`, error);
        return `E2B Execution Error: ${error.message}`;
    }
});
}
