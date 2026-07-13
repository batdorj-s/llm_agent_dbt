"use client";

import React, { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Message } from "./types";
import { VisualMessage, DashboardMessage, VisualGrid } from "./VisualMessage";
import { CodeBlock } from "./CodeBlock";
import { ActionCard } from "./ActionCard";
import { Copy, Check, RefreshCw } from "lucide-react";

// #16: ErrorBoundary for individual messages
interface ErrorBoundaryState { hasError: boolean; error: Error | null }
class MessageErrorBoundary extends React.Component<{ children: React.ReactNode; onRetry?: () => void }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 my-2 text-xs">
          <p className="text-red-600 dark:text-red-400 font-medium">Энэ хариултыг үзүүлэхэд алдаа гарлаа.</p>
          <p className="text-red-500 dark:text-red-300 mt-1 text-[10px]">{this.state.error?.message}</p>
          {this.props.onRetry && (
            <button onClick={() => { this.setState({ hasError: false, error: null }); this.props.onRetry!(); }}
              className="mt-2 flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 hover:underline cursor-pointer">
              <RefreshCw className="w-3 h-3" /> Дахин оролдох
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

function parseCodeBlocks(text: string): { type: "text" | "sql" | "json" | "code"; content: string; language?: string }[] {
  const results: { type: "text" | "sql" | "json" | "code"; content: string; language?: string }[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      results.push({ type: "text", content: text.slice(lastIdx, match.index) });
    }
    const lang = match[1].toLowerCase();
    const code = match[2].trim();
    if (lang === "sql") {
      results.push({ type: "sql", content: code, language: "sql" });
    } else if (lang === "json") {
      results.push({ type: "json", content: code, language: "json" });
    } else {
      results.push({ type: "code", content: code, language: match[1] || "code" });
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    results.push({ type: "text", content: text.slice(lastIdx) });
  }
  return results;
}

// #5: Markdown renderer using react-markdown
function MarkdownContent({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="text-foreground/80 leading-relaxed my-1 text-xs">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic text-foreground/70">{children}</em>,
        code: ({ children, className }) => {
          const isInline = !className;
          if (isInline) return <code className="bg-foreground/10 px-1 py-0.5 rounded text-[10px] font-mono">{children}</code>;
          return <code className={className}>{children}</code>;
        },
        ul: ({ children }) => <ul className="ml-4 list-disc space-y-0.5 my-1">{children}</ul>,
        ol: ({ children }) => <ol className="ml-4 list-decimal space-y-0.5 my-1">{children}</ol>,
        li: ({ children }) => <li className="text-foreground/80 text-xs">{children}</li>,
        h3: ({ children }) => <h3 className="text-[11px] font-bold text-foreground/70 mt-3 mb-1">{children}</h3>,
        h4: ({ children }) => <h4 className="text-[11px] font-bold text-foreground/70 mt-3 mb-1">{children}</h4>,
        table: ({ children }) => <div className="overflow-x-auto my-2"><table className="w-full text-[10px] border-collapse">{children}</table></div>,
        thead: ({ children }) => <thead className="border-b border-border/30">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-border/20">{children}</tr>,
        th: ({ children }) => <th className="text-left py-1 px-2 font-medium text-foreground/60">{children}</th>,
        td: ({ children }) => <td className="py-1 px-2 text-foreground/80">{children}</td>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-foreground/20 pl-3 my-2 text-foreground/60 italic">{children}</blockquote>,
        hr: () => <hr className="my-3 border-border/30" />,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{children}</a>,
      }}
    >
      {content}
    </Markdown>
  );
}

