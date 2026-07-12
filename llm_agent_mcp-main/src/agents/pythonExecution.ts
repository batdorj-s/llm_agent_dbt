import { invokeWithFallback } from "../llm-provider.js";
import { runPythonCode } from "../sandbox.js";
import { type AgentState, withTimeout } from "./agentState.js";
import { extractCodeBlock } from "../utils.js";
import { prompts } from "./prompts.js";

export async function executeTechPythonAgent(
    llm: any,
    rawQuery: string,
    onChunk?: (chunk: string) => void,
    userId: string = "anonymous",
): Promise<Partial<AgentState>> {
    console.log("[Tech Agent] Activated. Running Python via E2B sandbox...");
    const prefix = "(Tech Agent)\nPython код бэлдэж, E2B sandbox-д ажиллуулж байна...\n\n";
    if (onChunk) onChunk(prefix);

    const pythonPrompt = (prompts.tech_agent_python_gen as string).replace(/\{rawQuery\}/g, rawQuery);

    try {
        const codeGenResponse = await invokeWithFallback([
            { role: "system", content: pythonPrompt },
            { role: "user", content: rawQuery },
        ], { temperature: 0, timeout: 60000 });

        let rawCode = codeGenResponse.content;
        let pythonCode = extractCodeBlock(rawCode, "python");

        const codeBlock = `\`\`\`python\n${pythonCode}\n\`\`\`\n\n`;
        if (onChunk) onChunk(codeBlock);

        const output = await runPythonCode(pythonCode, undefined, false, userId);
        const resultBlock = `### Гүйцэтгэлийн үр дүн\n\`\`\`\n${output}\n\`\`\`\n`;
        if (onChunk) onChunk(resultBlock);

        const explainPrompt = (prompts.tech_agent_python_explain as string)
            .replace(/\{pythonCode\}/g, pythonCode)
            .replace(/\{output\}/g, output);
        const explainResponse = await invokeWithFallback([
            { role: "system", content: explainPrompt },
            { role: "user", content: rawQuery },
        ], { temperature: 0, streaming: true, timeout: 60000 });

        let accumulatedText = prefix + codeBlock + resultBlock + "\n" + explainResponse.content;
        if (onChunk) onChunk(explainResponse.content);

        return { messages: [{ role: "assistant", content: accumulatedText }] };
    } catch (err) {
        const fallback = `${prefix}[АНХААР] Python ажиллуулахад алдаа гарлаа: ${(err as Error).message}`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }
}
