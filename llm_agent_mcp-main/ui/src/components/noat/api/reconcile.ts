import { API_BASE, parseError, request } from './client'
import type {
  AiExplainResponse,
  FilePreviewInfo,
  JobStatus,
  PreviewResponse,
  ReconcileParams,
  ReconcileResult,
} from './types'

/** Multipart FormData-д файлуудыг хавсаргах туслах */
function filesToFormData(internal: File, ebarimt: File, params: ReconcileParams): FormData {
  const fd = new FormData()
  fd.append('internal_file', internal)
  fd.append('ebarimt_file', ebarimt)
  fd.append('tolerance_amount', String(params.toleranceAmount))
  fd.append('tolerance_days', String(params.toleranceDays))
  fd.append('enable_ai_matching', String(params.enableAi))
  if (params.dateFrom) fd.append('date_from', params.dateFrom)
  if (params.dateTo) fd.append('date_to', params.dateTo)
  return fd
}

export async function previewFiles(internal: File, ebarimt: File): Promise<PreviewResponse> {
  const fd = filesToFormData(internal, ebarimt, {
    toleranceAmount: 5,
    toleranceDays: 1,
    enableAi: true,
  })
  return request<PreviewResponse>('/preview', { method: 'POST', body: fd })
}

export async function startReconcile(
  internal: File,
  ebarimt: File,
  params: ReconcileParams,
): Promise<{ job_id: string }> {
  const fd = filesToFormData(internal, ebarimt, params)
  return request<{ status: string; job_id: string }>('/reconcile', { method: 'POST', body: fd })
}

export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  return request<JobStatus>(`/status/${jobId}`)
}

export async function fetchResult(jobId: string): Promise<ReconcileResult> {
  return request<ReconcileResult>(`/result/${jobId}`)
}

export async function exportExcel(jobId: string): Promise<Blob> {
  const fd = new FormData()
  fd.append('job_id', jobId)
  const res = await fetch(`${API_BASE}/export`, { method: 'POST', body: fd })
  if (!res.ok) throw await parseError(res)
  return res.blob()
}

export async function explainRow(record: Record<string, unknown>): Promise<AiExplainResponse> {
  return request<AiExplainResponse>('/ai/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record }),
  })
}

export function previewFromFiles(
  internalInfo: FilePreviewInfo | null,
  ebarimtInfo: FilePreviewInfo | null,
): PreviewResponse {
  return {
    status: 'ok',
    files: {
      internal: internalInfo ?? { columns: {}, row_count: 0, date_range: [null, null], total_amount: 0, warnings: [], issues: [] },
      ebarimt: ebarimtInfo ?? { columns: {}, row_count: 0, date_range: [null, null], total_amount: 0, warnings: [], issues: [] },
    },
  }
}