function renderTextBlock(text: string, key: string | number) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    if (line.startsWith("(Finance Agent)") || line.startsWith("(Tech Agent)") || line.startsWith("(Data Scientist Agent)")) {
      continue;
    }

    if (/^### (Оролдлого|Гүйцэтгэлийн үр дүн)/.test(line.trim())) {
      continue;
    }
    if (/^\*?\s*(Үр\s*дүн|Result|Output)\s*[:：]?\s*\*?$/.test(line.trim())) {
      continue;
    }

    const isTableRow = line.trim().startsWith("|") && line.trim().endsWith("|") && line.includes("|", 2);
    if (isTableRow) {
      if (line.includes("---")) continue;
      const cells = line.split("|").filter(c => c.trim()).map(c => c.trim());
      if (cells.length > 0) {
        elements.push(
          <div key={`${key}-t${lineIdx}`} className="flex gap-2 text-[10px] text-foreground/80 font-mono border-b border-border/20 py-0.5">
            {cells.map((c, ci) => (
              <span key={ci} className="flex-1 truncate">{c}</span>
            ))}
          </div>
        );
        continue;
      }
    }

    let content: React.ReactNode = line;
    const isBullet = line.startsWith("- ") || line.startsWith("* ");
    const cleanLine = isBullet ? line.substring(2) : line;
    const headerMatch = cleanLine.match(/^###\s+(.+)/);
    const isHeader = !!headerMatch;

    const boldRegex = new RegExp("\\*\\*(.*?)\\*\\*", "g");
    const boldParts: React.ReactNode[] = [];
    let lastIdx = 0;
    let match;

    while ((match = boldRegex.exec(cleanLine)) !== null) {
      const textBefore = cleanLine.substring(lastIdx, match.index);
      const boldText = match[1];
      if (textBefore) boldParts.push(textBefore);
      boldParts.push(<strong key={match.index} className="font-semibold text-foreground">{boldText}</strong>);
      lastIdx = boldRegex.lastIndex;
    }

    const textAfter = cleanLine.substring(lastIdx);
    if (textAfter) boldParts.push(textAfter);
    content = boldParts.length > 0 ? boldParts : cleanLine;

    if (isBullet) {
      elements.push(
        <li key={`${key}-${lineIdx}`} className="ml-4 list-disc text-foreground/80 my-1 text-xs">{content}</li>
      );
    } else if (isHeader && headerMatch) {
      elements.push(
        <h4 key={`${key}-${lineIdx}`} className="text-[11px] font-bold text-foreground/70 mt-3 mb-1">{headerMatch[1]}</h4>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={`${key}-${lineIdx}`} className="h-2" />);
    } else {
      elements.push(
        <p key={`${key}-${lineIdx}`} className="text-foreground/80 leading-relaxed my-0.5 text-xs">{content}</p>
      );
    }
  }
  return elements;
}

