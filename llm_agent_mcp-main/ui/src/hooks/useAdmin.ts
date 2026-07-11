"use client";

import { useState, useCallback } from "react";
import type { UploadedFile } from "../components/types";
import type { PreviewState } from "./usePreview";

export function useAdmin(onRefresh: () => void, onPreviewOpen: (p: Partial<PreviewState>) => void) {
  // KPI target
  const [adjustMetric, setAdjustMetric]         = useState<"sales" | "users" | "churn_rate">("sales");
  const [newTargetValue, setNewTargetValue]       = useState<number>(200_000_000);
  const [isUpdatingTarget, setIsUpdatingTarget]   = useState(false);
  const [salesUpdateSuccess, setSalesUpdateSuccess] = useState<string | null>(null);

  // CSV upload
  const [csvFile, setCsvFile]               = useState<File | null>(null);
  const [tableNameInput, setTableNameInput] = useState("");
  const [tableDescInput, setTableDescInput] = useState("");
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);
  const [csvUploadMessage, setCsvUploadMessage] = useState<string | null>(null);

  // Excel upload
  const [excelFile, setExcelFile]                       = useState<File | null>(null);
  const [excelTableNameInput, setExcelTableNameInput]   = useState("");
  const [excelDescInput, setExcelDescInput]             = useState("");
  const [isUploadingExcel, setIsUploadingExcel]         = useState(false);
  const [excelUploadMessage, setExcelUploadMessage]     = useState<string | null>(null);

  // Doc upload
  const [docFile, setDocFile]               = useState<File | null>(null);
  const [docDescInput, setDocDescInput]     = useState("");
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [docUploadMessage, setDocUploadMessage] = useState<string | null>(null);

  // File manager
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const fetchUploadedFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/files");
      if (res.ok) setUploadedFiles(await res.json());
    } catch {}
  }, []);

  const handleDeleteFile = async (id: string) => {
    if (!confirm("Are you sure you want to delete this asset?")) return;
    try {
      const res = await fetch(`/api/admin/files/${id}`, {
        method: "DELETE",
      });
      if (res.ok) { fetchUploadedFiles(); onRefresh(); }
    } catch {}
  };

  const handleUpdateKpiTarget = async () => {
    if (newTargetValue === undefined || isNaN(newTargetValue) || isUpdatingTarget) return;
    setIsUpdatingTarget(true); setSalesUpdateSuccess(null);
    try {
      const res = await fetch(`/api/kpi/${adjustMetric}/target`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: newTargetValue }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Update failed"); }
      setSalesUpdateSuccess("Target updated."); onRefresh();
    } catch (e: unknown) { setSalesUpdateSuccess(`Error: ${e instanceof Error ? e.message : e}`); }
    finally { setIsUpdatingTarget(false); }
  };

  const handleUploadCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile || !tableNameInput.trim() || !tableDescInput.trim() || isUploadingCsv) return;
    setIsUploadingCsv(true); setCsvUploadMessage(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvContent = event.target?.result as string;
      try {
        const res = await fetch("/api/admin/upload-csv", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: csvFile.name, csvContent, tableName: tableNameInput, description: tableDescInput }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setCsvUploadMessage(`Success: Table '${tableNameInput}' uploaded!`);
        if (data.preview) {
          onPreviewOpen({ data: data.preview, columns: data.columns ?? [], tableName: tableNameInput });
        }
        setCsvFile(null); setTableNameInput(""); setTableDescInput("");
        onRefresh(); fetchUploadedFiles();
      } catch (err: unknown) { setCsvUploadMessage(`Error: ${err instanceof Error ? err.message : err}`); }
      finally { setIsUploadingCsv(false); }
    };
    reader.onerror = () => { setCsvUploadMessage("Error reading file."); setIsUploadingCsv(false); };
    reader.readAsText(csvFile);
  };

  const handleUploadExcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excelFile || !excelTableNameInput.trim() || !excelDescInput.trim() || isUploadingExcel) return;
    setIsUploadingExcel(true); setExcelUploadMessage(null);
    const formData = new FormData();
    formData.append("file", excelFile);
    formData.append("tableName", excelTableNameInput);
    formData.append("description", excelDescInput);
    try {
      const res = await fetch("/api/admin/upload-excel", {
        method: "POST", body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setExcelUploadMessage(`Success: Table '${excelTableNameInput}' imported!`);
      if (data.preview) {
        onPreviewOpen({ data: data.preview, columns: data.columns ?? [], tableName: excelTableNameInput });
      }
      setExcelFile(null); setExcelTableNameInput(""); setExcelDescInput("");
      onRefresh(); fetchUploadedFiles();
    } catch (err: unknown) { setExcelUploadMessage(`Error: ${err instanceof Error ? err.message : err}`); }
    finally { setIsUploadingExcel(false); }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile || !docDescInput.trim() || isUploadingDoc) return;
    setIsUploadingDoc(true); setDocUploadMessage(null);
    const formData = new FormData();
    formData.append("file", docFile);
    formData.append("description", docDescInput);
    formData.append("category", "manual");
    formData.append("department", "general");
    try {
      const res = await fetch("/api/admin/upload-doc", {
        method: "POST", body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setDocUploadMessage(`Success: Document '${docFile.name}' indexed!`);
      setDocFile(null); setDocDescInput(""); fetchUploadedFiles();
    } catch (err: unknown) { setDocUploadMessage(`Error: ${err instanceof Error ? err.message : err}`); }
    finally { setIsUploadingDoc(false); }
  };

  return {
    // KPI target
    adjustMetric, setAdjustMetric, newTargetValue, setNewTargetValue,
    isUpdatingTarget, salesUpdateSuccess, handleUpdateKpiTarget,
    // CSV
    csvFile, setCsvFile, tableNameInput, setTableNameInput,
    tableDescInput, setTableDescInput, isUploadingCsv, csvUploadMessage, handleUploadCsv,
    // Excel
    excelFile, setExcelFile, excelTableNameInput, setExcelTableNameInput,
    excelDescInput, setExcelDescInput, isUploadingExcel, excelUploadMessage, handleUploadExcel,
    // Doc
    docFile, setDocFile, docDescInput, setDocDescInput,
    isUploadingDoc, docUploadMessage, handleUploadDoc,
    // Files
    uploadedFiles, fetchUploadedFiles, handleDeleteFile,
  };
}
