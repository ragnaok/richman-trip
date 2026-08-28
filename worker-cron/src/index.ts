// 獨立 Worker，每分鐘跑一次（為什麼獨立部署見 wrangler.toml）。職責：把 plans 裡
// notify=1 的行程換算成 reminders.fire_at（跟舊值比對，時間變了才重算並清掉 sent_at
// 讓它能再發一次），再找出到時間但還沒發的 reminders 送 Web Push，成功記 sent_at，
// 訂閱失效（404/410）就從 push_subs 刪掉。
//
// reminders 是純從 plans 衍生的快取，每輪整批重算：比在各個寫入路徑同步 reminders
// 簡單，也不會因為漏掉某條路徑而脫節（自我修復），資料量小、成本可忽略。
//
// Cron Trigger 在這個帳號上實測完全沒被觸發（排程有登記、手動打 HTTP 進得去，但 cron
// 觸發次數是 0），是 Cloudflare 平台端的已知問題，所以加了 fetch handler 當備援：
// 外部 cron 服務帶對 CRON_SECRET 打進來就跑同一套邏輯。scheduled() 留著，哪天平台
// 修好會自動接手，兩邊同時觸發也不會重複發送（sent_at 天然去重）。
import { buildPushHTTPRequest } from '@pushforge/builder'

interface Env {
  VAPID_PRIVATE_KEY: string
  CRON_SECRET: string
  // 每趟行程各自的 D1 binding 加在這裡，例如 DB_INUYAMA: D1Database（見下方 TRIPS）。
}

// 一支 Worker 共用給所有用這套模板開的行程，各趟行程的 D1 完全獨立。
// 開新行程：wrangler.toml 加一組 [[d1_databases]]，這裡加一筆對應項目，例如：
// { name: 'inuyama', db: (env) => env.DB_INUYAMA }
interface TripConfig {
  name: string
  db: (env: Env) => D1Database
}

const TRIPS: TripConfig[] = []

interface PlanRow {
  id: string
  day: string // 'M/D'
  t: string // 'HH:MM' 或 '—'
  lead: number
  remind_at: string | null // 'YYYY-MM-DDTHH:MM'（JST），有值時取代 day+t-lead 的相對算法
  title: string
  sub: string
}

interface ReminderRow {
  plan_id: string
  fire_at: number
  sent_at: number | null
}

interface PushSubRow {
  endpoint: string
  role: string
  p256dh: string
  auth: string
}

const ADMIN_CONTACT = 'mailto:inuyama-trip@example.com' // Web Push 協定要求的聯絡方式

/** day('M/D') + t('HH:MM')（日本時間）換算成 fire_at（UTC ms），扣掉提前分鐘數。
 * year 來自 settings.tripStart，沒有寫死任何行程假設。 */
function computeFireAt(year: number, day: string, t: string, leadMinutes: number): number | null {
  const dayMatch = /^(\d{1,2})\/(\d{1,2})$/.exec(day)
  const timeMatch = /^(\d{1,2}):(\d{1,2})$/.exec(t)
  if (!dayMatch || !timeMatch) return null
  const month = Number(dayMatch[1])
  const date = Number(dayMatch[2])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const jstMs = Date.UTC(year, month - 1, date, hour, minute) - 9 * 60 * 60 * 1000 // JST = UTC+9
  return jstMs - leadMinutes * 60 * 1000
}

/** remind_at('YYYY-MM-DDTHH:MM'，日本時間，datetime-local 原生格式) 換算成 fire_at（UTC ms）。
 * 跟 computeFireAt 不同：這是使用者直接指定的絕對時間，不扣提前分鐘數。 */
function computeAbsoluteFireAt(remindAt: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(remindAt)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - 9 * 60 * 60 * 1000
}

/** 整批重算 reminders：新增/更新有效提醒的 fire_at，刪掉不再有效的（notify 關掉、
 * 時間清空、行程被刪）。回傳重算後的 plan 對照表，送通知內容要用。 */
