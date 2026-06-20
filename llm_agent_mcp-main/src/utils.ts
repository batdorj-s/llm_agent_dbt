export function extractJsonFromLlmResponse(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    const markdownMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (markdownMatch) {
        const inner = markdownMatch[1].trim();
        try {
            JSON.parse(inner);
            return inner;
        } catch {
        }
    }

    const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
        try {
            JSON.parse(jsonMatch[0]);
            return jsonMatch[0];
        } catch {
        }
    }

    return trimmed;
}

export function stripMarkdownFences(raw: string): string {
    return raw.replace(/```[\s\S]*?```/g, (match) => {
        const inner = match.replace(/```\w*\n?/, "").replace(/\n?```$/, "");
        return inner.trim();
    });
}

export function safeJsonParse<T>(raw: string, fallback: T): { data: T; cleaned: string } {
    const cleaned = extractJsonFromLlmResponse(raw);
    try {
        return { data: JSON.parse(cleaned) as T, cleaned };
    } catch {
        return { data: fallback, cleaned };
    }
}
