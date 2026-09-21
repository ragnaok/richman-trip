// 同步模組：
// - pull：GET /api/pull?since=<since> → LWW upsert 進 IndexedDB → 更新 since=server_now
// - push：把 outbox（ops store）打包成 POST /api/push，只清掉伺服器回報 written 的，
//   其餘留在佇列指數退避重試。
// - startSyncTriggers()：App 開啟、回前景、online、前景每 30 秒輪詢；本地變更的
//   debounce 推送則由 store.ts 的 enqueue() 呼叫 scheduleDebouncedPush()。
// 未登入時不打 API：401 的處理統一在 apiFetch。
import * as db from './db'
import { apiFetch, apiFetchJson } from './api'
import { useStore } from './store'
import type { PlanItem, PackItem, Expense, Cat, SpotMeta, Setting, CustomSpot, StoredHotel, PaymentMethod } from './types'
import type { OutboxOp } from './db'

const DEBOUNCE_MS = 2000
const POLL_MS = 30000

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let pushInFlight = false
let pushRetryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelayMs = 2000 // 指數退避起始值，push 成功或佇列清空後重置

function isLoggedIn(): boolean {
  return useStore.getState().ui.auth.status === 'loggedIn'
}

// pull 在 'pickingRole' 就允許跑：密碼通過後 session cookie 已有效，角色只是本地偏好。
// 全新裝置的 members store 是空的，身分清單正是 pull 拿回來的，等選完角色才 pull 會
// 卡在「選身分畫面沒有選項」。push 仍只在 loggedIn 才送（見 pushOnce()）。
function hasSession(): boolean {
  const status = useStore.getState().ui.auth.status
  return status === 'pickingRole' || status === 'loggedIn'
}

// --- pull ---

interface PullResponse {
  server_now: number
  plans: Array<Record<string, unknown>>
  spots_meta: Array<Record<string, unknown>>
  pack_items: Array<Record<string, unknown>>
  expenses: Array<Record<string, unknown>>
  cats: Array<Record<string, unknown>>
  settings: Array<Record<string, unknown>>
  spots: Array<Record<string, unknown>>
  members: Array<Record<string, unknown>>
  hotels: Array<Record<string, unknown>>
  payment_methods: Array<Record<string, unknown>>
}

function toBool(v: unknown): boolean {
  return v === 1 || v === true
}

