import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent'
}

const toneMap: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-noat-text-primary',
  success: 'text-noat-success',
  warning: 'text-noat-warning',
  danger: 'text-noat-danger',
  info: 'text-noat-info',
  accent: 'text-noat-accent',
}

export function StatCard({ label, value, sub, icon, tone = 'default' }: StatCardProps) {
  return (
    <div className="rounded-xl bg-noat-surface p-4 shadow-noat-card transition-shadow hover:shadow-noat-card-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-noat-text-muted">{label}</p>
          <p className={`tnum mt-1.5 truncate text-2xl font-semibold ${toneMap[tone]}`}>{value}</p>
          {sub && <p className="mt-1 text-xs text-noat-text-muted">{sub}</p>}
        </div>
        {icon && <div className="shrink-0 text-noat-text-muted" aria-hidden="true">{icon}</div>}
      </div>
    </div>
  )
}
