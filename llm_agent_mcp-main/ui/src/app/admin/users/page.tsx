"use client";

/**
 * Admin Users — list, search, change role/name, delete users.
 * Uses Refine's useList / useUpdate / useDelete against GET /api/admin/users.
 */

import React, { useState } from "react";
import { useList, useUpdate, useDelete, useCreate } from "@refinedev/core";
import { Plus, Search, ShieldCheck, Trash2, User as UserIcon, X } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "viewer" | "analyst" | "admin";
  created_at?: string;
}

const ROLE_COLORS: Record<string, string> = {
  viewer: "text-foreground/60 bg-foreground/5",
  analyst: "text-sky-600 bg-sky-500/10",
  admin: "text-emerald-600 bg-emerald-500/10",
};

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createRole, setCreateRole] = useState<"viewer" | "analyst" | "admin">("viewer");
  const [createError, setCreateError] = useState<string | null>(null);

  const { query } = useList<AdminUser>({
    resource: "users",
    filters: [
      ...(search ? [{ field: "search", operator: "eq" as const, value: search }] : []),
      ...(roleFilter ? [{ field: "role", operator: "eq" as const, value: roleFilter }] : []),
    ],
  });

  const { mutate: updateUser } = useUpdate();
  const { mutate: deleteUser } = useDelete();
  const { mutate: createUser } = useCreate();

  const users = query.data?.data ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;
  const refetch = query.refetch;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createEmail.trim() || !createPassword.trim() || !createName.trim()) return;
    setCreateError(null);
    createUser(
      {
        resource: "users",
        values: {
          email: createEmail.trim(),
          password: createPassword,
          name: createName.trim(),
          role: createRole,
        },
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setCreateEmail("");
          setCreatePassword("");
          setCreateName("");
          setCreateRole("viewer");
          refetch();
        },
        onError: (err) => {
          setCreateError(err?.message || "Хэрэглэгч үүсгэхэд алдаа гарлаа");
        },
      }
    );
  };

  const handleRoleChange = (user: AdminUser, role: string) => {
    updateUser(
      { resource: "users", id: user.id, values: { role } },
      { onSuccess: () => refetch() }
    );
  };

  const handleDelete = (user: AdminUser) => {
    if (!window.confirm(`"${user.name || user.email}" хэрэглэгчийг устгах уу?`)) return;
    deleteUser(
      { resource: "users", id: user.id },
      { onSuccess: () => refetch() }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Хэрэглэгчид</h1>
        <p className="text-xs text-foreground/50 mt-1">Бүртгэлтэй хэрэглэгчийн эрх, мэдээллийг удирдах</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email эсвэл нэрээр хайх..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Бүх роль</option>
          <option value="viewer">Viewer</option>
          <option value="analyst">Analyst</option>
          <option value="admin">Admin</option>
        </select>
        <button
          onClick={() => {
            setCreateError(null);
            setShowCreate(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Хэрэглэгч нэмэх
        </button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading && (
          <div className="p-8 text-center text-sm text-foreground/50 animate-pulse">Ачааллаж байна...</div>
        )}
        {isError && (
          <div className="p-8 text-center text-sm text-red-500">Хэрэглэгчийн жагсаалтыг ачаалахад алдаа гарлаа</div>
        )}
        {!isLoading && !isError && users.length === 0 && (
          <div className="p-8 text-center text-sm text-foreground/50">Хэрэглэгч олдсонгүй</div>
        )}
        {!isLoading && !isError && users.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-foreground/40 border-b border-border">
                <th className="px-4 py-3 font-semibold">Хэрэглэгч</th>
                <th className="px-4 py-3 font-semibold">Роль</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Бүртгүүлсэн</th>
                <th className="px-4 py-3 font-semibold text-right">Үйлдэл</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-foreground/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                          <UserIcon className="w-4 h-4 text-foreground/60" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {user.name || "—"}
                            {isSelf && <span className="ml-2 text-[10px] text-foreground/40">(чи)</span>}
                          </div>
                          <div className="text-xs text-foreground/50 truncate">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        disabled={isSelf}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                        className={`px-2 py-1 rounded-md text-xs font-medium border-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                          ROLE_COLORS[user.role] ?? ""
                        }`}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="analyst">Analyst</option>
                        <option value="admin">Admin</option>
                      </select>
                      {isSelf && <div className="text-[10px] text-foreground/30 mt-0.5">өөрийн роль өөрчлөх боломжгүй</div>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-foreground/50">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString("mn-MN") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={isSelf}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Устгах
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-4 text-[11px] text-foreground/40">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Admin — бүрэн эрх
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Analyst — шинжилгээний эрх
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Viewer — унших эрх
        </span>
      </div>

      {/* Create user modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowCreate(false)}
          />
          <form
            onSubmit={handleCreate}
            className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Шинэ хэрэглэгч</h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-foreground/40 hover:text-foreground cursor-pointer"
                aria-label="Хаах"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block">
              <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">Email</span>
              <input
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                required
                placeholder="name@example.com"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">Нууц үг</span>
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                required
                minLength={6}
                placeholder="Хамгийн багадаа 6 тэмдэгт"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">Нэр</span>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                required
                placeholder="Хэрэглэгчийн нэр"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">Роль</span>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as "viewer" | "analyst" | "admin")}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="viewer">Viewer</option>
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {createError && (
              <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {createError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3.5 py-2 rounded-lg text-sm text-foreground/60 hover:text-foreground hover:bg-foreground/5 cursor-pointer transition-colors"
              >
                Болих
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                Үүсгэх
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}