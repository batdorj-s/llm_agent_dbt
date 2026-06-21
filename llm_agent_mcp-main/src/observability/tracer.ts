import { CallbackHandler, Langfuse } from "langfuse-langchain";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import dotenv from "dotenv";

dotenv.config();

let _handler: CallbackHandler | null = null;
let _langfuse: Langfuse | null = null;
let _enabled = false;

export function initTracing(): { handler: BaseCallbackHandler | null; enabled: boolean } {
    if (_handler) return { handler: _handler, enabled: _enabled };

    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;

    if (!secretKey || !publicKey) {
        console.warn("[Tracing] LANGFUSE_SECRET_KEY / LANGFUSE_PUBLIC_KEY not set. Tracing disabled.");
        _enabled = false;
        return { handler: null, enabled: false };
    }

    try {
        _langfuse = new Langfuse({
            secretKey,
            publicKey,
            baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
        } as any);

        _handler = new CallbackHandler({
            langfuse: _langfuse,
            rootSessionId: () => `session-${Date.now()}`,
        } as any);

        _enabled = true;
        console.log("[Tracing] Langfuse initialized with CallbackHandler.");
        return { handler: _handler, enabled: true };
    } catch (err) {
        console.warn("[Tracing] Failed to initialize Langfuse:", (err as Error).message);
        _enabled = false;
        return { handler: null, enabled: false };
    }
}

export function getTraceHandler(): BaseCallbackHandler | null {
    if (!_handler) initTracing();
    return _handler;
}

export function isTracingEnabled(): boolean {
    return _enabled;
}

/**
 * Trace a tool call (executeSql, runPythonCode, etc.) that falls outside
 * the LangGraph callback chain. Creates a standalone Langfuse trace.
 */
export async function traceToolCall<T>(
    toolName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
): Promise<T> {
    if (!_enabled || !_langfuse) return fn();

    const trace = _langfuse.trace({ name: toolName });
    const span = trace.span({ name: `${toolName}.execute`, input: metadata });

    const startTime = Date.now();
    try {
        const result = await fn();
        span.end({
            output: result,
            startTime: new Date(startTime),
            metadata: { durationMs: Date.now() - startTime, ...metadata },
        });
        trace.update({ name: toolName, metadata: { success: true } });
        return result;
    } catch (error) {
        span.end({
            level: "ERROR",
            statusMessage: (error as Error).message,
            startTime: new Date(startTime),
            metadata: { durationMs: Date.now() - startTime, ...metadata },
        });
        trace.update({ name: toolName, metadata: { success: false, error: (error as Error).message } });
        throw error;
    }
}

/**
 * Synchronous variant for fire-and-forget or quick tool traces.
 */
export function traceToolCallSync<T>(
    toolName: string,
    fn: () => T,
    metadata?: Record<string, unknown>
): T {
    if (!_enabled || !_langfuse) return fn();

    const trace = _langfuse.trace({ name: toolName });
    const span = trace.span({ name: `${toolName}.execute`, input: metadata });

    const startTime = Date.now();
    try {
        const result = fn();
        span.end({
            output: result,
            startTime: new Date(startTime),
            metadata: { durationMs: Date.now() - startTime, ...metadata },
        });
        trace.update({ name: toolName, metadata: { success: true } });
        return result;
    } catch (error) {
        span.end({
            level: "ERROR",
            statusMessage: (error as Error).message,
            startTime: new Date(startTime),
            metadata: { durationMs: Date.now() - startTime, ...metadata },
        });
        trace.update({ name: toolName, metadata: { success: false, error: (error as Error).message } });
        throw error;
    }
}
