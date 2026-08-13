/** Fetch-д суурилсан API клиент (axios-гүй) */

export const API_BASE = '/api/noat'

export async function parseError(res: Response): Promise<Error> {
  let message = 'Алдаа гарлаа'
  try {
    const data = await res.json()
    const detail = data?.detail
    if (detail && typeof detail === 'object') {
      message = `${detail.message ?? 'Алдаа гарлаа'}${detail.error_code ? ` (${detail.error_code})` : ''}`
    } else if (detail && typeof detail === 'string') {
      message = detail
    }
  } catch {
    message = `Серверийн алдаа (${res.status})`
  }
  return new Error(message)
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new Error('Серверт холбогдож чадсангүй. Backend ажиллаж байгаа эсэхийг шалгана уу.')
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Backend URL-ийн зөв эсэхийг шалгах (health) */
export async function checkHealth(): Promise<{ ok: boolean; aiAvailable: boolean }> {
  try {
    const data = await request<{ status?: string; ai_available?: boolean }>('/health')
    return { ok: data?.status === 'ok', aiAvailable: Boolean(data?.ai_available) }
  } catch {
    return { ok: false, aiAvailable: false }
  }
}
