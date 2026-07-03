"use client";

import { useState } from "react";
import type { UploadedFile } from "../components/types";

export interface PreviewState {
  data: Record<string, unknown>[] | null;
  columns: string[];
  tableName: string;
  description: string | null;
  content: string | null;
  hasDownload: boolean;
  fileId: string | null;
}

const EMPTY: PreviewState = {
  data: null, columns: [], tableName: "", description: null, content: null, hasDownload: false, fileId: null,
};

export function usePreview(token: string | null) {
  const [preview, setPreview] = useState<PreviewState>(EMPTY);

  const open = async (file: UploadedFile) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/files/${file.id}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = `Preview failed (${res.status})`;
        try { const b = await res.json(); if (b.error) msg += `: ${b.error}`; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setPreview({
        data: data.preview ?? null,
        columns: data.columns ?? [],
        tableName: data.tableName ?? file.filename,
        description: data.description ?? null,
        content: data.content ?? null,
        hasDownload: data.hasDownload === true,
        fileId: file.id,
      });
    } catch (e) {
      console.error("Failed to view file", e);
    }
  };

  const openRaw = (partial: Partial<PreviewState>) => {
    setPreview({ ...EMPTY, ...partial });
  };

  const close = () => setPreview(EMPTY);

  return { preview, open, openRaw, close };
}
