"use client";

import React, { useEffect, useRef } from "react";
import { MessageSquare, Search, Plus, Trash2, X } from "lucide-react";
import type { Conversation } from "../hooks/useConversation";

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
  isOpen,
  onClose,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

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
          <input ref={searchInputRef} type="text" placeholder="Хайх..."
            value={searchQuery}
            onChange={e => { onSearchChange(e.target.value); onSearch(e.target.value); }}
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-foreground/30 transition-colors" />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {isLoading && conversations.length === 0 && (
          <div className="p-4 text-center text-foreground/30 text-[10px]">Ачаалж байна...</div>
        )}
        {!isLoading && conversations.length === 0 && (
          <div className="p-4 text-center text-foreground/30 text-[10px]">Чат байхгүй</div>
        )}
        {conversations.map(conv => (
          <div key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b border-border/50 ${
              activeConversationId === conv.id
                ? "bg-foreground/10 border-l-2 border-l-foreground"
                : "hover:bg-foreground/5 border-l-2 border-l-transparent"
            }`}>
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-foreground/30 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground/80 truncate">{conv.title || "Шинэ чат"}</p>
              <p className="text-[9px] text-foreground/30 mt-0.5">{relativeTime(conv.updatedAt)}</p>
            </div>
            <button onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
              className="opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-red-500 transition-all cursor-pointer mt-0.5">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ConversationSidebar = React.memo(ConversationSidebarInner);
