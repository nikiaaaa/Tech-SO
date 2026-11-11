const BASE = '/api/v1'
const TOKEN_KEY = 'techso.token'

/** Desktop keeps the token for the tab only; the technician app keeps it on the device so it survives restarts and offline use. */
export const session = {
  get(): string | null {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
  },
  set(token: string, persistent: boolean) {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
    ;(persistent ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
  },
  clear() {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
  },
}

export class ApiError extends Error {
  status: number
  detail: unknown
  /** true when the request never reached the server (offline, DNS, server down) */
  network: boolean
  constructor(status: number, detail: unknown, network = false) {
    super(messageFrom(detail, status, network))
    this.status = status
    this.detail = detail
    this.network = network
  }
}

function messageFrom(detail: unknown, status: number, network: boolean): string {
  if (network) return 'Cannot reach the server. Check your connection.'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.') || 'field'}: ${d.msg ?? 'invalid'}`).join('; ')
  }
  return `Request failed (${status})`
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong')

async function request<T>(method: string, path: string, body?: unknown, extra?: { form?: FormData; raw?: 'blob' | 'text' }): Promise<T> {
  const headers: Record<string, string> = {}
  const token = session.get()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (extra?.form) payload = extra.form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(BASE + path, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, null, true)
  }
  if (!res.ok) {
    let detail: unknown = null
    try {
      detail = (await res.json()).detail
    } catch { /* body is not JSON */ }
    if (res.status === 401 && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('techso:unauthorized'))
    throw new ApiError(res.status, detail)
  }
  if (extra?.raw === 'blob') return (await res.blob()) as T
  if (extra?.raw === 'text') return (await res.text()) as T
  return (res.status === 204 ? undefined : await res.json()) as T
}

const qs = (p?: Record<string, string | number | boolean | undefined | null>) => {
  if (!p) return ''
  const u = new URLSearchParams()
  Object.entries(p).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && u.set(k, String(v)))
  const s = u.toString()
  return s ? `?${s}` : ''
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) => request<T>('GET', path + qs(params)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, undefined, { form }),
  /** Protected binary (evidence photos): fetched with the token, then shown through an object URL. */
  blob: (path: string) => request<Blob>('GET', path, undefined, { raw: 'blob' }),
  /** CSV export; returns the file text. */
  text: (path: string, params?: Record<string, string | number | undefined>) => request<string>('GET', path + qs(params), undefined, { raw: 'text' }),
}

export function download(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
