import { Info } from 'lucide-react'

type Variant = 'hero' | 'compact'

const STEPS = [
  { label: 'ДДТД', hint: 'Дотоод бүртгэлийн ДДТД дугаараар тааруулах' },
  { label: 'Яг таарал', hint: 'Бүх үзүүлэлт яг таарсан таарал' },
  { label: 'Хүлцэлтэй', hint: 'Дүн болон огнооны хүлцэлийг зөвшөөрсөн таарал' },
  { label: 'Нийгтлэн', hint: 'Олон мөрийг нийтлэн тааруулсан таарал' },
  { label: 'AI', hint: 'Нэр төстэй тааралын ухаалаг санал' },
]

interface AlgorithmNoticeProps {
  variant?: Variant
}

export function AlgorithmNotice({ variant = 'hero' }: AlgorithmNoticeProps) {
  const compact = variant === 'compact'

  return (
    <section
      aria-label="Тулгалтын алгоритм"
      className={`rounded-2xl bg-noat-primary-soft/70 text-noat-text-primary ${
        compact ? 'px-4 py-3' : 'px-5 py-4 sm:px-6'
      }`}
    >
      <div className={`flex items-center gap-2 ${compact ? '' : 'mb-3'}`}>
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-noat-primary/10 text-noat-primary ${
            compact ? 'size-5' : 'size-6'
          }`}
        >
          <Info className={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" />
        </span>
        <h2 className={`font-semibold ${compact ? 'text-xs' : 'text-sm sm:text-base'}`}>
          Тулгалтын алгоритм
        </h2>
      </div>

      {!compact && (
        <p className="mb-4 max-w-3xl text-xs text-noat-text-secondary sm:text-sm">
          Файлууд дараах шатлалаар автоматаар тулгалт хийгдэнэ. Таараагүй мөрүүд
          дараагийн шат руу шилжиж, сүүлийн шатанд үлдсэн мөрүүдийг анхаарч үзнэ.
        </p>
      )}

      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2">
            <span
              className="flex items-center gap-1.5 rounded-full bg-noat-surface px-3 py-1 shadow-noat-card"
              title={step.hint}
            >
              {!compact && (
                <span className="tnum flex size-4 shrink-0 items-center justify-center rounded-full bg-noat-primary/15 text-[10px] font-bold text-noat-primary">
                  {i + 1}
                </span>
              )}
              <span className={`font-medium ${compact ? 'text-[11px]' : 'text-xs sm:text-sm'}`}>
                {step.label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-noat-text-muted" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
