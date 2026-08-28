// POST /api/login：body {password} → 比對共用密碼 PW_SHARED → 簽 session cookie。
// 只驗證「是不是自己人」，角色由前端登入後另外選（見 src/lib/auth.ts）。
//
// 密碼比對的取捨：PW_SHARED 存明文，argon2/bcrypt 在 Workers runtime 要額外
// WASM/polyfill，對這種規模的專案成本過高。比對時兩邊各跑一次 SHA-256 再比雜湊，
// 只是把逐字元短路比對換成定長比對，擋不了「env 已外洩」的情境。
// 正式上線建議升級成 argon2/bcrypt 並只在 Secret 存雜湊值。
import type { Env } from './_lib/env'
import { signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './_lib/session'

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  let body: { password?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError(400, '請求格式錯誤')
  }

  const password = typeof body.password === 'string' ? body.password : ''

  // README：失敗延遲 1 秒（Cloudflare Rate Limiting 部分要在 Dashboard 另外設定，
  // 純本機開發做不到，見總結說明）。
  let ok = false
  if (password && env.PW_SHARED) {
    const inputHash = await sha256Hex(password)
    const pwHash = await sha256Hex(env.PW_SHARED)
    ok = inputHash === pwHash
  }

  if (!ok) {
    await new Promise((r) => setTimeout(r, 1000))
    return jsonError(401, '密碼不正確')
  }

  const cookieValue = await signSession(env.SESSION_SECRET)
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  )
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
