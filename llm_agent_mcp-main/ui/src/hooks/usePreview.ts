"use client";

import { useState, useRef } from "react";
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

export function usePreview() {
  const [preview, setPreview] = useState<PreviewState>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const open = async (file: UploadedFile) => {
    // Cancel any in-flight preview request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/files/${file.id}/preview`, { signal: controller.signal });
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
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("Failed to view file", e);
    } finally {
      setIsLoading(false);
    }
  };

  const openRaw = (partial: Partial<PreviewState>) => {
    setPreview({ ...EMPTY, ...partial });
  };

  const close = () => {
    abortRef.current?.abort();
    setPreview(EMPTY);
    setIsLoading(false);
  };

  return { preview, isLoading, open, openRaw, close };
}
