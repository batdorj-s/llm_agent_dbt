"use client";

import React from "react";
import { Send, Square, BarChart2 } from "lucide-react";

interface ChatInputProps {
  input: string;
  isChatLoading: boolean;
  streamEnabled: boolean;
  isGraphicModeEnabled: boolean;
  threadId: string;
  onInputChange: (val: string) => void;
  onStreamEnabledChange: (val: boolean) => void;
  onGraphicModeToggle: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export const ChatInput = ({
  input,
  isChatLoading,
  streamEnabled,
  isGraphicModeEnabled,
  threadId,
  onInputChange,
  onStreamEnabledChange,
  onGraphicModeToggle,
  onSubmit,
  onCancel,
}: ChatInputProps) => {
  return (
    <form onSubmit={onSubmit} className="p-6 border-t border-border bg-background space-y-2 transition-colors duration-200">
      <div className="flex justify-between items-center text-[10px] text-foreground/50 font-mono">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={streamEnabled}
            onChange={(e) => onStreamEnabledChange(e.target.checked)}
            className="rounded border-border bg-background text-foreground focus:ring-0 focus:ring-offset-0 w-3 h-3"
          />
          SSE Stream
        </label>
        <div>ID: {threadId.substring(0, 10)}...</div>
      </div>

      <div className="flex gap-3 items-center max-w-3xl mx-auto w-full">
        <button
          type="button"
          onClick={onGraphicModeToggle}
          className={`p-2 rounded transition-all cursor-pointer border ${
            isGraphicModeEnabled
              ? "bg-foreground text-background border-foreground"
              : "bg-sidebar border-border text-foreground/50 hover:text-foreground hover:border-foreground/30"
          }`}
          title={isGraphicModeEnabled ? "Graphic Mode ON" : "Graphic Mode OFF"}
        >
          <BarChart2 className="w-3.5 h-3.5" />
        </button>
        <input
          type="text"
          placeholder="Шинжээч-ээс асуух..."
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={isChatLoading}
          className="flex-1 bg-sidebar border border-border rounded py-2 px-3 text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 text-[11px] disabled:opacity-50 transition-all duration-150"
        />
        {isChatLoading ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/20 hover:border-red-500/50 rounded font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 duration-150"
            title="Stop generation"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span className="text-xs font-semibold">Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={isChatLoading || !input.trim()}
            className="p-2 bg-foreground text-background hover:opacity-90 rounded font-bold transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center active:scale-95 duration-150"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </form>
  );
};
