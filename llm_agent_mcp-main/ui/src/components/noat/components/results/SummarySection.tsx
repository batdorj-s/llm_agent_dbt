import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { BarChart3, CheckCheck, Combine, ListChecks, Sparkles, XCircle, SearchX, Eye } from 'lucide-react'
import { StatCard } from '../ui/StatCard'
import { CATEGORY_ORDER, CATEGORY_META } from '../../lib/categories'
import type { Summary } from '../../api/types'

interface SummarySectionProps {
  summary: Summary
  onSelectCategory: (category: string) => void
}

const CATEGORY_COUNT_KEY: Record<string, keyof Summary> = {
  matched: 'total_matched_count',
  aggregate_matched: 'aggregate_matched_count',
  ai_suggested: 'ai_matched_count',
  needs_review: 'needs_review_count',
  missing_in_ebarimt: 'missing_in_ebarimt_count',
  missing_in_internal: 'missing_in_internal_count',
}

function categoryCount(summary: Summary, category: string): number {
  const key = CATEGORY_COUNT_KEY[category]
  return key ? (summary[key] as number) : 0
}

export function SummarySection({ summary, onSelectCategory }: SummarySectionProps) {
  const donutData = CATEGORY_ORDER.map((c) => {
    const count = categoryCount(summary, c)
    return { name: CATEGORY_META[c].shortLabel, value: count, key: c }
  }).filter((d) => d.value > 0)

  const attentionCount = summary.needs_review_count + summary.missing_in_ebarimt_count + summary.missing_in_internal_count

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Таарсан"
          value={summary.total_matched_count}
          sub={`+ ${summary.aggregate_matched_count} нийгтлэн`}
          tone="success"
          icon={<CheckCheck className="size-4" />}
        />
        <StatCard
          label="Нийгтлэн таарсан"
          value={summary.aggregate_matched_count}
          tone="info"
          icon={<Combine className="size-4" />}
        />
        <StatCard
          label="AI санал"
          value={summary.ai_matched_count}
          tone="accent"
          icon={<Sparkles className="size-4" />}
        />
        <StatCard
          label="Хянах шаардлагатай"
          value={summary.needs_review_count}
          tone="warning"
          icon={<Eye className="size-4" />}
        />
        <StatCard
          label="И-баримтад байхгүй"
          value={summary.missing_in_ebarimt_count}
          tone="danger"
          icon={<XCircle className="size-4" />}
        />
        <StatCard
          label="Дотоодод байхгүй"
          value={summary.missing_in_internal_count}
          tone="warning"
          icon={<SearchX className="size-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card lg:col-span-1">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-noat-text-primary">
            <BarChart3 className="size-4 text-noat-text-muted" aria-hidden="true" />
            Ангилалын хуваарилалт
          </h3>
          <p className="mb-3 text-xs text-noat-text-muted">
            Нийт {summary.total_matched_count + summary.aggregate_matched_count + summary.ai_matched_count + attentionCount} мөр
            {summary.ai_available ? ' · AI идэвхтэй' : ' · AI идэвхгүй'}
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={62}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {donutData.map((d) => (
                    <Cell key={d.key} fill={CATEGORY_META[d.key as keyof typeof CATEGORY_META].hex} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [Number(v ?? 0).toLocaleString('mn-MN'), 'мөр']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 space-y-1.5">
            {CATEGORY_ORDER.map((c) => {
              const count = categoryCount(summary, c)
              if (count === 0) return null
              const meta = CATEGORY_META[c]
              return (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => onSelectCategory(c)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-noat-surface-alt"
                  >
                    <span className={`size-2 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
                    <span className="flex-1 truncate text-noat-text-secondary">{meta.shortLabel}</span>
                    <span className="tnum font-semibold text-noat-text-primary">{count}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card lg:col-span-2">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-noat-text-primary">
            <ListChecks className="size-4 text-noat-text-muted" aria-hidden="true" />
            Юу хийх вэ?
          </h3>
          <ol className="space-y-2.5 text-sm text-noat-text-secondary">
            <li className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-noat-success-soft text-xs font-bold text-noat-success">1</span>
              <span>
                <strong className="text-noat-text-primary">Хянах шаардлагатай ({summary.needs_review_count})</strong> мөрүүдийг нэг бүрчлэн
                шалгаж, зөрүүний шалтгааныг тодорхойлно.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-noat-danger-soft text-xs font-bold text-noat-danger">2</span>
              <span>
                <strong className="text-noat-text-primary">И-баримтад байхгүй ({summary.missing_in_ebarimt_count})</strong> болон{' '}
                <strong className="text-noat-text-primary">Дотоодод байхгүй ({summary.missing_in_internal_count})</strong> мөрүүдийн
                шалтгааныг тодруулна.
              </span>
            </li>
            {summary.ai_matched_count > 0 && (
              <li className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-noat-accent/15 text-xs font-bold text-noat-accent">3</span>
                <span>
                  <strong className="text-noat-text-primary">AI санал ({summary.ai_matched_count})</strong> хэсэгт баталгаажуулж
                  эсвэл татгалзах шийдвэрээ өгнө.
                </span>
              </li>
            )}
            <li className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-noat-primary-soft text-xs font-bold text-noat-primary">4</span>
              <span>
                <button
                  type="button"
                  onClick={() => onSelectCategory('all')}
                  className="font-medium text-noat-primary underline-offset-2 hover:underline"
                >
                  Мөрийн дэлгэрэнгүй хүснэгт
                </button>{' '}
                рүү очиж үр дүнг баталгаажуулж, Excel экспортлоно.
              </span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
