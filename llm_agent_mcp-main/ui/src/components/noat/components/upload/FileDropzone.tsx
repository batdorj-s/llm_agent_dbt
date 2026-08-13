import { useCallback, useRef, useState, type DragEvent } from 'react'
import { FileSpreadsheet, UploadCloud, X } from 'lucide-react'
import { formatFileSize } from '../../lib/format'

interface FileDropzoneProps {
  label: string
  hint: string
  file: File | null
  onFile: (file: File | null) => void
}

const ACCEPTED = '.xlsx,.xlsm,.csv'

export function FileDropzone({ label, hint, file, onFile }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const dropped = e.dataTransfer.files?.[0]
      if (dropped) onFile(dropped)
    },
    [onFile],
  )

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-noat-text-primary">{label}</label>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label} файл сонгох`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          dragging
            ? 'border-noat-primary bg-noat-primary-soft'
            : 'border-noat-border bg-noat-surface-inset hover:border-noat-primary/50 hover:bg-noat-surface'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        {file ? (
          <>
            <FileSpreadsheet className="size-8 text-noat-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-noat-text-primary">{file.name}</p>
              <p className="text-xs text-noat-text-muted">
                {formatFileSize(file.size)} · дахин товшиж солих
              </p>
            </div>
            <button
              type="button"
              aria-label="Файл хасах"
              className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-noat-surface-alt text-noat-text-muted hover:bg-noat-danger-soft hover:text-noat-danger"
              onClick={(e) => {
                e.stopPropagation()
                onFile(null)
              }}
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <UploadCloud className="size-8 text-noat-text-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-noat-text-primary">Файл чирч оруулах эсвэл товшино уу</p>
            <p className="text-xs text-noat-text-muted">{hint}</p>
          </>
        )}
      </div>
    </div>
  )
}
