// 共用 fetch wrapper：/api/* 一律 credentials:'same-origin'，401 就清登入旗標。
// auth.ts 與 sync.ts 都透過它打 API，這條規則只實作一次。
import * as db from './db'
import { useStore } from './store'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * 對 /api/* 發請求。401 時清 IndexedDB 的登入旗標並把 store 的登入狀態設回未登入；
 * AuthGate 掛在 App.tsx 看 store.ui.auth 渲染，這裡不需要碰路由。
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' })
  if (res.status === 401) {
    await db.setMeta('loggedIn', false)
    useStore.getState().setAuth({ status: 'loggedOut', role: null })
  }
  return res
}

export async function apiFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, (body as { error?: string }).error ?? `請求失敗（${res.status}）`)
  }
  return res.json() as Promise<T>
}
