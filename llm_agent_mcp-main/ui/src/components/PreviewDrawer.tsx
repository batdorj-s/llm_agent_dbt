"use client";

import React from "react";
import { X, FileText } from "lucide-react";

interface PreviewDrawerProps {
  previewData: Record<string, unknown>[] | null;
  previewColumns: string[];
  previewTableName: string;
  previewDescription: string | null;
  previewContent: string | null;
  previewHasDownload: boolean;
  previewFileId: string | null;
  onClose: () => void;
}

export const PreviewDrawer = ({
  previewData,
  previewColumns,
  previewTableName,
  previewDescription,
  previewContent,
  previewHasDownload,
  previewFileId,
  onClose,
}: PreviewDrawerProps) => {
  if (previewData === null) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[480px] border-l border-border bg-sidebar z-50 flex flex-col shadow-xl animate-slide-in-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider shrink-0">Preview</span>
          <h3 className="text-xs font-bold text-foreground/80 truncate">{previewTableName}</h3>
        </div>
        <button onClick={onClose} className="text-foreground/40 hover:text-foreground text-sm cursor-pointer leading-none p-1" title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {previewData.length > 0 ? (
        <div className="flex-1 overflow-auto p-3 animate-scale-in">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-background/50 sticky top-0">
                {previewColumns.map(c => (
                  <th key={c} className="text-left px-2 py-1.5 font-bold text-foreground/60 border-b border-border whitespace-nowrap text-[9px] uppercase tracking-wider">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewData.map((row, i) => (
                <tr key={i} className="hover:bg-background/40 transition-colors">
                  {previewColumns.map(c => (
                    <td key={c} className="px-2 py-1 border-b border-border/30 text-foreground/70 truncate max-w-[160px]">
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : previewContent ? (
        <div className="flex-1 overflow-auto p-4 space-y-3 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div className="flex gap-2 items-start">
              <FileText className="w-4 h-4 text-foreground/40 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-1">Document</p>
                <p className="text-xs text-foreground/80">{previewTableName}</p>
              </div>
            </div>
            {previewHasDownload && previewFileId && (
              <a href={`/api/admin/files/${previewFileId}/download`}
                className="text-[10px] px-2 py-1 bg-foreground/10 hover:bg-foreground/20 text-foreground/70 rounded transition-colors cursor-pointer no-underline inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Download
              </a>
            )}
          </div>
          {previewDescription && (
            <div className="border-t border-border pt-2">
              <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-1">Description</p>
              <p className="text-xs text-foreground/70 whitespace-pre-wrap">{previewDescription}</p>
            </div>
          )}
          <div className="border-t border-border pt-2">
            <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-1">Content</p>
            <div className="text-xs text-foreground/70 whitespace-pre-wrap font-mono bg-background/50 rounded p-3 max-h-[60vh] overflow-auto">
              {previewContent.length > 5000
                ? previewContent.substring(0, 5000) + "\n\n... (тасарсан, бүрэн эхээр нь татаж авах)"
                : previewContent}
            </div>
          </div>
        </div>
      ) : null}
      {previewData.length > 0 && (
        <div className="px-4 py-2 border-t border-border text-[9px] text-foreground/40 shrink-0 flex items-center justify-between">
          <span>{previewData.length} rows shown (first 20)</span>
        </div>
      )}
    </div>
  );
};
