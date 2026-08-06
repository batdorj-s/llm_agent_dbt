"use client";

/**
 * dataProvider.ts — Refine headless data provider mapping REST endpoints
 * under /api/admin/* to Refine resources.
 *
 * Envelope convention: `{ success, data, meta }` — unwrapped here.
 */

import type {
  DataProvider,
  GetListParams,
  GetOneParams,
  CreateParams,
  UpdateParams,
  DeleteOneParams,
  CustomParams,
  BaseRecord,
  CrudFilter,
} from "@refinedev/core";

/** resource name → API path */
const RESOURCE_PATHS: Record<string, string> = {
  users: "/api/admin/users",
  "api-keys": "/api/admin/api-keys",
  documents: "/api/admin/documents",
  summary: "/api/admin/summary",
  metrics: "/api/metrics",
  files: "/api/admin/files",
  feedback: "/api/admin/feedback/pending",
};

function resourcePath(resource: string): string {
  return RESOURCE_PATHS[resource] ?? `/api/admin/${resource}`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function filterToQuery(filters: CrudFilter[] = []): Record<string, string> {
  const q: Record<string, string> = {};
  for (const f of filters) {
    if (f.operator === "eq" && typeof f.value === "string") {
      q[f.field] = f.value;
    }
  }
  return q;
}

export function createAdminDataProvider(getToken: () => string): DataProvider {
  return {
    getApiUrl: () => "/api/admin",

    async getList<TData extends BaseRecord>({ resource, pagination, filters }: GetListParams) {
      const url = new URL(resourcePath(resource), window.location.origin);
      Object.entries(filterToQuery(filters)).forEach(([k, v]) => url.searchParams.set(k, v));
      if (pagination?.currentPage && pagination.pageSize) {
        url.searchParams.set("limit", String(pagination.pageSize));
        url.searchParams.set("page", String(pagination.currentPage));
      }

      const res = await fetch(url.toString(), { headers: authHeaders(getToken()) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      // files endpoint returns a bare array
      if (Array.isArray(body)) {
        return { data: body as TData[], total: body.length };
      }
      return {
        data: (body.data ?? []) as TData[],
        total: Number(body.meta?.total ?? (body.data ?? []).length),
      };
    },

    async getOne<TData extends BaseRecord>({ resource, id }: GetOneParams) {
      const res = await fetch(`${resourcePath(resource)}/${id}`, {
        headers: authHeaders(getToken()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return { data: (body.data ?? body) as TData };
    },

    async create<TData extends BaseRecord, TVariables = object>({
      resource,
      variables,
    }: CreateParams<TVariables>) {
      const res = await fetch(resourcePath(resource), {
        method: "POST",
        headers: authHeaders(getToken()),
        body: JSON.stringify(variables),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return { data: (body.data ?? body) as TData };
    },

    async update<TData extends BaseRecord, TVariables = object>({
      resource,
      id,
      variables,
    }: UpdateParams<TVariables>) {
      const res = await fetch(`${resourcePath(resource)}/${id}`, {
        method: "PATCH",
        headers: authHeaders(getToken()),
        body: JSON.stringify(variables),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return { data: (body.data ?? body) as TData };
    },

    async deleteOne<TData extends BaseRecord, TVariables = object>({
      resource,
      id,
    }: DeleteOneParams<TVariables>) {
      const res = await fetch(`${resourcePath(resource)}/${id}`, {
        method: "DELETE",
        headers: authHeaders(getToken()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return { data: (body.data ?? body) as TData };
    },

    async custom<TData extends BaseRecord = BaseRecord, TQuery = unknown, TPayload = unknown>({
      url,
      method = "get",
      payload,
      query,
    }: CustomParams<TQuery, TPayload>) {
      const fullUrl = new URL(url.startsWith("/") ? url : resourcePath(url), window.location.origin);
      if (query) {
        Object.entries(query as Record<string, unknown>).forEach(([k, v]) => {
          if (v !== undefined && v !== null) fullUrl.searchParams.set(k, String(v));
        });
      }
      const res = await fetch(fullUrl.toString(), {
        method: method.toUpperCase(),
        headers: authHeaders(getToken()),
        body: method === "get" || method === "delete" ? undefined : JSON.stringify(payload ?? {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return { data: (body.data ?? body) as TData };
    },
  };
}
