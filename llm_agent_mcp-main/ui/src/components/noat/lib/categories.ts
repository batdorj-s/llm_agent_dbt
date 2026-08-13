import type { Category } from '../api/types'

export interface CategoryMeta {
  key: Category
  label: string
  shortLabel: string
  /** Tailwind класс: text-* + bg-*-soft хослол */
  textClass: string
  softClass: string
  borderClass: string
  dotClass: string
  /** Recharts-д хэрэглэх hex өнгө */
  hex: string
  description: string
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  matched: {
    key: 'matched',
    label: 'Таарсан',
    shortLabel: 'Таарсан',
    textClass: 'text-noat-success',
    softClass: 'bg-noat-success-soft',
    borderClass: 'border-noat-success/40',
    dotClass: 'bg-noat-success',
    hex: '#22c55e',
    description: 'ДДТД эсвэл дүн-огноо яг таарсан гүйлгээ',
  },
  aggregate_matched: {
    key: 'aggregate_matched',
    label: 'Нийгтлэн таарсан',
    shortLabel: 'Нийгтлэн',
    textClass: 'text-noat-teal',
    softClass: 'bg-noat-teal-soft',
    borderClass: 'border-noat-teal/40',
    dotClass: 'bg-noat-teal',
    hex: '#14b8a6',
    description: 'Нэг дотоод мөр = хэдэн И-баримтын нийлбэрт таарсан',
  },
  ai_suggested: {
    key: 'ai_suggested',
    label: 'AI санал болгосон',
    shortLabel: 'AI санал',
    textClass: 'text-noat-accent',
    softClass: 'bg-noat-accent/15',
    borderClass: 'border-noat-accent/40',
    dotClass: 'bg-noat-accent',
    hex: '#a78bfa',
    description: 'AI fuzzy матчаар санал болгосон, хэрэглэгч баталгаажуулах шаардлагатай',
  },
  missing_in_ebarimt: {
    key: 'missing_in_ebarimt',
    label: 'И-баримтад байхгүй',
    shortLabel: 'И-баримтад байхгүй',
    textClass: 'text-noat-danger',
    softClass: 'bg-noat-danger-soft',
    borderClass: 'border-noat-danger/40',
    dotClass: 'bg-noat-danger',
    hex: '#ef4444',
    description: 'Дотоод бүртгэлд байгаа боловч И-баримтын системд олдсонгүй',
  },
  missing_in_internal: {
    key: 'missing_in_internal',
    label: 'Дотоод бүртгэлд байхгүй',
    shortLabel: 'Дотоодод байхгүй',
    textClass: 'text-noat-warning',
    softClass: 'bg-noat-warning-soft',
    borderClass: 'border-noat-warning/40',
    dotClass: 'bg-noat-warning',
    hex: '#f59e0b',
    description: 'И-баримтад байгаа боловч дотоод бүртгэлд олдсонгүй',
  },
  needs_review: {
    key: 'needs_review',
    label: 'Хянах шаардлагатай',
    shortLabel: 'Хянах шаардлагатай',
    textClass: 'text-noat-warning',
    softClass: 'bg-noat-warning-soft',
    borderClass: 'border-noat-warning/40',
    dotClass: 'bg-noat-warning',
    hex: '#fbbf24',
    description: 'ДДТД таарсан ч дүн/огноо зөрүүтэй — хүний хяналт шаардлагатай',
  },
}

export const CATEGORY_ORDER: Category[] = [
  'matched',
  'aggregate_matched',
  'ai_suggested',
  'needs_review',
  'missing_in_ebarimt',
  'missing_in_internal',
]

export const MATCH_STAGE_LABEL: Record<string, string> = {
  exact: 'Яг таарсан',
  ddtd_exact: 'ДДТД таарсан',
  tolerance: 'Хүлцэлтэй таарсан',
  aggregate: 'Нийгтлэн таарсан',
  ai_fuzzy: 'AI санал',
  none: 'Тохироогүй',
}

export const SOURCE_LABEL: Record<string, string> = {
  internal: 'Дотоод бүртгэл',
  ebarimt: 'И-баримт',
}

/** risk_score → харагдацын meta (0-100) */
export function riskLevel(score: number): { label: string; textClass: string; softClass: string } {
  if (score >= 70)
    return { label: 'Өндөр эрсдэл', textClass: 'text-noat-danger', softClass: 'bg-noat-danger-soft' }
  if (score >= 40)
    return { label: 'Дунд эрсдэл', textClass: 'text-noat-warning', softClass: 'bg-noat-warning-soft' }
  return { label: 'Бага эрсдэл', textClass: 'text-noat-success', softClass: 'bg-noat-success-soft' }
}

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as Category] ?? {
    key: 'needs_review',
    label: category,
    shortLabel: category,
    textClass: 'text-noat-text-secondary',
    softClass: 'bg-noat-surface-alt',
    borderClass: 'border-noat-border',
    dotClass: 'bg-text-muted',
    hex: '#94a3b8',
    description: '',
  }
}
