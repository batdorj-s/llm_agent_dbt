import { useMemo, useState } from 'react'
import { Building2, ChevronDown, ChevronUp } from 'lucide-react'
import type { CustomerComparisonRow } from '../../api/types'
import { formatMnt, formatCount } from '../../lib/format'

interface CustomerTableProps {
  rows: CustomerComparisonRow[]
  onSelectCustomer?: (name: string) => void
}

const PAGE_SIZE = 15

export function CustomerTable({ rows, onSelectCustomer }: CustomerTableProps) {
  const [sortKey, setSortKey] = useState<'diff' | 'internal_total' | 'ebarimt_total'>('diff')
  const [asc, setAsc] = useState(false)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => (asc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]))
    return arr
  }, [rows, sortKey, asc])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggleSort = (key: 'diff' | 'internal_total' | 'ebarimt_total') => {
    if (sortKey === key) setAsc((v) => !v)
    else {
      setSortKey(key)
      setAsc(false)
    }
  }

  const sortIcon = (col: typeof sortKey) =>
    sortKey === col ? (
      asc ? (
        <ChevronUp className="size-3.5" aria-hidden="true" />
      ) : (
        <ChevronDown className="size-3.5" aria-hidden="true" />
      )
    ) : null

  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-noat-text-muted">Харилцагчийн мэдээлэл байхгүй</div>
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-noat-text-muted">
        <Building2 className="size-3.5" aria-hidden="true" />
        Нийт {formatCount(rows.length)} харилцагч · дүнгийн зөрүүгөөр эрэмбэлсэн · харилцагч дээр дарж мөр шүүнэ
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-noat-border/60 text-left text-xs uppercase tracking-wide text-noat-text-muted">
              <th className="py-2 pr-3 font-medium">Харилцагч</th>
              <th className="py-2 pr-3 font-medium">
                <button type="button" onClick={() => toggleSort('internal_total')} className="flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                  Дотоод {sortIcon('internal_total')}
                </button>
              </th>
              <th className="py-2 pr-3 font-medium">
                <button type="button" onClick={() => toggleSort('ebarimt_total')} className="flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                  И-баримт {sortIcon('ebarimt_total')}
                </button>
              </th>
              <th className="py-2 font-medium">
                <button type="button" onClick={() => toggleSort('diff')} className="flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                  Зөрүү {sortIcon('diff')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const absDiff = Math.abs(r.diff)
              const significant = absDiff >= 1
              return (
                <tr key={r.company_name} className="border-b border-noat-border/40 last:border-0 hover:bg-noat-surface-alt/60">
                  <td className="max-w-56 py-2.5 pr-3">
                    <button
                      type="button"
                      onClick={() => onSelectCustomer?.(r.company_name)}
                      title={r.company_name}
                      className="w-full cursor-pointer truncate text-left font-medium text-noat-text-primary transition-colors hover:text-noat-accent"
                    >
                      {r.company_name}
                    </button>
                  </td>
                  <td className="tnum py-2.5 pr-3 text-noat-text-secondary">
                    {formatMnt(r.internal_total)}₮
                    <span className="ml-1.5 text-xs text-noat-text-muted">({formatCount(r.internal_count)})</span>
                  </td>
                  <td className="tnum py-2.5 pr-3 text-noat-text-secondary">
                    {formatMnt(r.ebarimt_total)}₮
                    <span className="ml-1.5 text-xs text-noat-text-muted">({formatCount(r.ebarimt_count)})</span>
                  </td>
                  <td className={`tnum py-2.5 ${significant ? 'text-noat-warning' : 'text-noat-success'}`}>
                    {r.diff > 0 ? '+' : ''}
                    {formatMnt(r.diff)}₮
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-noat-text-muted">
          <span>
            {page + 1} / {totalPages} хуудас
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="cursor-pointer rounded-md bg-noat-surface-alt px-3 py-1.5 text-noat-text-secondary hover:bg-noat-surface-alt/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Өмнөх
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="cursor-pointer rounded-md bg-noat-surface-alt px-3 py-1.5 text-noat-text-secondary hover:bg-noat-surface-alt/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Дараах
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
