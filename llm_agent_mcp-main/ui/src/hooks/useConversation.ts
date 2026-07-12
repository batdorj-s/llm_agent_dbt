"use client";

import { useState, useCallback } from "react";

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  agentType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function useConversation(token: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/conversations?limit=50", { headers });
      const data = await res.json();
      if (data.success) setConversations(data.data);
    } catch {
      // best-effort
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const searchConversationsList = useCallback(async (q: string) => {
    if (!q.trim()) {
      fetchConversations();
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(q)}`, { headers });
      const data = await res.json();
      if (data.success) setConversations(data.data);
    } catch {
      // best-effort
    } finally {
      setIsLoading(false);
    }
  }, [token, fetchConversations]);

  const createNewConversation = useCallback(async (title?: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers,
        body: JSON.stringify({ title, agentType: "multi-agent" }),
      });
      const data = await res.json();
      if (data.success) {
        setConversations(prev => [data.data, ...prev]);
        return data.data.id;
      }
    } catch {
      // best-effort
    }
    return null;
  }, [token]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE", headers });
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch {
      // best-effort
    }
  }, [token]);

  const loadMessages = useCallback(async (conversationId: string): Promise<ConversationMessage[]> => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages?limit=500`, { headers });
      const data = await res.json();
      if (data.success) return data.data;
    } catch {
      // best-effort
    }
    return [];
  }, [token]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ title }),
      });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    } catch {
      // best-effort
    }
  }, [token]);

  return {
    conversations,
    isLoading,
    searchQuery,
    setSearchQuery,
    fetchConversations,
    searchConversationsList,
    createNewConversation,
    deleteConversation,
    loadMessages,
    renameConversation,
  };
}
