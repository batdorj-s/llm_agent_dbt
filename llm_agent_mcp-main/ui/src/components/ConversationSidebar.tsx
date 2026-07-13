"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { MessageSquare, Search, Plus, Trash2, X, Pencil, Check } from "lucide-react";
import type { Conversation } from "../hooks/useConversation";

// #8: Optional lastMessage field
interface ConversationWithPreview extends Conversation {
  lastMessage?: string | null;
}

interface ConversationSidebarProps {
  conversations: Conversation[];
  isLoading: boolean;
  searchQuery: string;
  activeConversationId: string | null;
  onSearchChange: (q: string) => void;
  onSearch: (q: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onRename?: (id: string, title: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Одоо";
  if (diffMin < 60) return `${diffMin} мин`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} цаг`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} өдөр`;
}

// #9: Date grouping
function getDateGroup(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (d >= startOfToday) return "Өнөөдөр";
  if (d >= startOfYesterday) return "Өчигдөр";
  if (d >= startOfWeek) return "Энэ 7 хоног";
  if (d >= startOfMonth) return "Энэ сар";
  return "Өмнөх";
}

// #18: Debounce hook
function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const ConversationSidebarInner: React.FC<ConversationSidebarProps> = ({
  conversations,
  isLoading,
  searchQuery,
  activeConversationId,
  onSearchChange,
  onSearch,
  onSelect,
  onDelete,
  onNewChat,
  onRename,
  isOpen,
  onClose,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  // #10: Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // #18: Debounced search
  const debouncedQuery = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (debouncedQuery !== undefined) onSearch(debouncedQuery);
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  if (!isOpen) return null;

  const handleRenameStart = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(conv.id);
    setRenameValue(conv.title || "");
  };

  const handleRenameSubmit = (id: string) => {
    if (renameValue.trim() && onRename) {
      onRename(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  // #9: Group conversations by date
  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const conv of conversations) {
      const g = getDateGroup(conv.updatedAt);
      if (!groups[g]) groups[g] = [];
      groups[g].push(conv);
    }
    return groups;
  }, [conversations]);

  const groupOrder = ["Өнөөдөр", "Өчигдөр", "Энэ 7 хоног", "Энэ сар", "Өмнөх"];

  return (
    <div className="w-64 border-r border-border bg-sidebar/80 flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/50">Чат түүх</span>
        <button onClick={onClose} className="text-foreground/40 hover:text-foreground transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New Chat + Search */}
      <div className="p-2 space-y-2 border-b border-border">
        <button onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity cursor-pointer">
          <Plus className="w-3.5 h-3.5" />
          Шинэ чат
        </button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/30" />
          {/* #18: Debounced search — onSearchChange updates state, debounce triggers onSearch */}
          <input ref={searchInputRef} type="text" placeholder="Хайх..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-foreground/30 transition-colors" />
        </div>
      </div>

      {/* Conversation List — #9: Grouped by date */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {isLoading && conversations.length === 0 && (
          <div className="p-4 text-center text-foreground/30 text-[10px]">Ачаалж байна...</div>
        )}
        {!isLoading && conversations.length === 0 && (
          <div className="p-4 text-center text-foreground/30 text-[10px]">Чат байхгүй</div>
        )}
        {groupOrder.map(group => {
          const convs = grouped[group];
          if (!convs || convs.length === 0) return null;
          return (
            <div key={group}>
              <div className="px-3 pt-2.5 pb-1 text-[9px] font-bold text-foreground/30 uppercase tracking-wider">{group}</div>
              {convs.map(conv => (
                <div key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b border-border/50 ${
                    activeConversationId === conv.id
                      ? "bg-foreground/10 border-l-2 border-l-foreground"
                      : "hover:bg-foreground/5 border-l-2 border-l-transparent"
                  }`}>
                  <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-foreground/30 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {/* #10: Inline rename */}
                    {renamingId === conv.id ? (
                      <form onSubmit={e => { e.preventDefault(); handleRenameSubmit(conv.id); }}
                        className="flex items-center gap-1">
                        <input ref={renameInputRef} type="text" value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => handleRenameSubmit(conv.id)}
                          onClick={e => e.stopPropagation()}
                          className="flex-1 text-xs bg-background border border-foreground/30 rounded px-1 py-0.5 focus:outline-none" />
                        <button type="submit" onClick={e => e.stopPropagation()}
                          className="text-foreground/40 hover:text-green-500 cursor-pointer"><Check className="w-3 h-3" /></button>
                      </form>
                    ) : (
                      <>
                        <p className="text-xs text-foreground/80 truncate">{conv.title || "Шинэ чат"}</p>
                        {/* #8: lastMessage preview */}
                        {"lastMessage" in conv && (conv as ConversationWithPreview).lastMessage && (
                          <p className="text-[9px] text-foreground/40 truncate mt-0.5">{(conv as ConversationWithPreview).lastMessage}</p>
                        )}
                        <p className="text-[9px] text-foreground/30 mt-0.5">{relativeTime(conv.updatedAt)}</p>
                      </>
                    )}
                  </div>
                  {/* Actions: rename + delete */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                    {renamingId !== conv.id && onRename && (
                      <button onClick={e => handleRenameStart(conv, e)}
                        className="text-foreground/30 hover:text-foreground transition-colors cursor-pointer">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
                      className="text-foreground/30 hover:text-red-500 transition-colors cursor-pointer">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ConversationSidebar = React.memo(ConversationSidebarInner);
