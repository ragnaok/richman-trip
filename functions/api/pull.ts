// GET /api/pull?since=<ms>：各表 SELECT * WHERE updated_at > ?，回 {server_now, …}，
// 含 deleted=1 的墓碑列，由客戶端自行處理。
import type { Env } from './_lib/env'

const TABLES = ['plans', 'spots_meta', 'pack_items', 'expenses', 'cats', 'settings', 'spots', 'members', 'hotels'] as const

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const since = Number(url.searchParams.get('since') ?? '0')
  const sinceVal = Number.isFinite(since) ? since : 0

  const server_now = Date.now()

  const results = await Promise.all(
    TABLES.map((table) =>
      context.env.DB.prepare(`SELECT * FROM ${table} WHERE updated_at > ?`).bind(sinceVal).all(),
    ),
  )

  const body: Record<string, unknown> = { server_now }
  TABLES.forEach((table, i) => {
    body[table] = results[i].results ?? []
  })

  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}
