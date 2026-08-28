// GET /api/whoami — 前端在「IndexedDB 說已登入」時用來輕量驗證 cookie 是否還有效。
// 認證由 _middleware.ts 擋掉，能跑到這裡就代表 cookie 有效；cookie 不帶角色，
// 所以只回是否有效，不回身分。
import type { Env } from './_lib/env'
import { getCookie, verifySession, SESSION_COOKIE_NAME } from './_lib/session'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cookieValue = getCookie(context.request, SESSION_COOKIE_NAME)
  const session = cookieValue ? await verifySession(cookieValue, context.env.SESSION_SECRET) : null
  if (!session) {
    return new Response(JSON.stringify({ error: '未登入' }), { status: 401, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
}