// D1 row 跟客戶端型別的兩處差異：
// 1) plans.kind ↔ PlanItem.k
// 2) notify/done/visited 在 D1 是 INTEGER 0/1，客戶端是 boolean（deleted 兩邊都是 0|1）
function rowToPlan(r: Record<string, unknown>): PlanItem {
  return {
    id: String(r.id),
    day: String(r.day),
    t: String(r.t),
    title: String(r.title),
    sub: (r.sub as string) ?? '',
    k: r.kind as PlanItem['k'],
    q: (r.q as string) ?? '',
    spot: (r.spot as string) ?? undefined,
    cands: r.cands ? (JSON.parse(r.cands as string) as string[]) : undefined,
    drive: (r.drive as string) ?? undefined,
    park: (r.park as string) ?? undefined,
    notify: toBool(r.notify),
    lead: typeof r.lead === 'number' ? r.lead : Number(r.lead ?? 30),
    remindAt: (r.remind_at as string) ?? undefined,
    photo: (r.photo as string) ?? undefined,
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

function rowToSpotMeta(r: Record<string, unknown>): SpotMeta {
  return {
    id: String(r.id),
    visited: toBool(r.visited),
    note: (r.note as string) ?? '',
    photo: (r.photo as string) ?? undefined,
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

function rowToPackItem(r: Record<string, unknown>): PackItem {
  return {
    id: String(r.id),
    cat: String(r.cat),
    name: String(r.name),
    owner: r.owner as PackItem['owner'],
    done: toBool(r.done),
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

function rowToExpense(r: Record<string, unknown>): Expense {
  return {
    id: String(r.id),
    title: String(r.title),
    cat: String(r.cat),
    cur: r.cur as Expense['cur'],
    amt: Number(r.amt),
    payer: r.payer as Expense['payer'],
    method: (r.method as Expense['method']) ?? undefined,
    daigou: toBool(r.daigou),
    spent_on: (r.spent_on as string) ?? undefined,
    payers: r.payers ? (JSON.parse(r.payers as string) as Expense['payers']) : undefined,
    splitAmong: r.split_among ? (JSON.parse(r.split_among as string) as Expense['splitAmong']) : undefined,
    splitAmounts: r.split_amounts ? (JSON.parse(r.split_amounts as string) as Expense['splitAmounts']) : undefined,
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

function rowToCat(r: Record<string, unknown>): Cat {
  return {
    kind: r.kind as Cat['kind'],
    name: String(r.name),
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

function rowToSetting(r: Record<string, unknown>): Setting {
  return { k: String(r.k), v: String(r.v), updated_at: Number(r.updated_at) }
}

function rowToSpot(r: Record<string, unknown>): CustomSpot {
  return {
    id: String(r.id),
    name: String(r.name),
    jp: (r.jp as string) ?? '',
    area: (r.area as string) ?? '',
    teaser: (r.teaser as string) ?? '',
    intro: (r.intro as string) ?? '',
    hours: (r.hours as string) ?? '',
    fee: (r.fee as string) ?? '',
    access: (r.access as string) ?? '',
    walk: r.walk ? JSON.parse(r.walk as string) : [],
    food: r.food ? JSON.parse(r.food as string) : [],
    q: (r.q as string) ?? '',
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

function rowToMember(r: Record<string, unknown>): { role: string; updated_at: number; deleted: 0 | 1 } {
  return { role: String(r.role), updated_at: Number(r.updated_at), deleted: toBool(r.deleted) ? 1 : 0 }
}

function rowToPaymentMethod(r: Record<string, unknown>): PaymentMethod {
  return { name: String(r.name), updated_at: Number(r.updated_at), deleted: toBool(r.deleted) ? 1 : 0 }
}

function rowToHotel(r: Record<string, unknown>): StoredHotel {
  const lat = r.lat == null ? undefined : Number(r.lat)
  const lon = r.lon == null ? undefined : Number(r.lon)
  return {
    id: String(r.id),
    name: String(r.name),
    q: (r.q as string) ?? '',
    checkin: (r.checkin as string) ?? '',
    checkout: (r.checkout as string) ?? '',
    lat: lat != null && Number.isFinite(lat) ? lat : undefined,
    lon: lon != null && Number.isFinite(lon) ? lon : undefined,
    updated_at: Number(r.updated_at),
    deleted: toBool(r.deleted) ? 1 : 0,
  }
}

/**
 * LWW upsert 一筆進 IndexedDB：只有伺服器版本較新（或本地沒有這筆）才覆蓋。
 * 還在 outbox 排隊的本地變更不必特別處理——它的 updated_at 是修改當下的時間，
 * 比較舊的伺服器列本來就蓋不過去。
 *
 * purgeTombstone=true 時，贏過本機的伺服器列若是墓碑（deleted=1）就直接把本機這筆
 * 刪掉，不留著——反正已經確定同步過，本機沒必要繼續留著佔空間（尤其是帶照片的列）。
 * cats 表要傳 false：deletedNames 靠本機保留的墓碑列擋掉 DEFAULT_MONEY_CATS 內建分類
 * 重新冒出來（見 store.ts useCatNames），這張表的墓碑不能在本機被清掉。
 */
async function upsertIfNewer<T extends { id?: unknown; kind?: unknown; k?: unknown; updated_at: number; deleted?: 0 | 1 }>(
  storeName: 'plans' | 'spots_meta' | 'pack_items' | 'expenses' | 'cats' | 'settings' | 'spots' | 'members' | 'hotels' | 'payment_methods',
  row: T,
  getKey: (row: T) => unknown,
  purgeTombstone: boolean,
): Promise<void> {
  const dbInst = await db.getDB()
  const key = getKey(row) as never
  const existing = await dbInst.get(storeName, key)
  if (existing && (existing as { updated_at: number }).updated_at >= row.updated_at) return
  if (purgeTombstone && row.deleted === 1) {
    await dbInst.delete(storeName, key)
  } else {
    await dbInst.put(storeName, row as never)
  }
}

async function pullSince(since: number): Promise<void> {
  const data = await apiFetchJson<PullResponse>(`/api/pull?since=${since}`)

  for (const r of data.plans) await upsertIfNewer('plans', rowToPlan(r), (x) => x.id, true)
  for (const r of data.spots_meta) await upsertIfNewer('spots_meta', rowToSpotMeta(r), (x) => x.id, true)
  for (const r of data.pack_items) await upsertIfNewer('pack_items', rowToPackItem(r), (x) => x.id, true)
  for (const r of data.expenses) await upsertIfNewer('expenses', rowToExpense(r), (x) => x.id, true)
  for (const r of data.cats) await upsertIfNewer('cats', rowToCat(r), (x) => [x.kind, x.name], false)
  for (const r of data.settings) await upsertIfNewer('settings', rowToSetting(r), (x) => x.k, true)
  for (const r of data.spots) await upsertIfNewer('spots', rowToSpot(r), (x) => x.id, true)
  for (const r of data.members) await upsertIfNewer('members', rowToMember(r), (x) => x.role, true)
  for (const r of data.hotels) await upsertIfNewer('hotels', rowToHotel(r), (x) => x.id, true)
  for (const r of data.payment_methods) await upsertIfNewer('payment_methods', rowToPaymentMethod(r), (x) => x.name, true)

  await db.setMeta('since', data.server_now)
  await useStore.getState().hydrate()
}

export async function pull(): Promise<void> {
  if (!hasSession()) return
  const since = (await db.getMeta<number>('since')) ?? 0
  try {
    await pullSince(since)
  } catch {
    return // 離線或伺服器錯誤：靜默放棄這一輪，下次觸發再試
  }
}

const FORCE_SYNC_TABLES = ['plans', 'spots_meta', 'pack_items', 'expenses', 'cats', 'settings', 'spots', 'members', 'hotels', 'payment_methods'] as const

const TABLE_LABELS: Record<OutboxOp['table'], string> = {
  plans: '行程',
  spots_meta: '景點筆記',
  pack_items: '行李',
  expenses: '記帳',
  cats: '分類',
  settings: '設定',
  spots: '自訂景點',
  members: '身分',
  hotels: '住宿',
  payment_methods: '付款方式',
}

export interface PendingOutboxSummary {
  total: number
  byTable: Array<{ label: string; count: number }>
}

/** 按「強制同步資料」前要讓使用者知道會丟掉什麼：outbox 裡還沒送達伺服器的變更數，
 * 依表分組方便顯示。 */
export async function getPendingOutboxSummary(): Promise<PendingOutboxSummary> {
  const outbox = await db.getOutbox()
  const counts = new Map<OutboxOp['table'], number>()
  for (const op of outbox) counts.set(op.table, (counts.get(op.table) ?? 0) + 1)
  const byTable = [...counts.entries()].map(([table, count]) => ({ label: TABLE_LABELS[table], count }))
  return { total: outbox.length, byTable }
}

/**
 * 設定頁「強制同步資料」：完全以伺服器為準重建本機——跟 pull() 的 LWW merge 不同，
 * 這裡不比較 updated_at（本機時鐘不可信、卡住的本地變更本來就是要被捨棄的對象），
 * 清空 outbox 跟本機各表後，只放回伺服器目前有的、非墓碑的資料（墓碑本來就該被丟
 * 掉，見 upsertIfNewer 的 purgeTombstone 註解；cats 例外，理由同上）。
 * 呼叫前應該先用 getPendingOutboxSummary() 讓使用者確認要不要丟掉還沒上傳的變更。
 * 跟 pull() 不同，錯誤丟給呼叫端處理，讓按鈕能顯示同步失敗。
 */
export async function forceSync(): Promise<void> {
  if (!hasSession()) return
  const data = await apiFetchJson<PullResponse>('/api/pull?since=0')

  await db.clearOutbox()
  for (const table of FORCE_SYNC_TABLES) await db.clearStore(table)

  for (const r of data.plans) if (!toBool(r.deleted)) await db.putRow('plans', rowToPlan(r))
  for (const r of data.spots_meta) if (!toBool(r.deleted)) await db.putRow('spots_meta', rowToSpotMeta(r))
  for (const r of data.pack_items) if (!toBool(r.deleted)) await db.putRow('pack_items', rowToPackItem(r))
  for (const r of data.expenses) if (!toBool(r.deleted)) await db.putRow('expenses', rowToExpense(r))
  for (const r of data.cats) await db.putRow('cats', rowToCat(r))
  for (const r of data.settings) await db.putRow('settings', rowToSetting(r))
  for (const r of data.spots) if (!toBool(r.deleted)) await db.putRow('spots', rowToSpot(r))
  for (const r of data.members) if (!toBool(r.deleted)) await db.putRow('members', rowToMember(r))
  for (const r of data.hotels) if (!toBool(r.deleted)) await db.putRow('hotels', rowToHotel(r))
  for (const r of data.payment_methods) if (!toBool(r.deleted)) await db.putRow('payment_methods', rowToPaymentMethod(r))

  await db.setMeta('since', data.server_now)
  await useStore.getState().hydrate()
}

/**
 * 登入畫面要顯示的 destTitle/destSubtitle/tripStart/tripEnd/heroPhoto，改打免認證的
 * /api/public-settings（完整 pull() 需要 session，且會拉回整趟行程的資料）。
 * 沿用 upsertIfNewer 寫回，LWW 語意跟 pull() 一致。
 */
export async function pullPublicSettings(): Promise<void> {
  let data: { settings: Array<Record<string, unknown>> }
  try {
    data = await apiFetchJson<{ settings: Array<Record<string, unknown>> }>('/api/public-settings')
  } catch {
    return // 離線或伺服器錯誤：AuthGate 維持本機既有值，不擋畫面
  }
  for (const r of data.settings) await upsertIfNewer('settings', rowToSetting(r), (x) => x.k)
  await useStore.getState().hydrate()
}

// --- push ---

function payloadForOp(op: OutboxOp): Record<string, unknown> {
  // k→kind 與 boolean→0/1 的轉換由伺服器端做（functions/api/push.ts 的 bind()），
  // 這裡原樣送出客戶端型別即可。
  return op.row
}

/** 每張表的自然鍵，跟 pull() 那邊 upsertIfNewer 的 getKey 對應——settings/cats/
 * members/payment_methods 的主鍵不是 id，用 row.id 比對永遠是 undefined，會把
 * 同一張表所有 op 混成同一把 key（例如同時改標題、副標題會被當成同一筆），導致
 * outbox 清除時把還沒真的寫入成功的項目誤判成已送達而刪掉，那筆編輯就悄悄消失。 */
function naturalKey(table: OutboxOp['table'], row: Record<string, unknown>): string {
  switch (table) {
    case 'cats':
      return `${String(row.kind)}:${String(row.name)}`
    case 'settings':
      return String(row.k)
    case 'members':
      return String(row.role)
    case 'payment_methods':
      return String(row.name)
    default:
      return String(row.id)
  }
}

async function pushOnce(): Promise<'empty' | 'ok' | 'partial' | 'error'> {
  if (!isLoggedIn()) return 'empty'
  const outbox = await db.getOutbox()
  if (outbox.length === 0) return 'empty'

  const ops = outbox.map((op) => ({ table: op.table, row: payloadForOp(op) }))
  let written: Array<{ table: string; row: Record<string, unknown> }>
  try {
    const res = await apiFetch('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    })
    if (!res.ok) return 'error'
    const body = (await res.json()) as { written: Array<{ table: string; row: Record<string, unknown> }> }
    written = body.written
  } catch {
    return 'error'
  }

  // 用 table+自然鍵比對已確認送達的項目並清掉；未被接受的（LWW 輸掉或格式有誤）留在
  // 佇列下次重送——重送舊版本沒有副作用，伺服器會照樣忽略。
  const writtenKeys = new Set(
    written.map((w) => `${w.table}:${naturalKey(w.table as OutboxOp['table'], w.row)}`),
  )
  const toDelete = outbox
    .filter((op) => writtenKeys.has(`${op.table}:${naturalKey(op.table, op.row)}`))
    .map((op) => op.opId!)
    .filter((id) => id !== undefined)
  if (toDelete.length > 0) await db.deleteOps(toDelete)

  return toDelete.length === outbox.length ? 'ok' : 'partial'
}

/** 排空 outbox；失敗或部分成功時指數退避重試（上限 60 秒）。 */
export async function push(): Promise<void> {
  if (pushInFlight) return
  pushInFlight = true
  try {
    const result = await pushOnce()
    if (pushRetryTimer) {
      clearTimeout(pushRetryTimer)
      pushRetryTimer = null
    }
    if (result === 'ok' || result === 'empty') {
      retryDelayMs = 2000
    } else {
      // 'error' 或 'partial'：排隊重試，指數退避
      const delay = retryDelayMs
      retryDelayMs = Math.min(retryDelayMs * 2, 60000)
      pushRetryTimer = setTimeout(() => void push(), delay)
    }
  } finally {
    pushInFlight = false
  }
}

/** store.ts 的 enqueue() 在每次本地變更後呼叫：debounce 2 秒再 push。 */
export function scheduleDebouncedPush(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void push()
  }, DEBOUNCE_MS)
}

// --- 觸發時機：App 開啟、回前景、online、前景每 30 秒輪詢 ---

let triggersStarted = false

/** 登入成功（或 bootstrapAuth 判定已登入）後呼叫一次，掛上各種觸發監聽並立刻跑一輪 pull+push。 */
export function startSyncTriggers(): void {
  if (triggersStarted) return
  triggersStarted = true

  void pull().then(() => void push())

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void pull().then(() => void push())
      }
    })
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void pull().then(() => void push())
    })

    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void pull().then(() => void push())
      }
    }, POLL_MS)
  }
}

/** 登出時停掉輪詢計時器。visibilitychange/online 監聽器不移除——未登入時 pull/push
 *  本來就是 no-op，拆卸的複雜度換不回好處。 */
export function stopSyncTriggers(): void {
  triggersStarted = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
