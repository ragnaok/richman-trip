// POST /api/logout — 清 cookie（Max-Age=0）。
import type { Env } from './_lib/env'
import { SESSION_COOKIE_NAME } from './_lib/session'

export const onRequestPost: PagesFunction<Env> = async () => {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.append('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`)
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
}
