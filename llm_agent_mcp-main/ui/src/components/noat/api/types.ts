/** Backend API-ийн төрлүүд (backend/main.py + engine-тэй нийцнэ) */

export type Category =
  | 'matched'
  | 'aggregate_matched'
  | 'ai_suggested'
  | 'missing_in_ebarimt'
  | 'missing_in_internal'
  | 'needs_review'

export type Source = 'internal' | 'ebarimt'

export interface ItemRow {
  row_id: number
  source: Source
  category: Category
  match_stage: string
  matched_with: number | null
  delta_amount: number
  delta_days: number
  note: string
  tags: string[]
  risk_score: number
  ai_suggestion?: string
  ai_confidence?: number
  doc_id: string | null
  registry: string | null
  date: string | null
  amount: number | null
  vat: number | null
  company_name: string | null
  tax_type: string | null
  invoice_no: string | null
  status?: string | null
}

export interface FilePreviewInfo {
  columns: Record<string, string>
  row_count: number
  date_range: [string | null, string | null]
  total_amount: number
  warnings: string[]
  issues: { row: number; field: string; issue_type: string; message: string }[]
}

export interface PreviewResponse {
  status: string
  files: {
    internal: FilePreviewInfo
    ebarimt: FilePreviewInfo
  }
}

export interface JobStatus {
  status: 'queued' | 'processing' | 'done' | 'error'
  progress?: number
  stage?: string
  message?: string
  error_code?: string
}

export interface Summary {
  total_matched_count: number
  aggregate_matched_count: number
  ai_matched_count: number
  missing_in_ebarimt_count: number
  missing_in_internal_count: number
  needs_review_count: number
  ai_available: boolean
}

export interface Balance {
  internal_total: number
  internal_matched: number
  internal_remaining: number
  ebarimt_total: number
  ebarimt_matched: number
  ebarimt_remaining: number
}

export interface MonthAgg {
  month: string
  count: number
  total: number
  vat: number
}

export interface TaxTypeAgg {
  tax_type: string
  count: number
  total: number
  vat: number
}

export interface MonthlySummary {
  label: string
  months: MonthAgg[]
  tax_types: TaxTypeAgg[]
}

export interface CustomerComparisonRow {
  company_name: string
  internal_count: number
  internal_total: number
  ebarimt_count: number
  ebarimt_total: number
  diff: number
}

export interface VatReturn {
  total_vat: number
  accepted_vat: number
  review_vat: number
  acceptance_rate: number
}

export interface ReconcileResult {
  status: string
  progress?: number
  stage?: string
  message?: string
  error_code?: string
  summary: Summary
  data: { items: ItemRow[] }
  balance: Balance
  aggregate: {
    internal: MonthlySummary
    ebarimt: MonthlySummary
    customer_comparison: CustomerComparisonRow[]
    vat_return: VatReturn
  }
}

export interface AiExplainResponse {
  status: string
  explanation: string
  suggested_action: string
  confidence: number
  source?: string
  degraded?: boolean
}

export interface ReconcileParams {
  toleranceAmount: number
  toleranceDays: number
  enableAi: boolean
  dateFrom?: string
  dateTo?: string
}
