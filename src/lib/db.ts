// IndexedDB 資料層（idb 套件），表對應 D1 schema。另有不對應 D1 的 meta store，
// 存 since（同步時間戳）、loggedIn 與天氣/定位快取。
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb'
import seed from '../data/seed.json'
import type { PlanItem, SpotMeta, PackItem, Expense, Cat, Setting, CustomSpot, Member, StoredHotel } from './types'

const DB_NAME = 'inuyama-trip'
// v2 加 `ops` store（同步 outbox，見 lib/sync.ts），並把 id 統一成字串——D1 的 id 是
//    TEXT，本地若用 number，pull 回來的列在 IndexedDB 眼中是不同 key，會重複而非覆蓋。
// v3 加 `spots`（使用者新增的景點；種子景點仍是 data/spots.ts 的靜態 SPOTS）。
// v4 加 `members`（身分改成可管理的動態清單）。
// v5 加設定頁用的 settings 列：destTitle/destSubtitle/tripStart/tripEnd。
// v6 加 `hotels`（設定頁「住宿地點」）。
// v7、v8 清掉舊版灌進 plans/pack_items/expenses 與 hotels 的示範列：程式碼由多趟行程
//    共用，示範列 id 跟真實 D1 不重疊，pull 只會疊加、永遠不會自然消失。
const DB_VERSION = 8

interface MetaEntry {
  key: string
  value: unknown
}

/** 同步 outbox 的一筆待送 op（README push payload 格式：{table,row}）。autoIncrement key。 */
export interface OutboxOp {
  opId?: number
  table: 'plans' | 'spots_meta' | 'pack_items' | 'expenses' | 'cats' | 'settings' | 'spots' | 'members' | 'hotels'
  row: Record<string, unknown>
  createdAt: number
}

interface InuyamaDB extends DBSchema {
  plans: { key: PlanItem['id']; value: PlanItem; indexes: { day: string } }
  spots_meta: { key: string; value: SpotMeta }
  pack_items: { key: PackItem['id']; value: PackItem }
  expenses: { key: Expense['id']; value: Expense }
  cats: { key: [Cat['kind'], Cat['name']]; value: Cat }
  settings: { key: string; value: Setting }
  spots: { key: CustomSpot['id']; value: CustomSpot }
  members: { key: Member['role']; value: Member }
  hotels: { key: StoredHotel['id']; value: StoredHotel }
  meta: { key: string; value: MetaEntry }
  ops: { key: number; value: OutboxOp }
}

let dbPromise: Promise<IDBPDatabase<InuyamaDB>> | null = null

// 種子列的固定 updated_at：使用者之後的變更（Date.now()）必定較新，
// 也讓 v7/v8 migration 能精準挑出「純種子、沒被動過」的列。
const SEED_TIMESTAMP = 1_756_000_000_000 // 固定常數，非真實時刻

