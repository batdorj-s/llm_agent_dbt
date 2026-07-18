"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Users, UserPlus, Trash2, Shield } from "lucide-react";

interface Team {
  id: string;
  name: string;
  description: string;
  member_count: number;
}

interface SharedResource {
  share_id: string;
  resource_type: string;
  resource_id: string;
  name: string;
  permission: string;
  granted_by: string;
  created_at: string;
}

export function SharingPanel({ token }: { token: string | null }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamForm, setTeamForm] = useState({ name: "", description: "" });
  const [showTeamForm, setShowTeamForm] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamsRes, sharedRes] = await Promise.all([
        fetch("/api/teams", { headers }),
        fetch("/api/shared-with-me", { headers }),
      ]);
      const teamsData = await teamsRes.json();
      const sharedData = await sharedRes.json();
      if (teamsData.success) setTeams(teamsData.data);
      if (sharedData.success) setSharedWithMe(sharedData.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, []);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch("/api/teams", {
        method: "POST",
        headers,
        body: JSON.stringify(teamForm),
      });
      setShowTeamForm(false);
      setTeamForm({ name: "", description: "" });
      fetchData();
    } catch { /* ignore */ }
  };

  const handleAddMember = async (teamId: string) => {
    const userId = prompt("Хэрэглэгчийн ID оруулна уу:");
    if (!userId) return;
    try {
      await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: userId }),
      });
      fetchData();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-foreground/30 text-xs animate-pulse">Ачаалж байна...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Users className="w-4 h-4 text-foreground/70" />
        <span className="text-xs font-semibold text-foreground">Хамтын ажиллагаа</span>
        <button
          onClick={() => setShowTeamForm(!showTeamForm)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer"
        >
          <UserPlus className="w-3 h-3" />
          Баг үүсгэх
        </button>
      </div>

      {showTeamForm && (
        <form onSubmit={handleCreateTeam} className="px-4 py-3 border-b border-border bg-foreground/5 space-y-2">
          <input
            type="text" placeholder="Багийн нэр" value={teamForm.name}
            onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
          <input
            type="text" placeholder="Тайлбар" value={teamForm.description}
            onChange={(e) => setTeamForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1 text-[10px] font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer">Үүсгэх</button>
            <button type="button" onClick={() => setShowTeamForm(false)} className="px-3 py-1 text-[10px] text-foreground/50 hover:text-foreground/80 cursor-pointer">Цуцлах</button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Teams section */}
        <div className="px-4 py-2 border-b border-border/60">
          <span className="text-[10px] font-medium text-foreground/50">Багууд</span>
        </div>

        {teams.length === 0 && (
          <div className="flex items-center justify-center py-6 text-foreground/40">
            <span className="text-[10px]">Таны баг байхгүй</span>
          </div>
        )}

        {teams.map((team) => (
          <div key={team.id} className="px-4 py-2.5 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-foreground/40" />
              <div className="flex-1">
                <div className="text-xs font-medium text-foreground">{team.name}</div>
                <div className="text-[9px] text-foreground/40 flex items-center gap-2">
                  <span>{team.member_count} гишүүн</span>
                  {team.description && <span>· {team.description}</span>}
                </div>
              </div>
              <button
                onClick={() => handleAddMember(team.id)}
                className="p-1 text-foreground/30 hover:text-blue-500 transition-colors cursor-pointer"
                title="Гишүүн нэмэх"
              >
                <UserPlus className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}

        {/* Shared with me */}
        <div className="px-4 py-2 border-b border-border/60 mt-2">
          <span className="text-[10px] font-medium text-foreground/50">Надтай хуваалцсан</span>
        </div>

        {sharedWithMe.length === 0 && (
          <div className="flex items-center justify-center py-6 text-foreground/40">
            <span className="text-[10px]">Хуваалцсан өгөгдөл байхгүй</span>
          </div>
        )}

        {sharedWithMe.map((item) => (
          <div key={item.share_id} className="px-4 py-2.5 border-b border-border/40">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-xs text-foreground">{item.name || item.resource_id}</div>
                <div className="text-[9px] text-foreground/40">
                  {item.resource_type} · {item.permission} эрх · {new Date(item.created_at).toLocaleDateString("mn-MN")}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
