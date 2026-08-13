import { useMemo, useState } from 'react'
import { Bot, ChevronDown, ChevronUp, Download, Loader2, Search, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { Tabs } from '../ui/Tabs'
import { Modal } from '../ui/Modal'
import { Alert } from '../ui/Alert'
import { categoryMeta, MATCH_STAGE_LABEL, riskLevel, SOURCE_LABEL } from '../../lib/categories'
import { formatMnt, formatDate, formatDeltaAmount } from '../../lib/format'
import { explainRow } from '../../api/reconcile'
import type { AiExplainResponse, ItemRow } from '../../api/types'

const PAGE_SIZE = 50

interface ItemsTableProps {
  items: ItemRow[]
  initialCategory?: string
  customerFilter?: string | null
  onClearCustomerFilter?: () => void
}

type SortKey = 'date' | 'amount' | 'delta_amount' | 'risk_score'

type TabKey = 'all' | 'matched' | 'aggregate_matched' | 'ai_suggested' | 'needs_review' | 'missing_in_ebarimt' | 'missing_in_internal'

const TAB_LABEL: Record<TabKey, string> = {
  all: 'Бүгд',
  matched: 'Таарсан',
  aggregate_matched: 'Нийгтлэн',
  ai_suggested: 'AI санал',
  needs_review: 'Хянах шаардлагатай',
  missing_in_ebarimt: 'И-баримтад байхгүй',
  missing_in_internal: 'Дотоодод байхгүй',
}

export function ItemsTable({ items, initialCategory, customerFilter, onClearCustomerFilter }: ItemsTableProps) {
  const [tab, setTab] = useState<TabKey>((initialCategory as TabKey) ?? 'all')
  const [search, setSearch] = useState('')
  const [onlyDelta, setOnlyDelta] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 'asc' | 'desc' }>({ key: null, dir: 'desc' })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<ItemRow | null>(null)
  const [explain, setExplain] = useState<AiExplainResponse | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)

  const deduped = useMemo(() => {
    const seen = new Set<string>()
    const out: ItemRow[] = []
    for (const it of items) {
      const key = `${it.source}-${it.row_id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(it)
    }
    return out
  }, [items])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = {
      all: deduped.length,
      matched: 0,
      aggregate_matched: 0,
      ai_suggested: 0,
      needs_review: 0,
      missing_in_ebarimt: 0,
      missing_in_internal: 0,
    }
    for (const it of deduped) {
      if (it.category in c) c[it.category as keyof typeof c] += 1
    }
    return c
  }, [deduped])

  const filtered = useMemo(() => {
    let out = deduped
    if (tab !== 'all') out = out.filter((it) => it.category === tab)
    if (customerFilter) out = out.filter((it) => it.company_name === customerFilter)
    if (onlyDelta) out = out.filter((it) => Math.abs(it.delta_amount) >= 1)
    const q = search.trim().toLowerCase()
    if (q) {
      out = out.filter((it) =>
        [it.company_name, it.doc_id, it.registry, String(it.invoice_no ?? ''), it.tax_type, it.note,
         it.date, formatDate(it.date), String(it.amount ?? ''), formatMnt(it.amount), String(it.row_id)]
          .map((v) => String(v ?? '').toLowerCase())
          .some((v) => v.includes(q)),
      )
    }
    if (sort.key) {
      const { key, dir } = sort
      const toNum = (v: string | number | null): number => {
        if (v == null) return Number.POSITIVE_INFINITY
        return typeof v === 'string' ? Date.parse(v) || 0 : v
      }
      out = [...out].sort((a, b) => {
        const r = toNum(a[key]) - toNum(b[key])
        return dir === 'desc' ? -r : r
      })
    }
    return out
  }, [deduped, tab, search, customerFilter, onlyDelta, sort])

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
    setPage(0)
  }

  const sortIcon = (col: SortKey) =>
    sort.key === col ? (
      sort.dir === 'desc' ? (
        <ChevronDown className="size-3.5" aria-hidden="true" />
      ) : (
        <ChevronUp className="size-3.5" aria-hidden="true" />
      )
    ) : null

  const exportCsv = () => {
    const header = ['Эх файл', 'Мөр', 'Ангилал', 'Огноо', 'Харилцагч', 'Регистр', 'ДДТД', 'Дүн', 'НӨАТ', 'Зөрүү', 'Зөрүү (өдөр)', 'Татварын төрөл', 'Эрсдэл', 'Тэмдэглэл', 'Статус']
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = filtered.map((it) =>
      [
        SOURCE_LABEL[it.source] ?? it.source,
        it.row_id,
        categoryMeta(it.category).label,
        formatDate(it.date),
        it.company_name,
        it.registry,
        it.doc_id,
        it.amount,
        it.vat,
        it.delta_amount,
        it.delta_days,
        it.tax_type,
        it.risk_score,
        it.note,
        it.status ?? '',
      ]
        .map(esc)
        .join(','),
    )
    const blob = new Blob([`\uFEFF${header.join(',')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shuugesen_muruud.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const totalAmount = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const totalDelta = filtered.reduce((s, r) => s + (Number(r.delta_amount) || 0), 0)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const openExplain = async (row: ItemRow) => {
    setSelected(row)
    setExplain(null)
    setExplainError(null)
    setExplainLoading(true)
    try {
      const res = await explainRow({
        company_name: row.company_name,
        date: row.date,
        amount: row.amount,
        registry: row.registry,
        category: row.category,
        note: row.note,
        match_stage: row.match_stage,
      })
      setExplain(res)
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : 'AI тайлбар авахад алдаа гарлаа')
    } finally {
      setExplainLoading(false)
    }
  }

  const tabs = (Object.keys(TAB_LABEL) as TabKey[]).map((k) => ({
    key: k,
    label: TAB_LABEL[k],
    count: counts[k],
  }))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setPage(0) }} />
        <div className="flex w-full flex-wrap items-end justify-end gap-2 sm:w-auto">
          {customerFilter && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-noat-primary-soft px-3 py-1.5 text-xs font-medium text-noat-primary">
              {customerFilter}
              <button type="button" onClick={() => onClearCustomerFilter?.()} aria-label="Харилцагч шүүлтийг арилгах" className="cursor-pointer">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-noat-text-muted">
            <input
              type="checkbox"
              checked={onlyDelta}
              onChange={(e) => { setOnlyDelta(e.target.checked); setPage(0) }}
              className="size-3.5 accent-noat-primary"
            />
            Зөрүүтэй л
          </label>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-noat-surface-alt px-3 py-2 text-xs font-medium text-noat-text-secondary transition-colors hover:bg-noat-surface-alt/70 hover:text-noat-text-primary"
          >
            <Download className="size-3.5" aria-hidden="true" />
            CSV татах
          </button>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-noat-text-muted" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              placeholder="Харилцагч, ДДТД, регистр, огноо, дүнгээр хайх…"
              aria-label="Мөр хайх"
              className="w-full rounded-lg bg-noat-surface-inset py-2 pr-3 pl-9 text-sm text-noat-text-primary placeholder:text-noat-text-muted transition-colors focus:bg-noat-surface focus:outline-2 focus:outline-noat-primary"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="size-8" />}
          title="Мөр олдсонгүй"
          description="Хайлтын үг эсвэл ангилалаа өөрчилж үзнэ үү"
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-noat-surface shadow-noat-card">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-noat-border/60 text-left text-xs uppercase tracking-wide text-noat-text-muted">
                  <th className="px-3 py-2.5 font-medium">Эх файлын мөр</th>
                  <th className="px-4 py-2.5 font-medium">Ангилал</th>
                  <th className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => toggleSort('date')} className="flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                      Огноо {sortIcon('date')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Харилцагч</th>
                  <th className="px-3 py-2.5 font-medium">ТТД / ДДТД</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('amount')} className="ml-auto flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                      Дүн {sortIcon('amount')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('delta_amount')} className="ml-auto flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                      Зөрүү {sortIcon('delta_amount')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Тараал</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('risk_score')} className="ml-auto flex cursor-pointer items-center gap-1 hover:text-noat-text-primary">
                      Эрсдэл {sortIcon('risk_score')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((it) => {
                  const meta = categoryMeta(it.category)
                  const risk = riskLevel(it.risk_score)
                  return (
                    <tr
                      key={`${it.source}-${it.row_id}`}
                      className="cursor-pointer border-b border-noat-border/40 last:border-0 hover:bg-noat-surface-alt/60"
                      onClick={() => void openExplain(it)}
                    >
                      <td className="tnum px-3 py-2.5 whitespace-nowrap text-xs text-noat-text-muted">
                        {SOURCE_LABEL[it.source] ?? it.source} · №{it.row_id}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge className={`${meta.softClass} ${meta.textClass}`} dot dotClass={meta.dotClass}>
                          {meta.shortLabel}
                        </Badge>
                      </td>
                      <td className="tnum px-3 py-2.5 whitespace-nowrap text-noat-text-secondary">{formatDate(it.date)}</td>
                      <td className="max-w-52 truncate px-3 py-2.5 font-medium text-noat-text-primary" title={it.company_name ?? undefined}>
                        {it.company_name ?? '—'}
                      </td>
                      <td className="tnum px-3 py-2.5 whitespace-nowrap text-xs text-noat-text-muted">
                        {it.registry ?? '—'}
                        {it.doc_id && (
                          <span className="ml-2 inline-block max-w-40 truncate align-middle" title={it.doc_id}>
                            {it.doc_id.slice(-8)}
                          </span>
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right font-semibold text-noat-text-primary">
                        {formatMnt(it.amount)}₮
                      </td>
                      <td className={`tnum px-3 py-2.5 text-right text-xs ${Math.abs(it.delta_amount) >= 1 ? 'text-noat-warning' : 'text-noat-text-muted'}`}>
                        {formatDeltaAmount(it.delta_amount)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-noat-text-muted">
                        <Badge className="bg-noat-surface-alt text-noat-text-secondary">{SOURCE_LABEL[it.source] ?? it.source}</Badge>
                        <span className="ml-1.5">{MATCH_STAGE_LABEL[it.match_stage] ?? it.match_stage}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge className={`${risk.softClass} ${risk.textClass}`}>{risk.label}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-noat-text-muted">
            <span>
              Нийт <span className="tnum font-semibold text-noat-text-primary">{filtered.length}</span> мөр ·{' '}
              Нийт дүн <span data-testid="footer-amount" className="tnum font-semibold text-noat-text-primary">{formatMnt(totalAmount)}₮</span> ·{' '}
              Зөрүү <span data-testid="footer-delta" className="tnum font-semibold text-noat-text-primary">{formatMnt(totalDelta)}₮</span> ·{' '}
              {page + 1}/{totalPages} хуудас
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
        </>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.company_name ?? 'Мөр'} · ${formatDate(selected.date)}` : ''}
        size="lg"
      >
        {selected && (
          <div className="space-y-4">
            {(() => {
              const matchedRow =
                selected.matched_with != null
                  ? items.find((it) => it.source !== selected.source && it.row_id === selected.matched_with)
                  : undefined
              return matchedRow ? (
                <div className="rounded-lg border border-noat-success/30 bg-noat-success/5 px-4 py-2.5 text-xs text-noat-text-secondary">
                  Таарсан мөр:{' '}
                  <span className="font-semibold text-noat-text-primary">
                    {SOURCE_LABEL[matchedRow.source] ?? matchedRow.source} · №{matchedRow.row_id} ·{' '}
                    {matchedRow.company_name ?? '—'} · {formatMnt(matchedRow.amount)}₮
                  </span>
                </div>
              ) : null
            })()}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`${categoryMeta(selected.category).softClass} ${categoryMeta(selected.category).textClass}`}>
                {categoryMeta(selected.category).label}
              </Badge>
              <Badge className="bg-noat-surface-alt text-noat-text-secondary">{SOURCE_LABEL[selected.source]}</Badge>
              <Badge className="bg-noat-surface-alt text-noat-text-secondary">
                {MATCH_STAGE_LABEL[selected.match_stage] ?? selected.match_stage}
              </Badge>
              {selected.tags.map((t) => (
                <Badge key={t} className="bg-noat-primary-soft text-noat-primary">
                  {t}
                </Badge>
              ))}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg bg-noat-surface-inset p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-noat-text-muted">Нийт дүн</dt>
                <dd className="tnum mt-0.5 font-semibold text-noat-text-primary">{formatMnt(selected.amount)}₮</dd>
              </div>
              <div>
                <dt className="text-xs text-noat-text-muted">Зөрүү</dt>
                <dd className={`tnum mt-0.5 font-semibold ${Math.abs(selected.delta_amount) >= 1 ? 'text-noat-warning' : 'text-noat-success'}`}>
                  {formatDeltaAmount(selected.delta_amount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-noat-text-muted">Эрсдэлийн оноо</dt>
                <dd className="tnum mt-0.5 font-semibold text-noat-text-primary">{selected.risk_score?.toFixed(0) ?? '—'}/100</dd>
              </div>
              <div>
                <dt className="text-xs text-noat-text-muted">ТТД</dt>
                <dd className="tnum mt-0.5">{selected.registry ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-noat-text-muted">ДДТД</dt>
                <dd className="tnum mt-0.5 break-all text-xs">{selected.doc_id ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-noat-text-muted">Татварын төрөл</dt>
                <dd className="mt-0.5">{selected.tax_type ?? '—'}</dd>
              </div>
            </dl>

            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-noat-text-primary">
                <Bot className="size-4 text-noat-accent" aria-hidden="true" />
                AI тайлбар
              </h4>
              {explainLoading ? (
                <div className="flex items-center gap-2 text-sm text-noat-text-muted">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Тайлбар бэлдэж байна…
                </div>
              ) : explainError ? (
                <Alert tone="danger" title="AI тайлбар авахад алдаа гарлаа">{explainError}</Alert>
              ) : explain ? (
                <div className="space-y-2">
                  {explain.degraded && (
                    <p className="text-xs text-noat-text-muted">
                      (AI API тохируулаагүй — дүрэмд суурилсан тайлбар харуулж байна)
                    </p>
                  )}
                  <p className="rounded-lg bg-noat-surface-inset p-3.5 text-sm leading-relaxed text-noat-text-secondary">
                    {explain.explanation}
                  </p>
                  {explain.suggested_action && (
                    <div className="rounded-lg border border-noat-accent/30 bg-noat-accent/5 p-3.5 text-sm text-noat-text-secondary">
                      <span className="font-semibold text-noat-accent">Санал болгож буй шийдвэр: </span>
                      {explain.suggested_action}
                    </div>
                  )}
                  {selected.note && (
                    <p className="text-xs text-noat-text-muted">
                      <span className="font-medium">Тулгалтын тэмдэглэл:</span> {selected.note}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
