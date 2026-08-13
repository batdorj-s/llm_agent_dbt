import type { ReactNode } from 'react'

interface TabsProps<T extends string> {
  tabs: { key: T; label: ReactNode; count?: number }[]
  active: T
  onChange: (key: T) => void
}

export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label="Ангилал" className="flex flex-wrap gap-1">
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-noat-surface-alt text-noat-text-primary shadow-noat-card'
                : 'text-noat-text-muted hover:text-noat-text-primary'
            }`}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span
                className={`tnum ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${
                  isActive ? 'bg-noat-primary-soft text-noat-primary' : 'bg-noat-surface-alt text-noat-text-muted'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
