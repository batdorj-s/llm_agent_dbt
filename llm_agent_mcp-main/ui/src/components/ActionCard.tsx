"use client";

import React, { useState } from "react";
import { CodeBlock } from "./CodeBlock";
import { ResultPreview } from "./ResultPreview";

export const ActionCard = ({ action, status, sql, result, children }: {
  action: string;
  status?: string[];
  sql?: string;
  result?: string;
  children?: React.ReactNode;
}) => {
  const [showSql, setShowSql] = useState(false);

  return (
    <div className="bg-gradient-to-br from-sidebar to-background border border-border/80 rounded-xl mt-2 mb-3 shadow-sm overflow-hidden">
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <span className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider truncate">{action}</span>
        </div>
        {status && status.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {status.map((s, i) => (
              <span key={i} className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">{s}</span>
            ))}
          </div>
        )}
      </div>
      {sql && (
        <div className="border-b border-border/30">
          <button
            onClick={() => setShowSql(!showSql)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[9px] text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 transition-colors cursor-pointer"
          >
            <span>SQL Query {showSql ? "▲" : "▼"}</span>
          </button>
          {showSql && (
            <div className="px-3 pb-2">
              <CodeBlock code={sql} language="sql" defaultExpanded />
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="px-3 py-2">
          <ResultPreview jsonStr={result} />
        </div>
      )}
      {children && <div className="px-3 py-2">{children}</div>}
    </div>
  );
};
