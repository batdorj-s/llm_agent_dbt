"use client";

/**
 * Admin API Keys — create, list, toggle active, delete keys.
 * POST /api/admin/api-keys shows the full key once; PATCH toggles.
 */

import React, { useState } from "react";
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";
import { KeyRound, Plus, Copy, Check, Power, Trash2, Eye, EyeOff } from "lucide-react";

interface ApiKeyRecord {
  id: string;
  keyPrefix: string;
  name: string;
  permissions: string[];
  expiresAt: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function AdminApiKeysPage() {
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [createdKey, setCreatedKey] = useState<{ id: string; key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const { query } = useList<ApiKeyRecord>({
    resource: "api-keys",
  });

  const { mutate: createKey, mutation: createMutation } = useCreate();
  const { mutate: updateKey } = useUpdate();
  const { mutate: deleteKey } = useDelete();

  const keys = query.data?.data ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;
  const refetch = query.refetch;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createKey(
      {
        resource: "api-keys",
        values: {
          name: name.trim(),
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        },
      },
      {
        onSuccess: (res) => {
          const created = res.data as unknown as { id: string; key: string; name: string };
          setCreatedKey(created);
          setName("");
          setExpiresInDays("");
          refetch();
        },
      }
    );
  };

  const handleToggle = (key: ApiKeyRecord) => {
    updateKey(
      { resource: "api-keys", id: key.id, values: { isActive: !key.isActive } },
      { onSuccess: () => refetch() }
    );
  };

  const handleDelete = (key: ApiKeyRecord) => {
    if (!window.confirm(`"${key.name}" түлхүүрийг устгах уу?`)) return;
    deleteKey({ resource: "api-keys", id: key.id }, { onSuccess: () => refetch() });
  };

  const copyKey = () => {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">API түлхүүрүүд</h1>
        <p className="text-xs text-foreground/50 mt-1">API-д хандалтын түлхүүр үүсгэх, удирдах</p>
      </div>

      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="bg-card border border-border rounded-xl p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Plus className="w-4 h-4" /> Шинэ түлхүүр
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Түлхүүрийн нэр (жишээ: dev-server)"
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            type="number"
            min="1"
            placeholder="Хугацаа (өдөр, сонголт)"
            className="w-40 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-opacity"
          >
            Үүсгэх
          </button>
        </div>
      </form>

      {/* Created key banner — shown once */}
      {createdKey && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
          <div className="text-sm font-semibold text-emerald-600">Түлхүүр амжилттай үүслээ</div>
          <div className="text-xs text-foreground/60">
            Түлхүүрийг дараа нь дахин харах боломжгүй — нэн даруй хуулж аваарай:
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-background border border-emerald-500/30 text-xs text-foreground break-all font-mono">
              {showKey ? createdKey.key : "••••••••••••••••••••••••"}
            </code>
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="p-2 rounded-lg border border-border text-foreground/60 hover:text-foreground cursor-pointer transition-colors"
              aria-label={showKey ? "Түлхүүрийг нуух" : "Түлхүүрийг харуулах"}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={copyKey}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 cursor-pointer transition-opacity"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading && (
          <div className="p-8 text-center text-sm text-foreground/50 animate-pulse">Ачааллаж байна...</div>
        )}
        {isError && (
          <div className="p-8 text-center text-sm text-red-500">Түлхүүрийн жагсаалтыг ачаалахад алдаа гарлаа</div>
        )}
        {!isLoading && !isError && keys.length === 0 && (
          <div className="p-8 text-center text-sm text-foreground/50">Түлхүүр байхгүй байна</div>
        )}
        {!isLoading && !isError && keys.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-foreground/40 border-b border-border">
                <th className="px-4 py-3 font-semibold">Түлхүүр</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Эрхүүд</th>
                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Хугацаа</th>
                <th className="px-4 py-3 font-semibold">Төлөв</th>
                <th className="px-4 py-3 font-semibold text-right">Үйлдэл</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-border last:border-0 hover:bg-foreground/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                        <KeyRound className="w-4 h-4 text-foreground/60" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">{key.name}</div>
                        <div className="text-xs text-foreground/50 font-mono truncate">
                          {key.keyPrefix}•••••••••••
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {key.permissions.length === 0 ? (
                        <span className="text-[10px] text-foreground/30">—</span>
                      ) : (
                        key.permissions.map((p) => (
                          <span key={p} className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px] text-foreground/60">
                            {p}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-xs text-foreground/50">
                    {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString("mn-MN") : "Хязгааргүй"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        key.isActive
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-foreground/5 text-foreground/40"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${key.isActive ? "bg-emerald-500" : "bg-foreground/30"}`} />
                      {key.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggle(key)}
                        className="p-2 rounded-md text-foreground/50 hover:text-foreground hover:bg-foreground/5 cursor-pointer transition-colors"
                        title={key.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(key)}
                        className="p-2 rounded-md text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors"
                        title="Устгах"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}