export function formatMessageText(text: string) {
  if (!text) return "";

  const tagPattern = new RegExp("(<(?:visual|dashboard)>[\\s\\S]*?<\\/(?:visual|dashboard)>)", "g");
  const parts = text.split(tagPattern);

  // Group consecutive visual/dashboard parts into visual groups for grid layout
  const visualGroups: string[][] = [];
  const nonVisualParts: { part: string; index: number }[] = [];
  let currentGroup: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("<visual>") || p.startsWith("<dashboard>")) {
      currentGroup.push(p);
    } else {
      if (currentGroup.length > 0) {
        visualGroups.push(currentGroup);
        currentGroup = [];
      }
      if (p.trim()) {
        nonVisualParts.push({ part: p, index: i });
      }
    }
  }
  if (currentGroup.length > 0) {
    visualGroups.push(currentGroup);
  }

  // Merge visual groups into nonVisualParts for rendering
  const renderedParts: { type: "visual" | "text"; visualParts?: string[]; part?: string; idx: number }[] = [];
  let vgIdx = 0;
  for (const nvp of nonVisualParts) {
    while (vgIdx < visualGroups.length) {
      const firstVisualIdx = parts.indexOf(visualGroups[vgIdx][0]);
      if (firstVisualIdx < nvp.index) {
        renderedParts.push({ type: "visual", visualParts: visualGroups[vgIdx], idx: firstVisualIdx });
        vgIdx++;
      } else {
        break;
      }
    }
    renderedParts.push({ type: "text", part: nvp.part, idx: nvp.index });
  }
  while (vgIdx < visualGroups.length) {
    const firstVisualIdx = parts.indexOf(visualGroups[vgIdx][0]);
    renderedParts.push({ type: "visual", visualParts: visualGroups[vgIdx], idx: firstVisualIdx });
    vgIdx++;
  }

  return renderedParts.map((rp) => {
    if (rp.type === "visual" && rp.visualParts) {
      const visuals = rp.visualParts.map((vp) => {
        if (vp.startsWith("<visual>")) {
          const jsonContent = vp.replace(/<\/?visual>/g, "");
          return { type: "visual" as const, json: jsonContent };
        }
        if (vp.startsWith("<dashboard>")) {
          const jsonContent = vp.replace(/<\/?dashboard>/g, "");
          return { type: "dashboard" as const, json: jsonContent };
        }
        return null;
      }).filter(Boolean) as { type: "visual" | "dashboard"; json: string }[];

      if (visuals.length === 1 && visuals[0].type === "visual") {
        return <VisualMessage key={`vg-${rp.idx}`} visualJson={visuals[0].json} />;
      }
      if (visuals.length === 1 && visuals[0].type === "dashboard") {
        return <DashboardMessage key={`vg-${rp.idx}`} dashboardJson={visuals[0].json} />;
      }
      return <VisualGrid key={`vg-${rp.idx}`} items={visuals} />;
    }

    const part = rp.part!;
    const segments = parseCodeBlocks(part);
    if (segments.length === 1 && segments[0].type === "text") {
      // #5: Use react-markdown for text segments
      return <div key={`md-${rp.idx}`}><MarkdownContent content={segments[0].content} /></div>;
    }

    const grouped: { type: "action" | "text" | "json" | "code"; content?: string; language?: string; sql?: string; json?: string; text?: string }[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === "sql") {
        let jsonSeg: (typeof segments)[0] | null = null;
        let skipIdx = i + 1;
        while (skipIdx < segments.length) {
          const next = segments[skipIdx];
          if (next.type === "json") { jsonSeg = next; break; }
          if (next.type === "text" && /^\s*(\*?Үр\s*дүн|Result|Output)\*?\s*[:：]?\s*$/.test(next.content.trim())) {
            skipIdx++;
            continue;
          }
          break;
        }
        if (jsonSeg) {
          grouped.push({ type: "action", sql: seg.content, json: jsonSeg.content });
          i = skipIdx;
        } else {
          grouped.push({ type: "action", sql: seg.content });
        }
      } else {
        grouped.push({ type: seg.type, text: seg.content, language: seg.language });
      }
    }

    const actionMatch = part.match(/(?:Ажиллагаа|Үйлдэл|Шинжилгээ|Тооцоолол)[：:]\s*([^\n]+)/i);
    const actionDesc = actionMatch ? actionMatch[1].trim() : "Өгөгдлийн шинжилгээ";

    return grouped.map((seg, segIdx) => {
      if (seg.type === "text") {
        // #5: Use react-markdown for text segments in grouped output
        return <div key={`${rp.idx}-${segIdx}`}><MarkdownContent content={seg.text || ""} /></div>;
      }
      if (seg.type === "action") {
        return (
          <ActionCard
            key={`${rp.idx}-action-${segIdx}`}
            action={actionDesc}
            status={["SQL Query Executed", "Data Aggregated"]}
            sql={seg.sql}
            result={seg.json}
          />
        );
      }
      if (seg.type === "json") {
        return (
          <div key={`${rp.idx}-code-${segIdx}`} className="mt-2 mb-3">
            <CodeBlock code={seg.text || ""} language="json" />
          </div>
        );
      }
      if (seg.type === "code") {
        return (
          <div key={`${rp.idx}-code-${segIdx}`} className="mt-2 mb-3">
            <CodeBlock code={seg.text || ""} language={seg.language || "code"} />
          </div>
        );
      }
      return null;
    });
  });
}

