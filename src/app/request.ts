/**
 * Obsidian's `requestUrl` / `request`: HTTP from the main process, so plugins are not stopped by CORS.
 * The result promise also has `.json` / `.text` / `.arrayBuffer`, as in Obsidian.
 */
import { ipcRenderer } from 'electron'

export interface RequestUrlParam {
  url: string
  method?: string
  contentType?: string
  body?: string | ArrayBuffer
  headers?: Record<string, string>
  /** default true: a status ≥ 400 rejects */
  throw?: boolean
}
export interface RequestUrlResponse {
  status: number
  headers: Record<string, string>
  arrayBuffer: ArrayBuffer
  text: string
  json: any
}
interface Raw { status: number; headers: Record<string, string>; body: ArrayBuffer }

export function requestUrl(request: string | RequestUrlParam) {
  const p = typeof request === 'string' ? { url: request } : request
  const headers = { ...p.headers, ...(p.contentType ? { 'content-type': p.contentType } : {}) }
  const promise = (ipcRenderer.invoke('request-url', { url: p.url, method: p.method ?? 'GET', headers, body: p.body }) as Promise<Raw>).then((r) => {
    const text = new TextDecoder().decode(r.body)
    const res: RequestUrlResponse = {
      status: r.status,
      headers: r.headers,
      arrayBuffer: r.body,
      text,
      get json() { return JSON.parse(text) },
    }
    if (p.throw !== false && r.status >= 400) throw Object.assign(new Error(`Request failed, status ${r.status}`), res)
    return res
  })
  return Object.assign(promise, {
    get json() { return promise.then((r) => r.json) },
    get text() { return promise.then((r) => r.text) },
    get arrayBuffer() { return promise.then((r) => r.arrayBuffer) },
  })
}

export async function request(req: string | RequestUrlParam): Promise<string> {
  return (await requestUrl(req)).text
}
