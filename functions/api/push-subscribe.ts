// POST /api/push-subscribe — 存瀏覽器的 PushSubscription 進 push_subs 表，供排程
// Worker（worker-cron/）讀出來送推播。需要登入。
// role 存的是前端選定的身分，留給「只通知某個人」的需求；目前 worker-cron 是全員都收。
// DELETE /api/push-subscribe：設定頁關閉提醒時依 endpoint 刪掉該筆訂閱。
import type { Env } from './_lib/env'

interface SubscribeBody {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
  role?: unknown
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: SubscribeBody
  try {
    body = await context.request.json()
  } catch {
    return jsonError(400, '請求格式錯誤')
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''
  const role = typeof body.role === 'string' ? body.role : ''
  if (!endpoint || !p256dh || !auth || !role) return jsonError(400, '缺少必要欄位')

  await context.env.DB.prepare(
    `INSERT INTO push_subs (endpoint, role, p256dh, auth, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET role=excluded.role, p256dh=excluded.p256dh, auth=excluded.auth`,
  )
    .bind(endpoint, role, p256dh, auth, Date.now())
    .run()

  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  let body: { endpoint?: unknown }
  try {
    body = await context.request.json()
  } catch {
    return jsonError(400, '請求格式錯誤')
  }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  if (!endpoint) return jsonError(400, '缺少 endpoint')

  await context.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run()
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