// #3, #4: Copy button and timestamp component
function MessageActions({ text, timestamp, onRetry, isError }: { text: string; timestamp?: Date; onRetry?: () => void; isError?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {/* #4: Timestamp */}
      {timestamp && (
        <span className="text-[9px] text-foreground/30">{formatTime(timestamp)}</span>
      )}
      {/* #3: Copy button */}
      <button onClick={handleCopy}
        className="flex items-center gap-1 text-[9px] text-foreground/30 hover:text-foreground/60 transition-colors cursor-pointer"
        title="Хариултыг хуулах">
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        {copied && <span className="text-green-500">Хуулагдлаа</span>}
      </button>
      {/* #1: Retry button on errors */}
      {isError && onRetry && (
        <button onClick={onRetry}
          className="flex items-center gap-1 text-[9px] text-foreground/30 hover:text-foreground/60 transition-colors cursor-pointer"
          title="Дахин илгээх">
          <RefreshCw className="w-3 h-3" /> Дахин оролдох
        </button>
      )}
    </div>
  );
}

// Main export: ChatMessage with ErrorBoundary wrapper
export function ChatMessageComponent({ message, feedbackState, feedbackSentMsgs, onFeedback, onRetry }: {
  message: Message;
  feedbackState?: Record<string, "positive" | "negative" | null>;
  feedbackSentMsgs?: Record<string, string>;
  onFeedback?: (msgId: string, rating: "positive" | "negative") => void;
  onRetry?: (messageId: string) => void;
}) {
  return (
    <MessageErrorBoundary onRetry={onRetry ? () => onRetry(message.id) : undefined}>
      <ChatMessageInner
        message={message}
        feedbackState={feedbackState}
        feedbackSentMsgs={feedbackSentMsgs}
        onFeedback={onFeedback}
        onRetry={onRetry}
      />
    </MessageErrorBoundary>
  );
}

function ChatMessageInner({ message, feedbackState, feedbackSentMsgs, onFeedback, onRetry }: {
  message: Message;
  feedbackState?: Record<string, "positive" | "negative" | null>;
  feedbackSentMsgs?: Record<string, string>;
  onFeedback?: (msgId: string, rating: "positive" | "negative") => void;
  onRetry?: (messageId: string) => void;
}) {
  const isUser = message.sender === "user";
  const isAgent = message.sender === "agent";

  return (
    <div className={`group flex flex-col ${isUser ? "items-end" : "items-start"} mb-4`}>
      {/* Agent name label */}
      {isAgent && message.agentName && (
        <span className="text-[9px] text-foreground/40 mb-1 ml-1 font-medium">{message.agentName}</span>
      )}

      {/* Message bubble */}
      <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
        isUser
          ? "bg-foreground text-background rounded-br-sm"
          : message.isError
            ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-bl-sm"
            : "bg-sidebar border border-border rounded-bl-sm"
      }`}>
        {isUser ? (
          <p className="text-xs whitespace-pre-wrap">{message.text}</p>
        ) : (
          <div className="text-xs">{formatMessageText(message.text)}</div>
        )}
      </div>

      {/* #3, #4: Actions row (copy, timestamp, retry) */}
      {isAgent && message.text && (
        <MessageActions
          text={message.text}
          timestamp={message.timestamp}
          isError={message.isError}
          onRetry={onRetry ? () => onRetry(message.id) : undefined}
        />
      )}

      {/* Feedback buttons */}
      {isAgent && !message.isError && message.id !== "welcome" && onFeedback && (
        <div className="flex items-center gap-1 mt-1 ml-1">
          {feedbackSentMsgs?.[message.id] ? (
            <span className="text-[10px] text-green-500 font-medium">{feedbackSentMsgs[message.id]} Илгээгдлээ</span>
          ) : (
            <>
              <button onClick={() => onFeedback(message.id, "positive")}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  feedbackState?.[message.id] === "positive"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600"
                    : "text-foreground/30 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20"
                }`} title="Сайн">
                👍
              </button>
              <button onClick={() => onFeedback(message.id, "negative")}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  feedbackState?.[message.id] === "negative"
                    ? "bg-red-100 dark:bg-red-900/30 text-red-600"
                    : "text-foreground/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                }`} title="Муу">
                👎
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Keep backward-compatible export
export const ChatMessage = ChatMessageComponent;
