// 登入/登出：單一共用密碼 → 登入成功後前端選身分。
// IndexedDB 的 loggedIn/role 旗標讓離線可直接進 App，連線時則以 cookie 為唯一憑證，
// bootstrapAuth() 負責「先樂觀顯示、背景驗證」。cookie 不帶角色，角色只是本地偏好。
import * as db from './db'
import { apiFetch } from './api'
import { pull, pullPublicSettings } from './sync'
import { useStore } from './store'
import type { Payer as Role } from './types'

export type { Role }

/** App 啟動時呼叫一次：讀 IndexedDB 的登入旗標決定要不要先跳過 AuthGate，並背景驗證 cookie。 */
export async function bootstrapAuth(): Promise<void> {
  const loggedIn = await db.getMeta<boolean>('loggedIn')
  const role = await db.getMeta<Role>('role')

  if (loggedIn && role) {
    // 樂觀顯示 App，cookie 由背景驗證。
    useStore.getState().setAuth({ status: 'loggedIn', role })
    void verifySessionInBackground()
  } else if (loggedIn) {
    // 密碼驗證過但還沒選身分：回到選身分畫面，不用重新輸密碼。
    useStore.getState().setAuth({ status: 'pickingRole', role: null })
    void pull() // 見 login() 的說明：選身分畫面的選項來自這次 pull
  } else {
    useStore.getState().setAuth({ status: 'loggedOut', role: null })
    // 密碼輸入畫面的主視覺/標題/日期要顯示這趟行程真正的設定，不是本機種子；
    // 這幾個欄位走免認證的 pullPublicSettings()。
    void pullPublicSettings()
  }
}

/** 背景打一次需要認證的端點確認 cookie 仍有效；401 時 apiFetch 會自動清旗標、跳回 AuthGate。
 *  離線／網路錯誤不算「未登入」，維持樂觀狀態。 */
async function verifySessionInBackground(): Promise<void> {
  try {
    await apiFetch('/api/whoami')
  } catch {
    // 離線：維持 IndexedDB 的樂觀登入狀態，之後連線時的 sync 觸發會再驗證一次。
  }
}

/** 密碼驗證。成功後還沒有身分，轉入 'pickingRole'（見 pickRole）。 */
export async function login(password: string): Promise<void> {
  const res = await apiFetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    throw new Error((body.error as string | undefined) ?? '登入失敗')
  }
  await db.setMeta('loggedIn', true)
  useStore.getState().setAuth({ status: 'pickingRole', role: null })
  // 密碼通過後 session cookie 已有效，立刻 pull 一次，讓選身分畫面拿到真正的成員
  // 清單——本機沒有預塞範例身分，少了這次 pull 選項會是空的。
  void pull()
}

/** 選身分。純本地偏好，不呼叫任何 API。 */
export async function pickRole(role: Role): Promise<void> {
  await db.setMeta('role', role)
  useStore.getState().setAuth({ status: 'loggedIn', role })
}

/**
 * 記帳頁「切換身分」：不登出、不重輸密碼，只是借用 'pickingRole' 狀態回到選身分畫面；
 * session cookie 與 loggedIn 旗標都不動。
 */
export function switchRole(): void {
  useStore.getState().setAuth({ status: 'pickingRole', role: null })
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/logout', { method: 'POST' })
  } catch {
    // 離線登出仍清本地狀態；cookie 留到過期，但下次進 App 一定要重新輸密碼。
  }
  await db.setMeta('loggedIn', false)
  await db.setMeta('role', null)
  useStore.getState().setAuth({ status: 'loggedOut', role: null })
}
