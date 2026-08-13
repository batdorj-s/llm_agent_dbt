import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CalendarRange } from 'lucide-react'
import type { MonthlySummary } from '../../api/types'
import { formatMntShort, formatMnt, formatMonth } from '../../lib/format'

interface MonthlyChartProps {
  internal: MonthlySummary
  ebarimt: MonthlySummary
}

export function MonthlyChart({ internal, ebarimt }: MonthlyChartProps) {
  const byMonth = new Map<string, { month: string; internal: number; ebarimt: number }>()
  for (const m of internal.months) {
    byMonth.set(m.month, { month: m.month, internal: m.total, ebarimt: 0 })
  }
  for (const m of ebarimt.months) {
    const cur = byMonth.get(m.month) ?? { month: m.month, internal: 0, ebarimt: 0 }
    cur.ebarimt = m.total
    byMonth.set(m.month, cur)
  }
  const data = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-noat-text-muted">
        Сарлаг мэдээлэл байхгүй
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-noat-text-muted">
        <CalendarRange className="size-3.5" aria-hidden="true" />
        Сараар нэгтгэсэн нийт дүн
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--noat-border)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={(v: string) => formatMonth(v)}
              tick={{ fontSize: 12, fill: 'var(--noat-text-muted)' }}
              axisLine={{ stroke: 'var(--noat-border)' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatMntShort(v)}
              tick={{ fontSize: 11, fill: 'var(--noat-text-muted)' }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              formatter={(value, name) => [formatMnt(Number(value)) + '₮', String(name)]}
              labelFormatter={(v) => formatMonth(String(v))}
              contentStyle={{
                background: 'var(--noat-surface)',
                border: '1px solid var(--noat-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend
              formatter={(v) => <span style={{ color: 'var(--noat-text-secondary)', fontSize: 12 }}>{v}</span>}
            />
            <Bar dataKey="internal" name="Дотоод бүртгэл" fill="var(--noat-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Bar dataKey="ebarimt" name="И-баримт" fill="var(--noat-accent)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
