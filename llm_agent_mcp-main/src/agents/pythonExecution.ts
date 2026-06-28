import { createLLM } from "../llm-provider.js";
import { runPythonCode } from "../sandbox.js";
import { type AgentState, withTimeout } from "./agentState.js";
import { extractCodeBlock } from "../utils.js";

export async function executeTechPythonAgent(
    llm: any,
    rawQuery: string,
    onChunk?: (chunk: string) => void,
    userId: string = "anonymous",
): Promise<Partial<AgentState>> {
    console.log("[Tech Agent] Activated. Running Python via E2B sandbox...");
    const prefix = "(Tech Agent)\nPython код бэлдэж, E2B sandbox-д ажиллуулж байна...\n\n";
    if (onChunk) onChunk(prefix);

    const pythonPrompt = `You are a Python data analyst. Write executable Python 3 code for this task.
Use pandas if reading CSV files (superstore_sales.csv or retail_sales_dataset.csv may exist in the sandbox).
IMPORTANT - Memory safety: NEVER load entire datasets into memory. ALWAYS use df.head(500) or df.sample(500) or pd.read_csv(nrows=1000) to limit data size. The sandbox has limited RAM.
Return ONLY the Python code inside a markdown \`\`\`python block. No explanation outside the block.

Task: ${rawQuery}`;

    try {
        const codeGenResponse = await withTimeout(llm.invoke([
            { role: "system", content: pythonPrompt },
            { role: "user", content: rawQuery },
        ]), "Tech agent Python generation") as any;

        let rawCode = codeGenResponse.content as string;
        let pythonCode = extractCodeBlock(rawCode, "python");

        const codeBlock = `\`\`\`python\n${pythonCode}\n\`\`\`\n\n`;
        if (onChunk) onChunk(codeBlock);

        const output = await runPythonCode(pythonCode, undefined, false, userId);
        const resultBlock = `### Гүйцэтгэлийн үр дүн\n\`\`\`\n${output}\n\`\`\`\n`;
        if (onChunk) onChunk(resultBlock);

        const explainPrompt = `Summarize the Python execution results for a business user in Mongolian. Be concise. Include "Тооцооны аргачлал:" section explaining how numbers were calculated.\n\nCode:\n${pythonCode}\n\nOutput:\n${output}`;
        const stream: any = await withTimeout(llm.stream([
            { role: "system", content: explainPrompt },
            { role: "user", content: rawQuery },
        ]), "Tech agent Python explanation");

        let accumulatedText = prefix + codeBlock + resultBlock + "\n";
        if (onChunk) onChunk("\n");
        for await (const chunk of stream) {
            const text = chunk.content as string;
            accumulatedText += text;
            if (onChunk) onChunk(text);
        }

        return { messages: [{ role: "assistant", content: accumulatedText }] };
    } catch (err) {
        const fallback = `${prefix}[АНХААР] Python ажиллуулахад алдаа гарлаа: ${(err as Error).message}`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }
}
