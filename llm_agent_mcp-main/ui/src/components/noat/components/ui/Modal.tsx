import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  size?: 'md' | 'lg'
}

const sizeMap = { md: 'max-w-lg', lg: 'max-w-3xl' }

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : 'Дэлгэрэнгүй'}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${sizeMap[size]} max-h-[85vh] overflow-y-auto rounded-xl bg-noat-surface shadow-noat-card-lg`}
      >
        <header className="sticky top-0 flex items-center justify-between gap-3 bg-noat-surface px-5 py-3.5">
          <h3 className="text-base font-semibold text-noat-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-noat-text-muted transition-colors hover:bg-noat-surface-alt hover:text-noat-text-primary"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
