// POST /api/push：body {ops:[{table,row}]}，每筆依表名做 LWW upsert
// （ON CONFLICT … WHERE excluded.updated_at > <table>.updated_at），包在一次
// env.DB.batch() 交易裡，回傳實際寫入的列供客戶端對帳。
// 注意 plans 的欄位是 kind，客戶端 PlanItem 用 `k`，這裡負責對映。
import type { Env } from './_lib/env'

type Row = Record<string, unknown>
interface Op {
  table: string
  row: Row
}

function toInt01(v: unknown): number {
  return v ? 1 : 0
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  return typeof v === 'string' ? v : String(v)
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// lat/lon 未設定要存 NULL：0,0 是真實座標，會被 weather.ts 誤判成「有設座標」。
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface TableSpec {
  columns: string[]
  conflictKeys: string[]
  hasDeleted: boolean
  /** row（客戶端 op payload）→ 依 columns 順序的 bind 值。 */
  bind: (row: Row) => unknown[]
}

const TABLE_SPECS: Record<string, TableSpec> = {
  plans: {
    columns: ['id', 'day', 't', 'title', 'sub', 'kind', 'q', 'spot', 'cands', 'drive', 'park', 'notify', 'lead', 'remind_at', 'photo', 'updated_at', 'deleted'],
    conflictKeys: ['id'],
    hasDeleted: true,
    bind: (r) => [
      str(r.id), str(r.day), str(r.t), str(r.title), str(r.sub) ?? '', str(r.k ?? r.kind),
      str(r.q) ?? '', str(r.spot), r.cands != null ? JSON.stringify(r.cands) : null,
      str(r.drive), str(r.park), toInt01(r.notify), num(r.lead, 30), str(r.remindAt ?? r.remind_at), str(r.photo),
      num(r.updated_at), toInt01(r.deleted),
    ],
  },
  spots_meta: {
    columns: ['id', 'visited', 'note', 'photo', 'updated_at', 'deleted'],
    conflictKeys: ['id'],
    hasDeleted: true,
    bind: (r) => [str(r.id), toInt01(r.visited), str(r.note) ?? '', str(r.photo), num(r.updated_at), toInt01(r.deleted)],
  },
  pack_items: {
    columns: ['id', 'cat', 'name', 'owner', 'done', 'updated_at', 'deleted'],
    conflictKeys: ['id'],
    hasDeleted: true,
    bind: (r) => [str(r.id), str(r.cat), str(r.name), str(r.owner), toInt01(r.done), num(r.updated_at), toInt01(r.deleted)],
  },
  expenses: {
    columns: ['id', 'title', 'cat', 'cur', 'amt', 'payer', 'method', 'daigou', 'spent_on', 'updated_at', 'deleted'],
    conflictKeys: ['id'],
    hasDeleted: true,
    bind: (r) => [
      str(r.id), str(r.title), str(r.cat), str(r.cur), num(r.amt), str(r.payer), str(r.method), toInt01(r.daigou), str(r.spent_on),
      num(r.updated_at), toInt01(r.deleted),
    ],
  },
  cats: {
    columns: ['kind', 'name', 'updated_at', 'deleted'],
    conflictKeys: ['kind', 'name'],
    hasDeleted: true,
    bind: (r) => [str(r.kind), str(r.name), num(r.updated_at), toInt01(r.deleted)],
  },
  settings: {
    columns: ['k', 'v', 'updated_at'],
    conflictKeys: ['k'],
    hasDeleted: false,
    bind: (r) => [str(r.k), str(r.v), num(r.updated_at)],
  },
  spots: {
    columns: ['id', 'name', 'jp', 'area', 'teaser', 'intro', 'hours', 'fee', 'access', 'walk', 'food', 'q', 'updated_at', 'deleted'],
    conflictKeys: ['id'],
    hasDeleted: true,
    bind: (r) => [
      str(r.id), str(r.name), str(r.jp) ?? '', str(r.area) ?? '',
      str(r.teaser) ?? '', str(r.intro) ?? '', str(r.hours) ?? '', str(r.fee) ?? '', str(r.access) ?? '',
      r.walk != null ? JSON.stringify(r.walk) : '[]', r.food != null ? JSON.stringify(r.food) : '[]',
      str(r.q) ?? '', num(r.updated_at), toInt01(r.deleted),
    ],
  },
  members: {
    columns: ['role', 'updated_at', 'deleted'],
    conflictKeys: ['role'],
    hasDeleted: true,
    bind: (r) => [str(r.role), num(r.updated_at), toInt01(r.deleted)],
  },
  hotels: {
    columns: ['id', 'name', 'q', 'checkin', 'checkout', 'lat', 'lon', 'updated_at', 'deleted'],
    conflictKeys: ['id'],
    hasDeleted: true,
    bind: (r) => [
      str(r.id), str(r.name), str(r.q) ?? '', str(r.checkin) ?? '', str(r.checkout) ?? '',
      numOrNull(r.lat), numOrNull(r.lon), num(r.updated_at), toInt01(r.deleted),
    ],
  },
}

function buildUpsertSql(table: string, spec: TableSpec): string {
  const cols = spec.columns.join(',')
  const placeholders = spec.columns.map(() => '?').join(',')
  const updateCols = spec.columns.filter((c) => !spec.conflictKeys.includes(c))
  const setClause = updateCols.map((c) => `${c}=excluded.${c}`).join(', ')
  const conflictTarget = spec.conflictKeys.join(',')
  return (
    `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ` +
    `ON CONFLICT(${conflictTarget}) DO UPDATE SET ${setClause} ` +
    `WHERE excluded.updated_at > ${table}.updated_at`
  )
}

/** day('M/D') + t('HH:MM')（皆為日本時間）換算成 fire_at（UTC ms），扣掉提前分鐘數。
 * 跟 worker-cron/src/index.ts 的同名函式邏輯一致——兩邊是各自獨立的部署單位（worker-cron
 * 不是 Pages Functions 的一部分，見 wrangler.toml 開頭註解），沒有共用套件可以 import，
 * 這個純函式很小，重複貼一份比硬拉共用套件簡單。 */
function computeFireAt(year: number, day: string, t: string, leadMinutes: number): number | null {
  const dayMatch = /^(\d{1,2})\/(\d{1,2})$/.exec(day)
  const timeMatch = /^(\d{1,2}):(\d{1,2})$/.exec(t)
  if (!dayMatch || !timeMatch) return null
  const month = Number(dayMatch[1])
  const date = Number(dayMatch[2])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const jstMs = Date.UTC(year, month - 1, date, hour, minute) - 9 * 60 * 60 * 1000
  return jstMs - leadMinutes * 60 * 1000
}

/** remind_at('YYYY-MM-DDTHH:MM'，日本時間) 換算成 fire_at（UTC ms），不扣提前分鐘數。 */
function computeAbsoluteFireAt(remindAt: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(remindAt)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - 9 * 60 * 60 * 1000
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { ops?: unknown }
  try {
    body = await context.request.json()
  } catch {
    return jsonError(400, '請求格式錯誤')
  }

  const ops = Array.isArray(body.ops) ? (body.ops as Op[]) : []
  if (ops.length === 0) {
    return new Response(JSON.stringify({ written: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const statements = []
  const candidates: Op[] = []
  for (const op of ops) {
    const spec = TABLE_SPECS[op.table]
    if (!spec || !op.row) continue
    const sql = buildUpsertSql(op.table, spec)
    statements.push(context.env.DB.prepare(sql).bind(...spec.bind(op.row)))
    candidates.push(op)
  }

  // 用 batch 結果的 meta.changes 判斷該筆 upsert 是否真的套用：LWW 輸掉時 changes=0，
  // 代表伺服器已有更新版本，這筆不該被客戶端當成「已送達」清掉。
  const written: Op[] = []
  if (statements.length > 0) {
    const results = await context.env.DB.batch(statements)
    results.forEach((res, i) => {
      if ((res.meta?.changes ?? 0) > 0) written.push(candidates[i])
    })
  }

  // 行程提醒即時同步，不用等 worker-cron 下一輪。reminders 仍是純衍生快取，
  // worker-cron 的整批重算照舊留著當保險，兩邊算出的 fire_at 應該一致。
  const writtenPlans = written.filter((op) => op.table === 'plans')
  if (writtenPlans.length > 0) {
    const tripStartRow = await context.env.DB.prepare("SELECT v FROM settings WHERE k = 'tripStart'").first<{ v: string }>()
    const year = tripStartRow?.v ? Number(tripStartRow.v.slice(0, 4)) : 2026

    const reminderStatements = writtenPlans.map((op) => {
      const r = op.row
      const planId = str(r.id)
      const deleted = toInt01(r.deleted) === 1
      const notify = toInt01(r.notify) === 1
      const remindAt = str(r.remindAt ?? r.remind_at)
      const fireAt = deleted || !notify
        ? null
        : remindAt
          ? computeAbsoluteFireAt(remindAt)
          : computeFireAt(year, str(r.day) ?? '', str(r.t) ?? '', num(r.lead, 30))

      if (fireAt == null) {
        return context.env.DB.prepare('DELETE FROM reminders WHERE plan_id = ?').bind(planId)
      }
      return context.env.DB
        .prepare(
          'INSERT INTO reminders (plan_id, fire_at, sent_at) VALUES (?,?,NULL) ' +
            'ON CONFLICT(plan_id) DO UPDATE SET fire_at=excluded.fire_at, sent_at=NULL WHERE excluded.fire_at != reminders.fire_at',
        )
        .bind(planId, fireAt)
    })
    await context.env.DB.batch(reminderStatements)
  }

  return new Response(JSON.stringify({ written }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
