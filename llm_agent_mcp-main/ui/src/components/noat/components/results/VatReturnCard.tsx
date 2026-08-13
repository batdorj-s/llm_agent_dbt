import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { FileCheck2, ShieldCheck } from 'lucide-react'
import type { VatReturn } from '../../api/types'
import { formatMnt, formatPercent } from '../../lib/format'

interface VatReturnCardProps {
  vatReturn: VatReturn
}

export function VatReturnCard({ vatReturn }: VatReturnCardProps) {
  const data = [
    { name: 'Хүлээн зөвшөөрсөн НӨАТ', value: vatReturn.accepted_vat, color: '#22c55e' },
    { name: 'Хянах шаардлагатай НӨАТ', value: vatReturn.review_vat, color: '#f59e0b' },
  ].filter((d) => d.value > 0)

  return (
    <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-noat-text-primary">
        <FileCheck2 className="size-4 text-noat-text-muted" aria-hidden="true" />
        НӨАТ-ын тайлангийн бэлэн байдал
      </h3>
      <p className="mb-3 text-xs text-noat-text-muted">Татварын тайланд орох НӨАТ-ын хүлээн зөвшөөрөл</p>

      <div className="flex items-center gap-4">
        <div className="h-36 w-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60} strokeWidth={0}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => [formatMnt(Number(v ?? 0)) + '₮', '']} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-noat-success" aria-hidden="true" />
            <span className="tnum text-2xl font-semibold text-noat-text-primary">
              {formatPercent(vatReturn.acceptance_rate)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-noat-text-muted">хүлээн зөвшөөрөлтийн хувь</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-noat-text-muted">Нийт НӨАТ</dt>
              <dd className="tnum text-noat-text-primary">{formatMnt(vatReturn.total_vat)}₮</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-noat-text-muted">Хүлээн зөвшөөрсөн</dt>
              <dd className="tnum text-noat-success">{formatMnt(vatReturn.accepted_vat)}₮</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-noat-text-muted">Хянах шаардлагатай</dt>
              <dd className="tnum text-noat-warning">{formatMnt(vatReturn.review_vat)}₮</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
