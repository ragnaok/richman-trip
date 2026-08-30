// GET /api/version — 需要登入（設定頁本來就只有登入後看得到）。
// CF_PAGES_COMMIT_SHA 是 wrangler pages deploy 部署當下自動依本機 git HEAD 注入的，
// 不用另外維護；截到跟前端 __GIT_HASH__（vite.config.ts）同樣的 7 碼方便直接比對。
import type { Env } from './_lib/env'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const commit = context.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? null
  return new Response(JSON.stringify({ commit }), {
    headers: { 'content-type': 'application/json' },
  })
}
