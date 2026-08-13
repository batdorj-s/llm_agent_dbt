import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  /** Tailwind softClass + textClass хослол */
  className?: string
  dot?: boolean
  dotClass?: string
}

export function Badge({ children, className = '', dot = false, dotClass = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {dot && <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden="true" />}
      {children}
    </span>
  )
}
