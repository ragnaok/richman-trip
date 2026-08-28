// Web Push 訂閱管理（瀏覽器端）：要通知權限、訂閱/取消訂閱、把 PushSubscription
// 存進或移出 D1 的 push_subs 表。實際送推播是 worker-cron/ 的事。
//
// iOS 限制：需要 16.4+ 且以「加入主畫面」的 standalone 模式開啟，一般分頁收不到。
// 這裡不偵測平台，訂閱失敗時由呼叫端顯示回傳的錯誤訊息。
import { apiFetch } from './api'

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

/** VAPID 公鑰是 URL-safe base64，pushManager.subscribe() 要吃 BufferSource。
 * 回傳型別標成 `Uint8Array<ArrayBuffer>` 而非 ArrayBufferLike：lib.dom 會區分
 * SharedArrayBuffer 背後的 typed array，不標明會讓 applicationServerKey 型別不合。 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/** 要通知權限 + 訂閱 + 存到伺服器。失敗（含使用者拒絕權限）回傳錯誤訊息字串，成功回傳 null。 */
export async function enablePushReminders(role: string): Promise<string | null> {
  if (!isPushSupported()) return '這個瀏覽器不支援推播通知'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return '沒有取得通知權限，無法開啟提醒'

  try {
    const keyRes = await apiFetch('/api/vapid-public-key')
    const { key } = (await keyRes.json()) as { key: string }
    if (!key) return '伺服器尚未設定推播金鑰'

    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })

    const res = await apiFetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), role }),
    })
    if (!res.ok) return '訂閱已建立但同步到伺服器失敗，稍後再試一次'
    return null
  } catch {
    return '訂閱失敗，請確認已把這個 App 加到主畫面後再試一次'
  }
}

/** 立即送一則測試推播到目前訂閱的裝置，不用等排程 Worker。回傳錯誤訊息或 null（成功）。 */
export async function sendTestPush(): Promise<string | null> {
  const subscription = await getExistingSubscription()
  if (!subscription) return '還沒開啟推播提醒'
  try {
    const res = await apiFetch('/api/push-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      return data?.error || '發送測試推播失敗'
    }
    return null
  } catch {
    return '發送測試推播失敗'
  }
}

/** 取消瀏覽器訂閱並從伺服器移除。 */
export async function disablePushReminders(): Promise<void> {
  const subscription = await getExistingSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => {})
  await apiFetch('/api/push-subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
}
