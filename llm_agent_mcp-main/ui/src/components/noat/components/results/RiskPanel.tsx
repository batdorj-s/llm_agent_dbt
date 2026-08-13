import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ItemRow } from '../../api/types'

interface RiskPanelProps {
  items: ItemRow[]
}

const ATTENTION_CATEGORIES = new Set([
  'needs_review',
  'missing_in_ebarimt',
  'missing_in_internal',
  'ai_suggested',
])

type Level = 'high' | 'medium' | 'low'

const LEVEL_STYLE: Record<Level, { label: string; barClass: string; textClass: string }> = {
  high: { label: 'Өндөр эрсдэл', barClass: 'bg-noat-danger', textClass: 'text-noat-danger' },
  medium: { label: 'Дунд эрсдэл', barClass: 'bg-noat-warning', textClass: 'text-noat-warning' },
  low: { label: 'Бага эрсдэл', barClass: 'bg-noat-success', textClass: 'text-noat-success' },
}

function levelOf(score: number): Level {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export function RiskPanel({ items }: RiskPanelProps) {
  const attention = useMemo(
    () => items.filter((it) => ATTENTION_CATEGORIES.has(it.category)),
    [items],
  )

  const buckets = useMemo(() => {
    const b: Record<Level, ItemRow[]> = { high: [], medium: [], low: [] }
    for (const it of attention) {
      b[levelOf(Number(it.risk_score) || 0)].push(it)
    }
    return b
  }, [attention])

  const maxRisk = useMemo(() => {
    if (attention.length === 0) return null
    return attention.reduce((a, it) =>
      (Number(it.risk_score) || 0) > (Number(a.risk_score) || 0) ? it : a,
    )
  }, [attention])

  if (attention.length === 0) {
    return (
      <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-noat-text-primary">
          <ShieldAlert className="size-4 text-noat-success" aria-hidden="true" />
          Дутуу гүйлгээний эрсдэл
        </h3>
        <p className="text-xs text-noat-text-muted">Анхаарал шаардсан мөр байхгүй — бүх гүйлгээ таарсан.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-noat-text-primary">
        <ShieldAlert className="size-4 text-noat-warning" aria-hidden="true" />
        Дутуу гүйлгээний эрсдэл
      </h3>
      <p className="mb-3 text-xs text-noat-text-muted">
        Анхаарал шаардсан {attention.length} мөр — эрсдэлийн оноогоор ангилсан
      </p>
      <div className="space-y-2.5">
        {(['high', 'medium', 'low'] as Level[]).map((lvl) => {
          const rows = buckets[lvl]
          const share = attention.length ? Math.round((rows.length / attention.length) * 100) : 0
          const style = LEVEL_STYLE[lvl]
          return (
            <div key={lvl}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className={`font-medium ${style.textClass}`}>{style.label}</span>
                <span className="tnum text-noat-text-secondary">
                  {rows.length} · {share}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-noat-surface-alt">
                <div
                  className={`h-full rounded-full ${style.barClass}`}
                  style={{ width: `${share}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {maxRisk && (
        <p className="mt-4 text-xs text-noat-text-muted">
          Хамгийн их эрсдэл:{' '}
          <span className="tnum font-semibold text-noat-text-primary">
            {Number(maxRisk.risk_score) || 0}/100
          </span>
          {maxRisk.company_name ? ` · ${maxRisk.company_name}` : ''}
        </p>
      )}
    </div>
  )
}
