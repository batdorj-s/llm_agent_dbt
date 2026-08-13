import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJobStatus } from '../api/reconcile'
import type { JobStatus } from '../api/types'

interface UseJobPollingResult {
  status: JobStatus | null
  error: string | null
  start: (jobId: string) => void
  stop: () => void
  isPolling: boolean
}

/**
 * Job-ын статусыг 1.5с тутамд polling хийх hook.
 * done/error болсон үед автоматаар зогсоно.
 */
export function useJobPolling(onDone?: (jobId: string) => void): UseJobPollingResult {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    jobIdRef.current = null
  }, [])

  const pollOnce = useCallback(async () => {
    const jobId = jobIdRef.current
    if (!jobId) return
    try {
      const s = await fetchJobStatus(jobId)
      setStatus(s)
      if (s.status === 'done' || s.status === 'error') {
        stop()
        if (s.status === 'done') onDoneRef.current?.(jobId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Статус авахад алдаа гарлаа')
      stop()
    }
  }, [stop])

  const start = useCallback(
    (jobId: string) => {
      stop()
      setError(null)
      setStatus({ status: 'queued', progress: 0, stage: '' })
      jobIdRef.current = jobId
      void pollOnce()
      timerRef.current = window.setInterval(() => void pollOnce(), 1500)
    },
    [pollOnce, stop],
  )

  useEffect(() => stop, [stop])

  return { status, error, start, stop, isPolling: status !== null && status.status !== 'done' && status.status !== 'error' }
}
