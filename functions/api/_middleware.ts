// 對所有 /api/* 驗證 session cookie，失敗回 401。
// 白名單五個路徑：login/logout（登入前就要呼叫）、weather、vapid-public-key（要交給
// pushManager.subscribe() 的公鑰）、public-settings（登入畫面要顯示的目的地/日期）。
import type { Env } from './_lib/env'
import { getCookie, verifySession, SESSION_COOKIE_NAME } from './_lib/session'

const PUBLIC_PATHS = new Set([
  '/api/login',
  '/api/logout',
  '/api/weather',
  '/api/vapid-public-key',
  '/api/public-settings',
])

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  if (PUBLIC_PATHS.has(url.pathname)) {
    return context.next()
  }

  const cookieValue = getCookie(context.request, SESSION_COOKIE_NAME)
  const session = cookieValue ? await verifySession(cookieValue, context.env.SESSION_SECRET) : null
  if (!session) {
    return new Response(JSON.stringify({ error: '未登入或登入已過期' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  // cookie 不帶角色（「誰付的」「持有人」都是畫面上手動選的），所以沒有角色可掛進
  // context.data。
  return context.next()
}
