"use client";

import React, { useState } from "react";

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|ADD|COLUMN|INDEX|VIEW|WITH|RECURSIVE|CASE|WHEN|THEN|ELSE|END|CAST|COALESCE|NULLIF|DISTINCT|ALL|UNION|INTERSECT|EXCEPT|EXISTS|BETWEEN|LIKE|ILIKE|IS|NULL|TRUE|FALSE|COUNT|SUM|AVG|MIN|MAX|STDDEV|VARIANCE|PERCENTILE_CONT|ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|FIRST_VALUE|LAST_VALUE|NTH_VALUE|OVER|PARTITION|DATE_TRUNC|EXTRACT|DATE_PART|TO_DATE|TO_CHAR|NOW|CURRENT_DATE|CURRENT_TIMESTAMP|INTERVAL|TIMESTAMP|DATE|ASC|DESC|NULLS\s+(FIRST|LAST))\b/gi;

export const CodeBlock = ({ code, language, defaultExpanded = false }: { code: string; language?: string; defaultExpanded?: boolean }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const lang = (language || "").toLowerCase();
  const isSql = lang === "sql";
  const rows = code.split("\n").length;

  const highlightSql = (text: string) => {
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    const sqlRegex = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|WITH|RECURSIVE|CASE|WHEN|THEN|ELSE|END|CAST|COALESCE|NULLIF|DISTINCT|ALL|UNION|INTERSECT|EXCEPT|EXISTS|BETWEEN|LIKE|ILIKE|IS\s+(NOT\s+)?NULL|TRUE|FALSE|COUNT|SUM|AVG|MIN|MAX|STDDEV|PERCENTILE_CONT|ROW_NUMBER|RANK|DATE_TRUNC|EXTRACT|TO_DATE|TO_CHAR|NOW|CURRENT_DATE|CURRENT_TIMESTAMP|INTERVAL|ASC|DESC)\b/gi;
    while ((m = sqlRegex.exec(text)) !== null) {
      if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
      parts.push(<span key={m.index} className="text-blue-400 font-semibold">{m[0]}</span>);
      lastIdx = sqlRegex.lastIndex;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return parts.length > 0 ? parts : text;
  };

  return (
    <div className="bg-sidebar border border-border/80 rounded-lg mt-2 mb-3 transition-colors overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-background/30 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-foreground/50">{language || "Code"}</span>
          <span className="text-[8px] text-foreground/30 font-mono">{rows} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="text-[9px] px-1.5 py-0.5 text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 rounded transition-all cursor-pointer"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[9px] px-1.5 py-0.5 text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 rounded transition-all cursor-pointer"
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>
      <div className={`transition-all duration-200 ${expanded ? "max-h-[600px]" : "max-h-24"} overflow-auto`}>
        <pre className="text-[10px] font-mono leading-relaxed p-3 overflow-x-auto whitespace-pre-wrap break-all">
          {isSql
            ? code.split("\n").map((line, i) => (
                <div key={i} className="flex">
                  <span className="text-foreground/20 w-6 shrink-0 text-right mr-2 select-none">{i + 1}</span>
                  <span className="flex-1">{highlightSql(line) || <br />}</span>
                </div>
              ))
            : code}
        </pre>
      </div>
      {!expanded && rows > 4 && (
        <div className="px-3 py-1.5 border-t border-border/30 text-center">
          <button
            onClick={() => setExpanded(true)}
            className="text-[9px] text-blue-400/70 hover:text-blue-400 transition-colors cursor-pointer"
          >
            Show all {rows} lines
          </button>
        </div>
      )}
    </div>
  );
};
