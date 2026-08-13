import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-noat-border bg-noat-surface-inset px-6 py-12 text-center">
      {icon && <div className="text-noat-text-muted" aria-hidden="true">{icon}</div>}
      <h3 className="text-sm font-semibold text-noat-text-primary">{title}</h3>
      {description && <p className="max-w-md text-sm text-noat-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