async function resyncReminders(db: D1Database, plans: PlanRow[]): Promise<Map<string, PlanRow>> {
  const planMap = new Map(plans.map((p) => [p.id, p]))

  const tripStartRow = await db.prepare("SELECT v FROM settings WHERE k = 'tripStart'").first<{ v: string }>()
  const year = tripStartRow?.v ? Number(tripStartRow.v.slice(0, 4)) : 2026

  const existingRows = await db.prepare('SELECT plan_id, fire_at, sent_at FROM reminders').all<ReminderRow>()
  const existingMap = new Map(existingRows.results.map((r) => [r.plan_id, r]))

  const statements: D1PreparedStatement[] = []

  for (const plan of plans) {
    const fireAt = plan.remind_at ? computeAbsoluteFireAt(plan.remind_at) : computeFireAt(year, plan.day, plan.t, plan.lead)
    if (fireAt == null) continue
    const existing = existingMap.get(plan.id)
    if (!existing) {
      statements.push(
        db
          .prepare('INSERT INTO reminders (plan_id, fire_at, sent_at) VALUES (?,?,NULL)')
          .bind(plan.id, fireAt),
      )
    } else if (existing.fire_at !== fireAt) {
      // 時間變了：重設 sent_at，讓它用新時間再發一次。
      statements.push(
        db.prepare('UPDATE reminders SET fire_at = ?, sent_at = NULL WHERE plan_id = ?').bind(fireAt, plan.id),
      )
    }
  }

  for (const existing of existingRows.results) {
    if (!planMap.has(existing.plan_id)) {
      statements.push(db.prepare('DELETE FROM reminders WHERE plan_id = ?').bind(existing.plan_id))
    }
  }

  if (statements.length > 0) await db.batch(statements)
  return planMap
}

function buildNotificationPayload(plan: PlanRow) {
  const time = plan.t === '—' ? '' : `${plan.t} · `
  return {
    title: `行程提醒：${plan.title}`,
    body: `${plan.day} ${time}${plan.sub || ''}`.trim(),
    tag: `plan-${plan.id}`,
    data: { url: '/' },
  }
}

async function sendDueReminders(db: D1Database, vapidPrivateKey: string, planMap: Map<string, PlanRow>) {
  const now = Date.now()
  const due = await db
    .prepare('SELECT plan_id, fire_at, sent_at FROM reminders WHERE sent_at IS NULL AND fire_at <= ?')
    .bind(now)
    .all<ReminderRow>()
  if (due.results.length === 0) return

  const subs = await db.prepare('SELECT endpoint, role, p256dh, auth FROM push_subs').all<PushSubRow>()
  if (subs.results.length === 0) {
    // 沒人訂閱也要標記已發送，否則這幾筆每分鐘都會被判定「到時間但沒發」。
    const statements = due.results.map((r) =>
      db.prepare('UPDATE reminders SET sent_at = ? WHERE plan_id = ?').bind(now, r.plan_id),
    )
    await db.batch(statements)
    return
  }

  const privateJWK = JSON.parse(vapidPrivateKey) as JsonWebKey
  const deadEndpoints = new Set<string>()

  for (const reminder of due.results) {
    const plan = planMap.get(reminder.plan_id)
    if (!plan) continue
    const payload = buildNotificationPayload(plan)

    await Promise.all(
      subs.results.map(async (sub) => {
        try {
          const { endpoint, headers, body } = await buildPushHTTPRequest({
            privateJWK,
            subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            message: { payload, adminContact: ADMIN_CONTACT, options: { urgency: 'high', ttl: 3600 } },
          })
          const res = await fetch(endpoint, { method: 'POST', headers, body })
          if (res.status === 404 || res.status === 410) deadEndpoints.add(sub.endpoint)
        } catch {
          // 單一訂閱送失敗不影響其他訂閱；sent_at 已標記所以不重試——偶爾漏一則
          // 比重試風暴好。
        }
      }),
    )
  }

  const statements: D1PreparedStatement[] = due.results.map((r) =>
    db.prepare('UPDATE reminders SET sent_at = ? WHERE plan_id = ?').bind(now, r.plan_id),
  )
  for (const endpoint of deadEndpoints) {
    statements.push(db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint))
  }
  await db.batch(statements)
}

async function processTrip(db: D1Database, vapidPrivateKey: string) {
  const plansResult = await db
    .prepare(
      "SELECT id, day, t, lead, remind_at, title, sub FROM plans WHERE deleted = 0 AND notify = 1 AND (remind_at IS NOT NULL OR t != '—')",
    )
    .all<PlanRow>()
  const planMap = await resyncReminders(db, plansResult.results)
  await sendDueReminders(db, vapidPrivateKey, planMap)
}

async function runAllTrips(env: Env) {
  await Promise.all(
    TRIPS.map(async (trip) => {
      try {
        await processTrip(trip.db(env), env.VAPID_PRIVATE_KEY)
      } catch (err) {
        // 單一行程的 D1 出錯不擋掉其他行程這一輪的提醒。
        console.error(`[${trip.name}] run failed:`, err)
      }
    }),
  )
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runAllTrips(env))
  },

  // 外部 cron 服務的備援觸發點（見檔頭）。GET /trigger?key=<CRON_SECRET>，
  // key 不對一律 404，不透露這個路徑存在。
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/trigger' || url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('not found', { status: 404 })
    }
    ctx.waitUntil(runAllTrips(env))
    return new Response('ok')
  },
}
