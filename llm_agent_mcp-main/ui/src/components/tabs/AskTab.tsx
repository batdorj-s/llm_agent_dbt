"use client";

import React from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { ChatInput } from "../ChatInput";
import { formatMessageText } from "../ChatMessage";
import type { Message } from "../types";

interface Suggestion {
  label: string;
  query: string;
  icon?: React.ReactNode;
}

interface AskTabProps {
  chat: {
    messages: Message[];
    input: string;
    isChatLoading: boolean;
    streamEnabled: boolean;
    activeRoutingState: string;
    feedbackState: Record<string, "positive" | "negative" | null>;
    feedbackSentMsgs: Record<string, string>;
    lastAgentType: string | null;
    setInput: (v: string) => void;
    setStreamEnabled: (v: boolean) => void;
    handleSendMessage: (e?: React.FormEvent, customInput?: string) => Promise<void>;
    handleCancelMessage: () => void;
    handleFeedback: (msgId: string, type: "positive" | "negative") => void;
  };
  isGraphicModeEnabled: boolean;
  setIsGraphicModeEnabled: (v: boolean) => void;
  threadId: string;
  activeSuggestions: Suggestion[];
  followUpSuggestions: Suggestion[] | Record<string, Suggestion[]>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const AskTabInner: React.FC<AskTabProps> = ({
  chat,
  isGraphicModeEnabled,
  setIsGraphicModeEnabled,
  threadId,
  activeSuggestions,
  followUpSuggestions,
  messagesEndRef,
}) => {
  return (
    <main key="tab-ask" className="flex-1 flex overflow-hidden min-h-0 animate-fade-in-up">
      <section className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background relative">
        {/* Routing indicator */}
        <div className="border-b border-border py-2.5 px-6 flex items-center justify-between bg-sidebar/50 transition-colors duration-200">
          <div className="flex items-center gap-1.5 text-foreground/50 text-[10px] uppercase font-bold tracking-wider">
            <span className={`w-1.5 h-1.5 rounded-full ${chat.activeRoutingState !== "idle" && chat.activeRoutingState !== "done" ? "bg-foreground animate-pulse" : "bg-foreground/30"}`} />
            Шинжилгээний замнал
          </div>
          <div className="flex gap-4 items-center font-mono text-[9px]">
            <span className={chat.activeRoutingState === "routing" ? "text-foreground font-bold" : "text-foreground/40"}>Router</span>
            <span className="text-foreground/30">→</span>
            <span className={chat.activeRoutingState === "finance" ? "text-foreground font-bold" : "text-foreground/40"}>FinanceAgent</span>
            <span className="text-foreground/30">/</span>
            <span className={chat.activeRoutingState === "tech" ? "text-foreground font-bold" : "text-foreground/40"}>TechAgent</span>
          </div>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 flex flex-col justify-start">
          {chat.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center my-auto gap-6">
              <div className="text-center text-foreground/40">
                <p className="font-semibold">Шинжилгээний хэлхээ идэвхтэй.</p>
                <p className="text-[10px] mt-1">Доорх саналуудаас сонгох эсвэл өөрөө асуултаа бичнэ үү.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {activeSuggestions.map((s, i) => (
                  <button key={i} onClick={() => chat.handleSendMessage(undefined, s.query)}
                    className="px-3 py-1.5 text-xs bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/70 transition-all cursor-pointer animate-fade-in-up inline-flex items-center gap-1.5"
                    style={{ animationDelay: `${i * 50}ms` }}>
                    {s.icon}<span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chat.messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} animate-fade-in-up`}>
                <div className="max-w-2xl w-full flex flex-col">
                  {msg.sender === "user" ? (
                    <div className="bg-foreground text-background border border-foreground/10 rounded-2xl px-4 py-2.5 text-xs max-w-[80%] self-end shadow-sm">{msg.text}</div>
                  ) : (
                    <div className="flex flex-col gap-1 border-l border-border pl-4 py-0.5">
                      {msg.agentName && <span className="text-[9px] text-foreground/50 font-bold uppercase tracking-wider">{msg.agentName}</span>}
                      <div className="text-foreground/90 text-xs">
                        {formatMessageText(msg.text)}
                        {msg.text === "" && (
                          <div className="flex gap-1 items-center py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-[bounce_1s_infinite]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-[bounce_1s_infinite_0.2s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-[bounce_1s_infinite_0.4s]" />
                          </div>
                        )}
                      </div>
                      {msg.text && !chat.isChatLoading && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <button onClick={() => chat.handleFeedback(msg.id, "positive")}
                            className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${chat.feedbackState[msg.id] === "positive" ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/30" : "text-foreground/40 hover:text-emerald-500 hover:bg-emerald-500/5 border border-transparent"}`}
                            title="Сайн хариуллаа" disabled={!!chat.feedbackState[msg.id]}>
                            <ThumbsUp className="w-3 h-3" />
                          </button>
                          <button onClick={() => chat.handleFeedback(msg.id, "negative")}
                            className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${chat.feedbackState[msg.id] === "negative" ? "text-red-500 bg-red-500/10 border border-red-500/30" : "text-foreground/40 hover:text-red-500 hover:bg-red-500/5 border border-transparent"}`}
                            title="Буруу хариуллаа" disabled={!!chat.feedbackState[msg.id]}>
                            <ThumbsDown className="w-3 h-3" />
                          </button>
                          {chat.feedbackSentMsgs[msg.id] && chat.feedbackState[msg.id] && (
                            <span className="text-[9px] text-foreground/50 ml-1">{chat.feedbackSentMsgs[msg.id]}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {chat.messages.length > 0 && chat.lastAgentType && !chat.isChatLoading && (() => {
            const suggestions = Array.isArray(followUpSuggestions)
              ? followUpSuggestions
              : followUpSuggestions[chat.lastAgentType];
            if (!suggestions || suggestions.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-2 justify-start max-w-2xl pt-2">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => chat.handleSendMessage(undefined, s.query)}
                    className="px-2.5 py-1 text-[10px] bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/50 transition-all cursor-pointer animate-fade-in-up"
                    style={{ animationDelay: `${i * 50}ms` }}>{s.label}</button>
                ))}
              </div>
            );
          })()}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput
          input={chat.input} isChatLoading={chat.isChatLoading} streamEnabled={chat.streamEnabled}
          isGraphicModeEnabled={isGraphicModeEnabled} threadId={threadId}
          onInputChange={chat.setInput} onStreamEnabledChange={chat.setStreamEnabled}
          onGraphicModeToggle={() => setIsGraphicModeEnabled(!isGraphicModeEnabled)}
          onSubmit={(e: React.FormEvent) => { chat.handleSendMessage(e); }} onCancel={chat.handleCancelMessage}
        />
      </section>
    </main>
  );
};

export const AskTab = React.memo(AskTabInner);
