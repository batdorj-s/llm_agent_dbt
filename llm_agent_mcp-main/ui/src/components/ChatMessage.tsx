"use client";

import React from "react";
import { Message } from "./types";
import { VisualMessage, DashboardMessage } from "./VisualMessage";
import { CodeBlock } from "./CodeBlock";
import { ActionCard } from "./ActionCard";

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

  return parts.map((part, idx) => {
    if (part.startsWith("<visual>")) {
      const stripTag = new RegExp("<\\/?visual>", "g");
      const jsonContent = part.replace(stripTag, "");
      return <VisualMessage key={idx} visualJson={jsonContent} />;
    }
    if (part.startsWith("<dashboard>")) {
      const stripTag = new RegExp("<\\/?dashboard>", "g");
      const jsonContent = part.replace(stripTag, "");
      return <DashboardMessage key={idx} dashboardJson={jsonContent} />;
    }

    const segments = parseCodeBlocks(part);
    if (segments.length === 1 && segments[0].type === "text") {
      return renderTextBlock(segments[0].content, idx);
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
        return renderTextBlock(seg.text || "", `${idx}-${segIdx}`);
      }
      if (seg.type === "action") {
        return (
          <ActionCard
            key={`${idx}-action-${segIdx}`}
            action={actionDesc}
            status={["SQL Query Executed", "Data Aggregated"]}
            sql={seg.sql}
            result={seg.json}
          />
        );
      }
      if (seg.type === "json") {
        return (
          <div key={`${idx}-code-${segIdx}`} className="mt-2 mb-3">
            <CodeBlock code={seg.text || ""} language="json" />
          </div>
        );
      }
      if (seg.type === "code") {
        return (
          <div key={`${idx}-code-${segIdx}`} className="mt-2 mb-3">
            <CodeBlock code={seg.text || ""} language={seg.language || "code"} />
          </div>
        );
      }
      return null;
    });
  });
}
