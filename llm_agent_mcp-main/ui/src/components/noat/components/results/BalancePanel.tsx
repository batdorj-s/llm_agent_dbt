import { Scale } from 'lucide-react'
import type { Balance } from '../../api/types'
import { formatMnt } from '../../lib/format'

interface BalancePanelProps {
  balance: Balance
}

function SideTable({
  title,
  total,
  matched,
  remaining,
  tone,
}: {
  title: string
  total: number
  matched: number
  remaining: number
  tone: 'success' | 'warning'
}) {
  const matchedPct = total > 0 ? (matched / total) * 100 : 0
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-noat-text-primary">{title}</h4>
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-noat-text-muted">Нийт дүн</dt>
          <dd className="tnum font-semibold text-noat-text-primary">{formatMnt(total)}₮</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-noat-text-muted">Таарсан</dt>
          <dd className="tnum text-noat-success">{formatMnt(matched)}₮</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-noat-text-muted">Үлдэгдэл</dt>
          <dd className={`tnum ${tone === 'warning' ? 'text-noat-warning' : 'text-noat-text-secondary'}`}>
            {formatMnt(remaining)}₮
          </dd>
        </div>
      </dl>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-noat-surface-alt">
        <div
          className={`h-full rounded-full ${tone === 'success' ? 'bg-noat-success' : 'bg-noat-warning'}`}
          style={{ width: `${Math.min(100, matchedPct)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-noat-text-muted">
        Тааралын хэмжээ: <span className="tnum">{matchedPct.toFixed(1)}%</span>
      </p>
    </div>
  )
}

export function BalancePanel({ balance }: BalancePanelProps) {
  const diff = balance.ebarimt_total - balance.internal_total
  return (
    <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-noat-text-primary">
        <Scale className="size-4 text-noat-text-muted" aria-hidden="true" />
        Тэнцвэр
      </h3>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SideTable
          title="Дотоод бүртгэл"
          total={balance.internal_total}
          matched={balance.internal_matched}
          remaining={balance.internal_remaining}
          tone="success"
        />
        <SideTable
          title="И-баримт"
          total={balance.ebarimt_total}
          matched={balance.ebarimt_matched}
          remaining={balance.ebarimt_remaining}
          tone="warning"
        />
      </div>
      <p className="mt-4 text-xs text-noat-text-muted">
        Файлуудын нийт дүнгийн зөрүү:{' '}
        <span className={`tnum font-semibold ${Math.abs(diff) < 1 ? 'text-noat-success' : 'text-noat-warning'}`}>
          {diff >= 0 ? '+' : '−'}
          {formatMnt(Math.abs(diff))}₮
        </span>
      </p>
    </div>
  )
}
