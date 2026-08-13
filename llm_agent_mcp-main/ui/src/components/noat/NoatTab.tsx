import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Eye, FileSpreadsheet, FileWarning, Play, RefreshCw } from 'lucide-react'
import { Alert } from './components/ui/Alert'
import { AlgorithmNotice } from './components/ui/AlgorithmNotice'
import { Button } from './components/ui/Button'
import { Card } from './components/ui/Card'
import { ProgressBar } from './components/ui/ProgressBar'
import { Spinner } from './components/ui/Spinner'
import { FileDropzone } from './components/upload/FileDropzone'
import { ParamsForm, toReconcileParams, type ParamsFormState } from './components/upload/ParamsForm'
import { SummarySection } from './components/results/SummarySection'
import { BalancePanel } from './components/results/BalancePanel'
import { VatReturnCard } from './components/results/VatReturnCard'
import { RiskPanel } from './components/results/RiskPanel'
import { MonthlyChart } from './components/results/MonthlyChart'
import { CustomerTable } from './components/results/CustomerTable'
import { ItemsTable } from './components/results/ItemsTable'
import { useJobPolling } from './hooks/useJobPolling'
import { exportExcel, fetchResult, previewFiles, startReconcile } from './api/reconcile'
import type { PreviewResponse, ReconcileResult } from './api/types'
import { formatCount, formatDate, formatMnt } from './lib/format'

type NoatView = { kind: 'upload' } | { kind: 'results'; jobId: string }

export function NoatTab() {
  const [view, setView] = useState<NoatView>({ kind: 'upload' })

  if (view.kind === 'results') {
    return (
      <NoatResults
        jobId={view.jobId}
        onBack={() => setView({ kind: 'upload' })}
      />
    )
  }
  return <NoatUpload onShowResults={(jobId) => setView({ kind: 'results', jobId })} />
}

const STAGE_LABEL: Record<string, string> = {
  clean: 'Файл цэвэрлэж байна…',
  matching: 'Тулгалт хийж байна…',
  ai: 'AI тайлбар бэлдэж байна…',
  done: 'Дууслаа',
}

