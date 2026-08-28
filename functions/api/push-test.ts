// POST /api/push-test — 立即對指定 endpoint 送一則測試推播（設定頁「測試推播」）。
// 用來單獨驗證訂閱／Service Worker／iOS standalone 這條路徑，不必等 Cron Trigger。
import { buildPushHTTPRequest } from '@pushforge/builder'
import type { Env } from './_lib/env'

const ADMIN_CONTACT = 'mailto:my-trip@example.com'

interface PushSubRow {
  endpoint: string
  p256dh: string
  auth: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { endpoint?: unknown }
  try {
    body = await context.request.json()
  } catch {
    return jsonError(400, '請求格式錯誤')
  }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  if (!endpoint) return jsonError(400, '缺少 endpoint')

  const sub = await context.env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE endpoint = ?')
    .bind(endpoint)
    .first<PushSubRow>()
  if (!sub) return jsonError(404, '找不到這個裝置的訂閱，請先開啟推播提醒')

  try {
    const privateJWK = JSON.parse(context.env.VAPID_PRIVATE_KEY) as JsonWebKey
    const { endpoint: pushEndpoint, headers, body: pushBody } = await buildPushHTTPRequest({
      privateJWK,
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      message: {
        payload: { title: '測試推播', body: '如果你看到這則通知，推播設定是正常的。', tag: 'push-test', data: { url: '/' } },
        adminContact: ADMIN_CONTACT,
        options: { urgency: 'high', ttl: 60 },
      },
    })
    const res = await fetch(pushEndpoint, { method: 'POST', headers, body: pushBody })
    if (!res.ok) return jsonError(502, `推播服務回應失敗（${res.status}）`)
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
  } catch {
    return jsonError(500, '發送測試推播失敗')
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