// dayinfo 的 'M/D'（年份隱含 2026）轉成 ISO 'YYYY-MM-DD'，對齊 <input type="date"> 與 time.ts。
function mdToIso(md: string): string {
  const [m, d] = md.split('/')
  return `2026-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function getDB(): Promise<IDBPDatabase<InuyamaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InuyamaDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const planStore = db.createObjectStore('plans', { keyPath: 'id' })
          planStore.createIndex('day', 'day')

          db.createObjectStore('spots_meta', { keyPath: 'id' })
          db.createObjectStore('pack_items', { keyPath: 'id' })
          db.createObjectStore('expenses', { keyPath: 'id' })
          db.createObjectStore('cats', { keyPath: ['kind', 'name'] })
          db.createObjectStore('settings', { keyPath: 'k' })
          db.createObjectStore('meta', { keyPath: 'key' })

          // 必須沿用 upgrade 給的 tx：版本升級中已有 versionchange 交易在跑，
          // 另開 db.transaction(...) 會丟 InvalidStateError。
          seedInitialData(tx)
        }

        if (oldVersion < 2) {
          db.createObjectStore('ops', { keyPath: 'opId', autoIncrement: true })
        }

        if (oldVersion < 3) {
          db.createObjectStore('spots', { keyPath: 'id' })
        }

        if (oldVersion < 4) {
          db.createObjectStore('members', { keyPath: 'role' })
          // 不預塞範例身分：全新安裝的「你是誰？」是空的，由使用者自己新增。
        }

        if (oldVersion < 5) {
          const settings = tx.objectStore('settings')
          const firstDay = seed.dayinfo[0]?.d as string | undefined
          const lastDay = seed.dayinfo[seed.dayinfo.length - 1]?.d as string | undefined
          settings.put({ k: 'destTitle', v: '', updated_at: SEED_TIMESTAMP })
          settings.put({ k: 'destSubtitle', v: '', updated_at: SEED_TIMESTAMP })
          if (firstDay) settings.put({ k: 'tripStart', v: mdToIso(firstDay), updated_at: SEED_TIMESTAMP })
          if (lastDay) settings.put({ k: 'tripEnd', v: mdToIso(lastDay), updated_at: SEED_TIMESTAMP })
        }

        if (oldVersion < 6) {
          // 只建空 store、不灌示範飯店（理由見上方 v7、v8）。
          db.createObjectStore('hotels', { keyPath: 'id' })
        }

        if (oldVersion < 7) {
          // 只刪 updated_at 精確等於 SEED_TIMESTAMP 的列——真實操作的 Date.now()
          // 不可能撞上，據此安全挑出「純種子、沒被動過」的示範資料。
          for (const storeName of ['plans', 'pack_items', 'expenses'] as const) {
            const store = tx.objectStore(storeName)
            let cursor = await store.openCursor()
            while (cursor) {
              if (cursor.value.updated_at === SEED_TIMESTAMP) await cursor.delete()
              cursor = await cursor.continue()
            }
          }
        }

        if (oldVersion < 8) {
          // 同上，補清舊版灌進來的示範飯店。
          const store = tx.objectStore('hotels')
          let cursor = await store.openCursor()
          while (cursor) {
            if (cursor.value.updated_at === SEED_TIMESTAMP) await cursor.delete()
            cursor = await cursor.continue()
          }
        }
      },
    })
  }
  return dbPromise
}

/**
 * 首次建庫（version 0 → 1）時初始化 store。
 *
 * 只塞通用預設值（rate）與 meta 旗標，行程資料一律等第一次 D1 pull——新裝置短暫空白，
 * 遠比混進另一趟行程的示範資料安全。
 * spots_meta / cats 留空：前者只存使用者互動後才產生的個人化資料，讀不到即視為預設；
 * 後者只放使用者自建分類，種子的 CATICON/CATCOLOR 僅是顯示用對照表。
 */
function seedInitialData(tx: IDBPTransaction<InuyamaDB, StoreNames<InuyamaDB>[], 'versionchange'>) {
  const settings = tx.objectStore('settings')
  settings.put({ k: 'rate', v: '0.216', updated_at: SEED_TIMESTAMP })

  const meta = tx.objectStore('meta')
  meta.put({ key: 'since', value: 0 })
  meta.put({ key: 'loggedIn', value: false })
}

// --- 泛用讀取／寫入輔助函式，供 store.ts 做 write-through ---

export async function getAll<K extends 'plans' | 'spots_meta' | 'pack_items' | 'expenses' | 'cats' | 'settings' | 'spots' | 'members' | 'hotels'>(
  storeName: K,
): Promise<InuyamaDB[K]['value'][]> {
  const db = await getDB()
  return db.getAll(storeName)
}

export async function putRow<K extends 'plans' | 'spots_meta' | 'pack_items' | 'expenses' | 'cats' | 'settings' | 'spots' | 'members' | 'hotels'>(
  storeName: K,
  value: InuyamaDB[K]['value'],
): Promise<void> {
  const db = await getDB()
  await db.put(storeName, value)
}

export async function deleteRow<K extends 'plans' | 'spots_meta' | 'pack_items' | 'expenses' | 'cats' | 'settings' | 'spots' | 'members' | 'hotels'>(
  storeName: K,
  key: InuyamaDB[K]['key'],
): Promise<void> {
  const db = await getDB()
  await db.delete(storeName, key)
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDB()
  const entry = await db.get('meta', key)
  return entry?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put('meta', { key, value })
}

// --- 同步 outbox：store.ts 寫完 IndexedDB 後 enqueue {table,row}，由 lib/sync.ts 推送 /api/push ---

export async function enqueueOp(table: OutboxOp['table'], row: Record<string, unknown>): Promise<void> {
  const db = await getDB()
  await db.put('ops', { table, row, createdAt: Date.now() })
}

export async function getOutbox(): Promise<OutboxOp[]> {
  const db = await getDB()
  return db.getAll('ops')
}

export async function deleteOps(opIds: number[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('ops', 'readwrite')
  await Promise.all(opIds.map((id) => tx.store.delete(id)))
  await tx.done
}
