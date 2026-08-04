/**
 * sentry.ts — optional Sentry error tracking, enabled only when SENTRY_DSN is set.
 */

import * as Sentry from "@sentry/node";

let enabled = false;

export function initSentry(): void {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn || enabled) return;
    try {
        Sentry.init({
            dsn,
            environment: process.env.NODE_ENV ?? "development",
            tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
        });
        enabled = true;
        console.log("[Sentry] Error tracking enabled");
    } catch (err) {
        console.warn(`[Sentry] Init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export function captureError(err: unknown): void {
    if (!enabled) return;
    Sentry.captureException(err);
}

export function isSentryEnabled(): boolean {
    return enabled;
}
