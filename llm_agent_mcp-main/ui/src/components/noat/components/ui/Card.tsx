import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  padded?: boolean
}

export function Card({ children, className = '', title, subtitle, actions, padded = true }: CardProps) {
  return (
    <section className={`rounded-xl bg-noat-surface shadow-noat-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h2 className="text-base font-semibold text-noat-text-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-noat-text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}
