import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warning' | 'danger'

interface AlertProps {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
}

const toneMap: Record<Tone, { icon: ReactNode; classes: string; iconColor: string }> = {
  info: {
    icon: <Info className="size-4" />,
    classes: 'border-noat-info/40 bg-noat-info-soft text-noat-text-primary',
    iconColor: 'text-noat-info',
  },
  success: {
    icon: <CheckCircle2 className="size-4" />,
    classes: 'border-noat-success/40 bg-noat-success-soft text-noat-text-primary',
    iconColor: 'text-noat-success',
  },
  warning: {
    icon: <TriangleAlert className="size-4" />,
    classes: 'border-noat-warning/40 bg-noat-warning-soft text-noat-text-primary',
    iconColor: 'text-noat-warning',
  },
  danger: {
    icon: <AlertCircle className="size-4" />,
    classes: 'border-noat-danger/40 bg-noat-danger-soft text-noat-text-primary',
    iconColor: 'text-noat-danger',
  },
}

export function Alert({ tone = 'info', title, children }: AlertProps) {
  const t = toneMap[tone]
  return (
    <div role="alert" className={`flex gap-3 rounded-lg border px-4 py-3 ${t.classes}`}>
      <span className={`mt-0.5 shrink-0 ${t.iconColor}`} aria-hidden="true">
        {t.icon}
      </span>
      <div className="min-w-0">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {children && <div className="text-sm text-noat-text-secondary">{children}</div>}
      </div>
    </div>
  )
}