function NoatUpload({ onShowResults }: { onShowResults: (jobId: string) => void }) {
  const [internalFile, setInternalFile] = useState<File | null>(null)
  const [ebarimtFile, setEbarimtFile] = useState<File | null>(null)
  const [params, setParams] = useState<ParamsFormState>({
    toleranceAmount: 5,
    toleranceDays: 1,
    enableAi: true,
    dateFrom: '',
    dateTo: '',
  })
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { status, start, isPolling } = useJobPolling((id) => {
    setJobId(id)
  })

  const canStart = internalFile !== null && ebarimtFile !== null && !isPolling
  const canPreview = internalFile !== null && ebarimtFile !== null && !isPolling

  const handlePreview = useCallback(async () => {
    if (!internalFile || !ebarimtFile) return
    setPreviewLoading(true)
    setJobError(null)
    try {
      const res = await previewFiles(internalFile, ebarimtFile)
      setPreview(res)
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Preview авахад алдаа гарлаа')
    } finally {
      setPreviewLoading(false)
    }
  }, [internalFile, ebarimtFile])

  const handleStart = useCallback(async () => {
    if (!internalFile || !ebarimtFile) return
    setSubmitError(null)
    setPreview(null)
    try {
      const { job_id } = await startReconcile(internalFile, ebarimtFile, toReconcileParams(params))
      setJobId(job_id)
      start(job_id)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Тулгалт эхлүүлэхэд алдаа гарлаа')
    }
  }, [internalFile, ebarimtFile, params, start])

  const previewInfo = preview?.files

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 lg:py-12">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-noat-text-primary sm:text-3xl">НӨАТ-ын тулгалт</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-noat-text-muted sm:text-base">
          Дотоод нягтлан бодох бүртгэл ба И-баримтын өгөгдлийг автоматаар харьцуулан зөрүүг илрүүлэх систем
        </p>
      </header>

      <Card className="mb-4" title="1 · Файлуудаа оруулна уу" subtitle="Хоёр талын файлыг сонгоно (xlsx, xlsm, csv)">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FileDropzone
            label="Дотоод бүртгэл"
            hint="Байгууллагын дотоод бүртгэлийн Excel файл"
            file={internalFile}
            onFile={setInternalFile}
          />
          <FileDropzone
            label="И-баримт"
            hint="Татварын И-баримтын системийн экспорт"
            file={ebarimtFile}
            onFile={setEbarimtFile}
          />
        </div>
      </Card>

      <Card className="mb-4" title="2 · Тулгалтын тохиргоо" subtitle="Хүлцэл болон AI тохиргоог хянах боломжтой" padded>
        <ParamsForm initial={params} disabled={isPolling} onChange={setParams} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={<Eye className="size-4" />} disabled={!canPreview} loading={previewLoading} onClick={() => void handlePreview()}>
          Preview
        </Button>
        <Button icon={<Play className="size-4" />} disabled={!canStart} loading={isPolling} onClick={() => void handleStart()}>
          Тулгалт эхлүүлэх
        </Button>
        {jobId && status?.status === 'done' && (
          <Button variant="success" icon={<ArrowRight className="size-4" />} onClick={() => onShowResults(jobId)}>
            Үр дүнг үзэх
          </Button>
        )}
      </div>

      {(jobError || submitError) && (
        <div className="mt-4">
          <Alert tone="danger" title="Алдаа гарлаа">
            {jobError ?? submitError}
          </Alert>
        </div>
      )}

      {isPolling && status && (
        <div className="mt-6">
          <Card title="Тулгалт боловсруулж байна" padded>
            <ProgressBar
              value={status.progress ?? 0}
              label={STAGE_LABEL[status.stage ?? ''] ?? 'Боловсруулж байна…'}
              stage={status.stage}
            />
          </Card>
        </div>
      )}

      {previewInfo && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {(['internal', 'ebarimt'] as const).map((side) => {
            const info = previewInfo[side]
            const label = side === 'internal' ? 'Дотоод бүртгэл' : 'И-баримт'
            return (
              <Card key={side} title={`${label} — Preview`} padded>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-noat-text-muted">Мөрийн тоо</dt>
                    <dd className="tnum mt-0.5 font-semibold">{formatCount(info.row_count)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-noat-text-muted">Нийт дүн</dt>
                    <dd className="tnum mt-0.5 font-semibold">{formatMnt(info.total_amount)}₮</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-noat-text-muted">Огнооны хүрээ</dt>
                    <dd className="tnum mt-0.5">
                      {info.date_range[0] ? formatDate(info.date_range[0]) : '—'} —{' '}
                      {info.date_range[1] ? formatDate(info.date_range[1]) : '—'}
                    </dd>
                  </div>
                </dl>
                {info.warnings.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-noat-warning-soft px-3 py-2 text-xs text-noat-text-secondary">
                    <FileWarning className="mt-0.5 size-3.5 shrink-0 text-noat-warning" aria-hidden="true" />
                    <ul className="list-inside list-disc space-y-0.5">
                      {info.warnings.slice(0, 5).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                      {info.warnings.length > 5 && <li>…бусад {info.warnings.length - 5} анхааруулга</li>}
                    </ul>
                  </div>
                )}
                {info.issues.length > 0 && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-noat-danger-soft px-3 py-2 text-xs text-noat-text-secondary">
                    <FileWarning className="mt-0.5 size-3.5 shrink-0 text-noat-danger" aria-hidden="true" />
                    <span>
                      {info.issues.length} мөрөнд асуудал илэрсэн — файлаа шалгана уу
                    </span>
                  </div>
                )}
                {info.warnings.length === 0 && info.issues.length === 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-noat-success-soft px-3 py-2 text-xs text-noat-text-secondary">
                    <CheckCircle2 className="size-3.5 text-noat-success" aria-hidden="true" />
                    Файл хэвийн уншигдлаа
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {status?.status === 'error' && (
        <div className="mt-4">
          <Alert tone="danger" title="Тулгалт амжилтгүй боллоо">
            {status.message ?? status.error_code ?? 'Тодорхойгүй алдаа'}
          </Alert>
        </div>
      )}

      <footer className="mt-10">
        <AlgorithmNotice variant="compact" />
      </footer>
    </div>
  )
}

type LoadingState =
  | { kind: 'loading' }
  | { kind: 'processing'; progress: number; stage: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; result: ReconcileResult }

function NoatResults({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [state, setState] = useState<LoadingState>({ kind: 'loading' })
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [customer, setCustomer] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const r = await fetchResult(jobId)
      if (r.status === 'success' && r.data?.items) {
        setState({ kind: 'ready', result: r })
      } else if (r.status === 'processing' || r.status === 'queued') {
        setState({ kind: 'processing', progress: r.progress ?? 0, stage: r.message ?? '' })
      } else if (r.status === 'error') {
        setState({ kind: 'error', message: r.message ?? 'Тулгалт амжилтгүй болсон' })
      } else {
        setState({ kind: 'error', message: 'Үр дүнгийн мэдээлэл буруу байна' })
      }
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Үр дүн авахад алдаа гарлаа' })
    }
  }, [jobId])

  useEffect(() => {
    // async fetch: setState happens after await, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    if (state.kind !== 'processing') return
    const t = window.setTimeout(() => void load(), 1500)
    return () => window.clearTimeout(t)
  }, [state.kind, load])

  const handleExport = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    try {
      const blob = await exportExcel(jobId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tulgalt_${jobId}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Excel татахад алдаа гарлаа')
    } finally {
      setExporting(false)
    }
  }, [jobId])

  const aggregateTotals = useMemo(() => {
    if (state.kind !== 'ready') return null
    const sum = (rows: { total: number }[]) => rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0)
    return {
      internal: sum(state.result.aggregate.internal.months),
      ebarimt: sum(state.result.aggregate.ebarimt.months),
    }
  }, [state])

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-noat-text-muted">Үр дүнг ачаалж байна…</p>
      </div>
    )
  }

  if (state.kind === 'processing') {
    return (
      <div className="mx-auto flex min-h-96 max-w-md flex-col items-center justify-center gap-4 text-center">
        <Spinner size="lg" />
        <div>
          <p className="font-medium text-noat-text-primary">Тулгалт боловсруулж байна…</p>
          <p className="mt-1 text-sm text-noat-text-muted">{state.stage || 'Түр хүлээнэ үү'}</p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RefreshCw className="size-4" />
          Одоо шалгах
        </Button>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Alert tone="danger" title="Үр дүн авах боломжгүй">
          {state.message}
        </Alert>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
            Буцах
          </Button>
          <Button onClick={() => void load()}>
            <RefreshCw className="size-4" />
            Дахин оролдох
          </Button>
        </div>
      </div>
    )
  }

  const { result } = state

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
            Буцах
          </Button>
          <div>
            <h1 className="text-xl font-bold text-noat-text-primary sm:text-2xl">Тулгалтын үр дүн</h1>
            <p className="text-xs text-noat-text-muted">
              Job ID: <span className="tnum">{jobId}</span> · нийт{' '}
              <span className="tnum">{result.data.items.length}</span> мөр
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {exportError && <span className="text-xs text-noat-danger">{exportError}</span>}
          <Button onClick={() => void handleExport()} loading={exporting} icon={<Download className="size-4" />}>
            Excel татах
          </Button>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2 text-noat-text-secondary">
          <FileSpreadsheet className="size-4 text-noat-text-muted" aria-hidden="true" />
          Дотоод нийт: <span className="tnum font-semibold">{formatMnt(aggregateTotals?.internal ?? 0)}₮</span>
        </span>
        <span className="flex items-center gap-2 text-noat-text-secondary">
          И-баримт нийт: <span className="tnum font-semibold">{formatMnt(aggregateTotals?.ebarimt ?? 0)}₮</span>
        </span>
      </div>

      <div className="mb-5">
        <AlgorithmNotice variant="compact" />
      </div>

      <SummarySection summary={result.summary} onSelectCategory={setCategory} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalancePanel balance={result.balance} />
        <VatReturnCard vatReturn={result.aggregate.vat_return} />
        <RiskPanel items={result.data.items} />
      </div>

      <Card className="mt-4" title="Сарлаг нэгтгэл" subtitle="Дотоод бүртгэл ба И-баримтын дүнг сараар харьцуулалт">
        <MonthlyChart internal={result.aggregate.internal} ebarimt={result.aggregate.ebarimt} />
      </Card>

      <Card
        className="mt-4"
        title="Харилцагчаар харьцуулалт"
        subtitle="Дүнгийн зөрүүгээр эрэмбэлсэн — зөрүү ихтэй харилцагчдыг анхаарна уу"
      >
        <CustomerTable rows={result.aggregate.customer_comparison} onSelectCustomer={setCustomer} />
      </Card>

      <Card className="mt-4" title="Мөрийн дэлгэрэнгүй" padded={false}>
        <div className="p-4 pb-1">
          <p className="text-xs text-noat-text-muted">
            Мөр тус бүр дээр дарж AI тайлбар, дэлгэрэнгүй мэдээллийг үзнэ үү
          </p>
        </div>
        <div className="p-4">
          <ItemsTable items={result.data.items} initialCategory={category} customerFilter={customer} onClearCustomerFilter={() => setCustomer(null)} />
        </div>
      </Card>
    </div>
  )
}
