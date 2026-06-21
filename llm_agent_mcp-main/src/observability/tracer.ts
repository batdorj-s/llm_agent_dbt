import { CallbackHandler } from "langfuse-langchain";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import dotenv from "dotenv";

dotenv.config();

let _handler: CallbackHandler | null = null;
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
        _handler = new CallbackHandler({
            secretKey,
            publicKey,
            baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
            rootSessionId: () => `session-${Date.now()}`,
        } as any);

        _enabled = true;
        console.log("[Tracing] Langfuse LangChain CallbackHandler initialized.");
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
