import type { ReactNode } from 'react'

interface ProgressBarProps {
  value: number
  label?: ReactNode
  stage?: string
  size?: 'sm' | 'lg'
}

export function ProgressBar({ value, label, stage, size = 'lg' }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="w-full">
      {(label || stage) && (
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-noat-text-primary">{label ?? 'Боловсруулж байна'}</span>
          <span className="flex items-center gap-2">
            {stage && <span className="text-noat-text-muted">{stage}</span>}
            <span className="tnum text-noat-text-secondary">{Math.round(clamped)}%</span>
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : 'Явц'}
        className={`w-full overflow-hidden rounded-full bg-noat-surface-alt ${size === 'lg' ? 'h-2.5' : 'h-1.5'}`}
      >
        <div
          className="h-full rounded-full bg-noat-primary transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
