// GET /api/vapid-public-key — 免認證。公鑰本來就要交給 pushManager.subscribe()，
// 走端點只是為了換金鑰時改 Secret 就好，不用重新部署前端。
import type { Env } from './_lib/env'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return new Response(JSON.stringify({ key: context.env.VAPID_PUBLIC_KEY ?? '' }), {
    headers: { 'content-type': 'application/json' },
  })
}
