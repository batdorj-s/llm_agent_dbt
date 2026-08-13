/** Тоо, огноо, хувийн форматлах туслах функцууд */

export function formatMnt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return rounded.toLocaleString('mn-MN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatMntShort(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} тэрбум`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} сая`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)} мянга`
  return value.toFixed(2)
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}.${m[2]}.${m[3]}`
  return value
}

export function formatMonth(value: string | null | undefined): string {
  if (!value) return '—'
  const m = value.match(/^(\d{4})-(\d{2})/)
  if (m) {
    const months = ['Нэг', 'Хоёр', 'Гурав', 'Дөрөв', 'Тав', 'Зургаа', 'Долоо', 'Найм', 'Ес', 'Арав', 'Арваннэг', 'Арванхоёр']
    return `${m[1]} оны ${months[parseInt(m[2], 10) - 1]} сар`
  }
  return value
}

export function formatDeltaAmount(delta: number): string {
  if (delta === 0) return '0.00₮'
  const sign = delta < 0 ? '−' : '+'
  return `${sign}${formatMnt(Math.abs(delta))}₮`
}

/** Таб тоонуудыг тусгаарлах (1,234,567) */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('mn-MN')
}

/** Файлын хэмжээг MB/КБ болгох */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
