/**
 * context.ts — AsyncLocalStorage-based request context.
 *
 * Propagates requestId across the entire async call chain without
 * needing to pass it through every function signature.
 *
 * Usage:
 *   // In Express middleware:
 *   requestContext.run({ requestId: reqId, userId }, next);
 *
 *   // Anywhere in the call chain:
 *   const ctx = getContext();
 *   console.log(ctx?.requestId);
 */

import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  requestId: string;
  userId?: string;
  ipAddress?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string {
  return requestContext.getStore()?.requestId ?? "-";
}
