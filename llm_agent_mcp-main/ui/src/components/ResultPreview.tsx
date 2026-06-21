"use client";

import React from "react";

export const ResultPreview = ({ jsonStr }: { jsonStr: string }) => {
  let data: any[];
  try {
    data = JSON.parse(jsonStr);
    if (!Array.isArray(data)) throw new Error("Not array");
  } catch {
    return <pre className="text-[10px] font-mono text-foreground/60 p-2 bg-background/30 rounded max-h-32 overflow-auto">{jsonStr}</pre>;
  }
  if (data.length === 0) return <div className="text-[10px] text-foreground/40 italic">Empty result</div>;
  const keys = Object.keys(data[0]);
  return (
    <div className="overflow-auto max-h-48 rounded border border-border/50">
      <table className="w-full text-[9px] border-collapse">
        <thead>
          <tr className="bg-background/50 sticky top-0">
            {keys.map(k => (
              <th key={k} className="text-left px-2 py-1 font-bold text-foreground/50 border-b border-border uppercase tracking-wider">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 10).map((row, i) => (
            <tr key={i} className="hover:bg-background/30 transition-colors">
              {keys.map(k => (
                <td key={k} className="px-2 py-1 border-b border-border/20 text-foreground/70 truncate max-w-[120px]">{String(row[k] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 10 && (
        <div className="px-2 py-1 text-[8px] text-foreground/30 text-center border-t border-border/30">
          {data.length - 10} more rows...
        </div>
      )}
    </div>
  );
};
