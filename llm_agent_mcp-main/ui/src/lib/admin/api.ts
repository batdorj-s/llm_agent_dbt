"use client";

/**
 * api.ts — Admin API fetch helper with auth header.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  error?: string;
}

export async function apiFetch<T = unknown>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;

  if (!res.ok) {
    const message =
      body.error || body.success === false
        ? (body.error ?? "Request failed")
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body;
}
