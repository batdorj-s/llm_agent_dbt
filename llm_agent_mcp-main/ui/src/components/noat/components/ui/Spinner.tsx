interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const sizeMap = { sm: 'size-4 border-2', md: 'size-6 border-2', lg: 'size-10 border-[3px]' }

export function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span
        className={`animate-spin rounded-full border-current border-t-transparent text-noat-primary ${sizeMap[size]}`}
        aria-hidden="true"
      />
      {label && <span className="text-sm text-noat-text-muted">{label}</span>}
    </span>
  )
}
