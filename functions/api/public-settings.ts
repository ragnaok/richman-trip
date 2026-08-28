// GET /api/public-settings — 免認證（見 _middleware.ts 的 PUBLIC_PATHS）。
// 登入畫面本來就要顯示的目的地/日期/主視覺，不是機密。刻意只挑這幾個 key，
// 避免變成「不用登入就能拉全部 settings」的後門。
import type { Env } from './_lib/env'

const PUBLIC_KEYS = ['destTitle', 'destSubtitle', 'tripStart', 'tripEnd', 'heroPhoto']

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const placeholders = PUBLIC_KEYS.map(() => '?').join(',')
  const result = await context.env.DB.prepare(`SELECT k, v, updated_at FROM settings WHERE k IN (${placeholders})`)
    .bind(...PUBLIC_KEYS)
    .all<{ k: string; v: string; updated_at: number }>()

  return new Response(JSON.stringify({ settings: result.results }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  })
}
