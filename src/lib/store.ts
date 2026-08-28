// Zustand 單一 store：entities（資料）+ ui（畫面狀態）兩半。
// entities 的 CRUD action 會 write-through 寫回 IndexedDB（db.ts）並 enqueue 同步 op。
import { useMemo } from 'react'
import { create } from 'zustand'
import * as db from './db'
import { DAYINFO, SPOTS, CAT_ICON } from '../data/spots'
import { sortPlans, defaultDay, dayRange as computeDayRange } from './time'
import type { PlanItem, PackItem, Expense, Cat, SpotMeta, Payer, CustomSpot, Spot, Member, StoredHotel } from './types'
import type { OutboxOp } from './db'

// 記帳分類的內建預設值不進 cats 表——使用者「刪除」其中一個時靠 deleted:1 的墓碑列
// 蓋掉（見 useCatNames）。行李分類沒有內建預設值，清單全來自既有項目 + cats 列。
const DEFAULT_MONEY_CATS = Object.keys(CAT_ICON)

// 沿用 App.tsx 既有的 TabId 值，避免兩套 tab id 並存。
export type Tab = 'itinerary' | 'spots' | 'pack' | 'money'

// 身分是動態清單（見 Member），篩選值不是聯集型別，'全部' 是唯一的特殊字串。
export type PackOwnerFilter = string

// 認證狀態。'checking' 是啟動時讀 IndexedDB 前的初始值（避免 AuthGate 閃一下），
// 由 bootstrapAuth()（lib/auth.ts）定案；'pickingRole' 是密碼通過但還沒選身分。
export type AuthStatus = 'checking' | 'loggedIn' | 'loggedOut' | 'pickingRole'
export interface AuthState {
  status: AuthStatus
  role: Payer | null
}

interface Entities {
  plans: PlanItem[]
  packItems: PackItem[]
  expenses: Expense[]
  cats: Cat[]
  settings: Record<string, string>
  spotsMeta: Record<string, SpotMeta>
  customSpots: CustomSpot[]
  members: Member[]
  hotels: StoredHotel[]
}

interface UiState {
  tab: Tab
  day: string
  detail: { day: string; id: PlanItem['id'] } | null
  edit: Record<string, unknown> | null
  spot: string | null
  packOwner: PackOwnerFilter
  offline: boolean
  addExpenseOpen: boolean
  editingExpenseId: Expense['id'] | null
  auth: AuthState
  // 行李項目編輯／分類管理面板：跟其他 bottom sheet 一樣要在 App.tsx 頂層渲染
  // （.app-shell 的直接 sibling）。分頁自己的容器是 position:relative + overflow-y:auto，
  // 巢狀的 position:absolute 疊層會跟著捲動跑掉、不貼齊畫面下緣。
  packEditItemId: PackItem['id'] | null
  catMgrKind: Cat['kind'] | null
  // 新增／編輯景點面板：同上，不能塞進 SpotsTab / SpotDetail 自己的可捲動容器。
  addingSpotOpen: boolean
  editingSpotId: string | null
  // 行程資訊頁照片放大：同上，全螢幕大圖要在 App.tsx 頂層渲染。
  photoLightbox: { src: string; alt: string } | null
  // 設定頁：右緣滑入的全螢幕頁面，共用左緣滑動關閉的手勢堆疊（useEdgeSwipeBack），
  // 開啟則是鏡像的 useEdgeSwipeOpen（右緣往左滑）。
  settingsOpen: boolean
}

interface Store {
  entities: Entities
  ui: UiState

  hydrate: () => Promise<void>

  // ui actions
  setTab: (tab: Tab) => void
  setDay: (day: string) => void
  openDetail: (day: string, id: PlanItem['id']) => void
  closeDetail: () => void
  setEdit: (draft: Record<string, unknown> | null) => void
  openSpot: (id: string) => void
  closeSpot: () => void
  setPackOwner: (owner: PackOwnerFilter) => void
  setOffline: (offline: boolean) => void
  openAddExpense: () => void
  closeAddExpense: () => void
  openEditExpense: (id: Expense['id']) => void
  setAuth: (auth: AuthState) => void
  openPackItemEdit: (id: PackItem['id']) => void
  closePackItemEdit: () => void
  openCatMgr: (kind: Cat['kind']) => void
  closeCatMgr: () => void
  openAddSpot: () => void
  closeAddSpot: () => void
  openSpotEditor: (id: string) => void
  closeSpotEditor: () => void
  openPhotoLightbox: (src: string, alt: string) => void
  closePhotoLightbox: () => void
  openSettings: () => void
  closeSettings: () => void

  // entities CRUD（write-through IndexedDB）
  upsertPlan: (plan: Omit<PlanItem, 'updated_at' | 'deleted'>) => void
  deletePlan: (id: PlanItem['id']) => void
  deletePlansForDay: (day: string) => void
  upsertPackItem: (item: Omit<PackItem, 'updated_at' | 'deleted'>) => void
  togglePackDone: (id: PackItem['id']) => void
  deletePackItem: (id: PackItem['id']) => void
  upsertExpense: (expense: Omit<Expense, 'updated_at' | 'deleted'>) => void
  deleteExpense: (id: Expense['id']) => void
  upsertCat: (cat: Omit<Cat, 'updated_at' | 'deleted'>) => void
  renameCat: (kind: Cat['kind'], from: string, to: string) => void
  deleteCat: (kind: Cat['kind'], name: string) => void
  upsertSpotMeta: (meta: Partial<SpotMeta> & { id: string }) => void
  upsertSpot: (spot: Omit<CustomSpot, 'updated_at' | 'deleted'>) => void
  deleteSpot: (id: string) => void
  setRate: (rate: string) => void
  setSetting: (key: string, value: string) => void
  addMember: (role: string) => void
  renameMember: (from: string, to: string) => void
  deleteMember: (role: string) => void
  upsertHotel: (hotel: Omit<StoredHotel, 'updated_at' | 'deleted'>) => void
  deleteHotel: (id: string) => void
}

function upsertById<T extends { id: unknown }>(list: T[], row: T): T[] {
  const idx = list.findIndex((x) => x.id === row.id)
  if (idx === -1) return [...list, row]
  const next = [...list]
  next[idx] = row
  return next
}

function upsertCatRow(list: Cat[], row: Cat): Cat[] {
  const idx = list.findIndex((c) => c.kind === row.kind && c.name === row.name)
  if (idx === -1) return [...list, row]
  const next = [...list]
  next[idx] = row
  return next
}

function upsertMemberRow(list: Member[], row: Member): Member[] {
  const idx = list.findIndex((m) => m.role === row.role)
  if (idx === -1) return [...list, row]
  const next = [...list]
  next[idx] = row
  return next
}

export const useStore = create<Store>((set, get) => ({
  entities: {
    plans: [],
    packItems: [],
    expenses: [],
    cats: [],
    settings: { rate: '0.216' },
    spotsMeta: {},
    customSpots: [],
    members: [],
    hotels: [],
  },
  ui: {
    tab: 'itinerary',
    day: defaultDay(DAYINFO.map((d) => d.d)),
    detail: null,
    edit: null,
    spot: null,
    packOwner: '全部',
    offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    addExpenseOpen: false,
    editingExpenseId: null,
    auth: { status: 'checking', role: null },
    packEditItemId: null,
    catMgrKind: null,
    addingSpotOpen: false,
    editingSpotId: null,
    photoLightbox: null,
    settingsOpen: false,
  },

  async hydrate() {
    const [plans, packItems, expenses, cats, settingsRows, spotsMetaRows, customSpots, members, hotels] =
      await Promise.all([
        db.getAll('plans'),
        db.getAll('pack_items'),
        db.getAll('expenses'),
        db.getAll('cats'),
        db.getAll('settings'),
        db.getAll('spots_meta'),
        db.getAll('spots'),
        db.getAll('members'),
        db.getAll('hotels'),
      ])

    const settings: Record<string, string> = { rate: '0.216' }
    for (const row of settingsRows) settings[row.k] = row.v

    const spotsMeta: Record<string, SpotMeta> = {}
    for (const row of spotsMetaRows) spotsMeta[row.id] = row

    // ui.day 的初始值是模組載入時用種子 DAYINFO 算的，可能落在這趟行程的
    // tripStart/tripEnd 之外。讀到真正的範圍後只在超出範圍時修正，範圍內不動，
    // 免得使用者手動切到某一天瀏覽時被背景同步拉回預設日。
    const range =
      settings.tripStart && settings.tripEnd ? computeDayRange(settings.tripStart, settings.tripEnd) : []
    const days = range.length > 0 ? range.map((d) => d.d) : DAYINFO.map((d) => d.d)

    set((state) => ({
      entities: {
        ...state.entities,
        plans,
        packItems,
        expenses,
        cats,
        settings,
        spotsMeta,
        customSpots,
        members,
        hotels,
      },
      ui: days.includes(state.ui.day) ? state.ui : { ...state.ui, day: defaultDay(days) },
    }))
  },

  setTab: (tab) => set((state) => ({ ui: { ...state.ui, tab } })),
  setDay: (day) => set((state) => ({ ui: { ...state.ui, day } })),
  openDetail: (day, id) => set((state) => ({ ui: { ...state.ui, detail: { day, id } } })),
  closeDetail: () => set((state) => ({ ui: { ...state.ui, detail: null } })),
  setEdit: (draft) => set((state) => ({ ui: { ...state.ui, edit: draft } })),
  openSpot: (id) => set((state) => ({ ui: { ...state.ui, spot: id } })),
  closeSpot: () => set((state) => ({ ui: { ...state.ui, spot: null } })),
  setPackOwner: (owner) => set((state) => ({ ui: { ...state.ui, packOwner: owner } })),
  setOffline: (offline) => set((state) => ({ ui: { ...state.ui, offline } })),
  openAddExpense: () => set((state) => ({ ui: { ...state.ui, addExpenseOpen: true, editingExpenseId: null } })),
  closeAddExpense: () => set((state) => ({ ui: { ...state.ui, addExpenseOpen: false, editingExpenseId: null } })),
  openEditExpense: (id) => set((state) => ({ ui: { ...state.ui, addExpenseOpen: false, editingExpenseId: id } })),
  setAuth: (auth) => set((state) => ({ ui: { ...state.ui, auth } })),
  openPackItemEdit: (id) => set((state) => ({ ui: { ...state.ui, packEditItemId: id } })),
  closePackItemEdit: () => set((state) => ({ ui: { ...state.ui, packEditItemId: null } })),
  openCatMgr: (kind) => set((state) => ({ ui: { ...state.ui, catMgrKind: kind } })),
  closeCatMgr: () => set((state) => ({ ui: { ...state.ui, catMgrKind: null } })),
  openAddSpot: () => set((state) => ({ ui: { ...state.ui, addingSpotOpen: true, editingSpotId: null } })),
  closeAddSpot: () => set((state) => ({ ui: { ...state.ui, addingSpotOpen: false } })),
  openSpotEditor: (id) => set((state) => ({ ui: { ...state.ui, editingSpotId: id, addingSpotOpen: false } })),
  closeSpotEditor: () => set((state) => ({ ui: { ...state.ui, editingSpotId: null } })),
  openPhotoLightbox: (src, alt) => set((state) => ({ ui: { ...state.ui, photoLightbox: { src, alt } } })),
  closePhotoLightbox: () => set((state) => ({ ui: { ...state.ui, photoLightbox: null } })),
  openSettings: () => set((state) => ({ ui: { ...state.ui, settingsOpen: true } })),
  closeSettings: () => set((state) => ({ ui: { ...state.ui, settingsOpen: false } })),

  upsertPlan: (plan) => {
    const row: PlanItem = { ...plan, updated_at: Date.now(), deleted: 0 }
    set((state) => {
      const merged = upsertById(state.entities.plans, row)
      // 存檔後依時間升冪排序；只重排同一天的子集合，排序鍵只在同一天內有意義。
      const sameDay = sortPlans(merged.filter((p) => p.day === row.day))
      const otherDays = merged.filter((p) => p.day !== row.day)
      return { entities: { ...state.entities, plans: [...otherDays, ...sameDay] } }
    })
    void db.putRow('plans', row)
    void enqueue('plans', row)
  },

  deletePlan: (id) => {
    const existing = get().entities.plans.find((p) => p.id === id)
    if (!existing) return
    // 墓碑刪除：不真刪，否則對方拉不到刪除事件
    const row: PlanItem = { ...existing, deleted: 1, updated_at: Date.now() }
    set((state) => ({ entities: { ...state.entities, plans: upsertById(state.entities.plans, row) } }))
    void db.putRow('plans', row)
    void enqueue('plans', row)
  },

  // 設定頁縮小日期範圍並確認移除某天後，逐筆墓碑刪除該天行程，同步給對方裝置。
  deletePlansForDay: (day) => {
    for (const p of get().entities.plans) {
      if (p.deleted !== 1 && p.day === day) get().deletePlan(p.id)
    }
  },

  upsertPackItem: (item) => {
    const row: PackItem = { ...item, updated_at: Date.now(), deleted: 0 }
    set((state) => ({
      entities: { ...state.entities, packItems: upsertById(state.entities.packItems, row) },
    }))
    void db.putRow('pack_items', row)
    void enqueue('pack_items', row)
  },

  togglePackDone: (id) => {
    const existing = get().entities.packItems.find((p) => p.id === id)
    if (!existing) return
    const row: PackItem = { ...existing, done: !existing.done, updated_at: Date.now() }
    set((state) => ({
      entities: { ...state.entities, packItems: upsertById(state.entities.packItems, row) },
    }))
    void db.putRow('pack_items', row)
    void enqueue('pack_items', row)
  },

  deletePackItem: (id) => {
    const existing = get().entities.packItems.find((p) => p.id === id)
    if (!existing) return
    const row: PackItem = { ...existing, deleted: 1, updated_at: Date.now() }
    set((state) => ({
      entities: { ...state.entities, packItems: upsertById(state.entities.packItems, row) },
    }))
    void db.putRow('pack_items', row)
    void enqueue('pack_items', row)
  },

  upsertExpense: (expense) => {
    const row: Expense = { ...expense, updated_at: Date.now(), deleted: 0 }
    set((state) => ({ entities: { ...state.entities, expenses: upsertById(state.entities.expenses, row) } }))
    void db.putRow('expenses', row)
    void enqueue('expenses', row)
  },

  deleteExpense: (id) => {
    const existing = get().entities.expenses.find((e) => e.id === id)
    if (!existing) return
    const row: Expense = { ...existing, deleted: 1, updated_at: Date.now() }
    set((state) => ({ entities: { ...state.entities, expenses: upsertById(state.entities.expenses, row) } }))
    void db.putRow('expenses', row)
    void enqueue('expenses', row)
  },

  upsertCat: (cat) => {
    const row: Cat = { ...cat, updated_at: Date.now(), deleted: 0 }
    set((state) => ({ entities: { ...state.entities, cats: upsertCatRow(state.entities.cats, row) } }))
    void db.putRow('cats', row)
    void enqueue('cats', row)
  },

  // cats 的 primary key 是 (kind,name)，所以改名 = 舊名字寫墓碑 + 新名字建新列，
  // 既有項目的 cat 欄位逐筆走各自的 upsert 更新，才會一起進 outbox。
  renameCat: (kind, from, to) => {
    const name = to.trim()
    if (!name || name === from) return
    const state = get()
    if (kind === 'pack') {
      for (const item of state.entities.packItems) {
        if (item.deleted !== 1 && item.cat === from) get().upsertPackItem({ ...item, cat: name })
      }
    } else {
      for (const exp of state.entities.expenses) {
        if (exp.deleted !== 1 && exp.cat === from) get().upsertExpense({ ...exp, cat: name })
      }
    }
    get().upsertCat({ kind, name })
    const tombstone: Cat = { kind, name: from, deleted: 1, updated_at: Date.now() }
    set((s) => ({ entities: { ...s.entities, cats: upsertCatRow(s.entities.cats, tombstone) } }))
    void db.putRow('cats', tombstone)
    void enqueue('cats', tombstone)
  },

  // 刪除分類：連同其中的項目一起墓碑刪除，並寫一筆墓碑蓋掉分類名稱。
  deleteCat: (kind, name) => {
    const state = get()
    if (kind === 'pack') {
      for (const item of state.entities.packItems) {
        if (item.deleted !== 1 && item.cat === name) get().deletePackItem(item.id)
      }
    } else {
      for (const exp of state.entities.expenses) {
        if (exp.deleted !== 1 && exp.cat === name) get().deleteExpense(exp.id)
      }
    }
    const tombstone: Cat = { kind, name, deleted: 1, updated_at: Date.now() }
    set((s) => ({ entities: { ...s.entities, cats: upsertCatRow(s.entities.cats, tombstone) } }))
    void db.putRow('cats', tombstone)
    void enqueue('cats', tombstone)
  },

  upsertSpotMeta: (meta) => {
    const existing = get().entities.spotsMeta[meta.id]
    const row: SpotMeta = {
      id: meta.id,
      visited: meta.visited ?? existing?.visited ?? false,
      note: meta.note ?? existing?.note ?? '',
      photo: meta.photo ?? existing?.photo,
      updated_at: Date.now(),
      deleted: 0,
    }
    set((state) => ({
      entities: { ...state.entities, spotsMeta: { ...state.entities.spotsMeta, [row.id]: row } },
    }))
    void db.putRow('spots_meta', row)
    void enqueue('spots_meta', row)
  },

  upsertSpot: (spot) => {
    const row: CustomSpot = { ...spot, updated_at: Date.now(), deleted: 0 }
    set((state) => ({
      entities: { ...state.entities, customSpots: upsertById(state.entities.customSpots, row) },
    }))
    void db.putRow('spots', row)
    void enqueue('spots', row)
  },

  deleteSpot: (id) => {
    const existing = get().entities.customSpots.find((s) => s.id === id)
    if (!existing) return
    const row: CustomSpot = { ...existing, deleted: 1, updated_at: Date.now() }
    set((state) => ({
      entities: { ...state.entities, customSpots: upsertById(state.entities.customSpots, row) },
    }))
    void db.putRow('spots', row)
    void enqueue('spots', row)
  },

  setRate: (rate) => {
    set((state) => ({ entities: { ...state.entities, settings: { ...state.entities.settings, rate } } }))
    const row = { k: 'rate', v: rate, updated_at: Date.now() }
    void db.putRow('settings', row)
    void enqueue('settings', row)
  },

  // 設定頁其他可編輯欄位共用同一張 settings k/v 表，只是 key 不寫死。
  setSetting: (key, value) => {
    set((state) => ({ entities: { ...state.entities, settings: { ...state.entities.settings, [key]: value } } }))
    const row = { k: key, v: value, updated_at: Date.now() }
    void db.putRow('settings', row)
    void enqueue('settings', row)
  },

  addMember: (role) => {
    const name = role.trim()
    if (!name || get().entities.members.some((m) => m.deleted !== 1 && m.role === name)) return
    const row: Member = { role: name, updated_at: Date.now(), deleted: 0 }
    set((state) => ({ entities: { ...state.entities, members: upsertMemberRow(state.entities.members, row) } }))
    void db.putRow('members', row)
    void enqueue('members', row)
  },

  // members 的 primary key 是 role，所以改名同 renameCat：舊名字寫墓碑 + 建新列，
  // 並更新既有資料的 owner/payer、目前登入身分與行李篩選器。
  renameMember: (from, to) => {
    const name = to.trim()
    if (!name || name === from) return
    const state = get()
    for (const item of state.entities.packItems) {
      if (item.deleted !== 1 && item.owner === from) get().upsertPackItem({ ...item, owner: name })
    }
    for (const exp of state.entities.expenses) {
      if (exp.deleted !== 1 && exp.payer === from) get().upsertExpense({ ...exp, payer: name })
    }
    get().addMember(name)
    const tombstone: Member = { role: from, deleted: 1, updated_at: Date.now() }
    set((s) => ({
      entities: { ...s.entities, members: upsertMemberRow(s.entities.members, tombstone) },
      ui: {
        ...s.ui,
        auth: s.ui.auth.role === from ? { ...s.ui.auth, role: name } : s.ui.auth,
        packOwner: s.ui.packOwner === from ? name : s.ui.packOwner,
      },
    }))
    void db.putRow('members', tombstone)
    void enqueue('members', tombstone)
    if (get().ui.auth.role === name) void db.setMeta('role', name)
  },

  // 刪除身分：連同名下的記帳/行李一起墓碑刪除，並寫墓碑蓋掉 role。二次確認由 UI 負責。
  deleteMember: (role) => {
    const state = get()
    for (const item of state.entities.packItems) {
      if (item.deleted !== 1 && item.owner === role) get().deletePackItem(item.id)
    }
    for (const exp of state.entities.expenses) {
      if (exp.deleted !== 1 && exp.payer === role) get().deleteExpense(exp.id)
    }
    const remaining = get().entities.members.filter((m) => m.deleted !== 1 && m.role !== role)
    const tombstone: Member = { role, deleted: 1, updated_at: Date.now() }
    set((s) => ({
      entities: { ...s.entities, members: upsertMemberRow(s.entities.members, tombstone) },
      ui: {
        ...s.ui,
        packOwner: s.ui.packOwner === role ? '全部' : s.ui.packOwner,
      },
    }))
    void db.putRow('members', tombstone)
    void enqueue('members', tombstone)
    // 刪到目前登入的身分時沒有安全的替代人選，直接回選身分畫面重選。
    if (get().ui.auth.role === role) {
      void db.setMeta('role', remaining[0]?.role ?? null)
      set((s) => ({ ui: { ...s.ui, auth: { status: 'pickingRole', role: null } } }))
    }
  },

  upsertHotel: (hotel) => {
    const row: StoredHotel = { ...hotel, updated_at: Date.now(), deleted: 0 }
    set((state) => ({ entities: { ...state.entities, hotels: upsertById(state.entities.hotels, row) } }))
    void db.putRow('hotels', row)
    void enqueue('hotels', row)
  },

  deleteHotel: (id) => {
    const existing = get().entities.hotels.find((h) => h.id === id)
    if (!existing) return
    const row: StoredHotel = { ...existing, deleted: 1, updated_at: Date.now() }
    set((state) => ({ entities: { ...state.entities, hotels: upsertById(state.entities.hotels, row) } }))
    void db.putRow('hotels', row)
    void enqueue('hotels', row)
  },
}))

// write-through 之後把變更 enqueue 進同步 outbox，並統一在這裡觸發 debounce 推送，
// CRUD action 不必知道 sync 模組。動態 import 是為了避開 store.ts ↔ sync.ts 循環相依。
async function enqueue<T extends object>(table: OutboxOp['table'], row: T): Promise<void> {
  await db.enqueueOp(table, row as Record<string, unknown>)
  const { scheduleDebouncedPush } = await import('./sync')
  scheduleDebouncedPush()
}

/** 種子景點（靜態 SPOTS）＋使用者新增的 customSpots 合併後的完整清單，列出/搜尋景點
 * 都用這份。編輯種子景點時存的是同 id 的 customSpots 覆蓋列（靜態內容本身改不了），
 * 所以按 id 合併：被覆蓋的種子景點維持原排序位置，全新景點才附加在最後。 */
export function useAllSpots(): Spot[] {
  const customSpots = useStore((s) => s.entities.customSpots)
  return useMemo(() => {
    const overrides = new Map(customSpots.filter((s) => s.deleted !== 1).map((s) => [s.id, s]))
    const merged = SPOTS.map((seed) => overrides.get(seed.id) ?? seed)
    const brandNew = customSpots.filter((s) => s.deleted !== 1 && !SPOTS.some((seed) => seed.id === s.id))
    return [...merged, ...brandNew]
  }, [customSpots])
}

/** 分類清單（行李／記帳共用）：內建預設值（記帳限定）＋既有項目用過的＋cats 新建的，
 * 扣掉 deleted=1 的墓碑名稱。維持第一次出現的順序並去重。 */
export function useCatNames(kind: Cat['kind']): string[] {
  const cats = useStore((s) => s.entities.cats)
  const packItems = useStore((s) => s.entities.packItems)
  const expenses = useStore((s) => s.entities.expenses)
  return useMemo(() => {
    const deletedNames = new Set(cats.filter((c) => c.kind === kind && c.deleted === 1).map((c) => c.name))
    const addedNames = cats.filter((c) => c.kind === kind && c.deleted !== 1).map((c) => c.name)
    const itemNames =
      kind === 'pack'
        ? packItems.filter((i) => i.deleted !== 1).map((i) => i.cat)
        : expenses.filter((e) => e.deleted !== 1).map((e) => e.cat)
    const defaults = kind === 'money' ? DEFAULT_MONEY_CATS : []
    const seen = new Set<string>()
    const list: string[] = []
    for (const name of [...defaults, ...itemNames, ...addedNames]) {
      if (deletedNames.has(name) || seen.has(name)) continue
      seen.add(name)
      list.push(name)
    }
    return list
  }, [cats, packItems, expenses, kind])
}

/** 目前有效的身分清單（濾掉墓碑），依新增順序排列。選身分頁、「誰付的」「持有人」
 * 選項與設定頁「管理身分」都吃這份。 */
export function useMemberNames(): string[] {
  const members = useStore((s) => s.entities.members)
  return useMemo(() => members.filter((m) => m.deleted !== 1).map((m) => m.role), [members])
}

/** 旅遊日期範圍，由設定頁 tripStart/tripEnd 展開；未設定或不合法時退回種子 DAYINFO。 */
export function useTripDayRange(): Array<{ d: string; wd: string }> {
  const tripStart = useStore((s) => s.entities.settings.tripStart)
  const tripEnd = useStore((s) => s.entities.settings.tripEnd)
  return useMemo(() => {
    if (!tripStart || !tripEnd) return DAYINFO
    const range = computeDayRange(tripStart, tripEnd)
    return range.length > 0 ? range : DAYINFO
  }, [tripStart, tripEnd])
}

/** 「住宿地點」清單（濾掉墓碑），依入住日期排序。ItineraryTab「返回飯店」卡片用
 * checkin<=day<checkout 從這份找出某一天住哪一間。 */
export function useHotels(): StoredHotel[] {
  const hotels = useStore((s) => s.entities.hotels)
  return useMemo(
    () => hotels.filter((h) => h.deleted !== 1).slice().sort((a, b) => a.checkin.localeCompare(b.checkin)),
    [hotels],
  )
}

// 建立時自動 hydrate（把 IndexedDB 裡的資料灌進 entities）。
void useStore.getState().hydrate()

// StatusBar 自己監聽 navigator.onLine；離線提示條與 sync 觸發吃的是 ui.offline，
// 所以這裡也掛一份監聽讓它保持同步。
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useStore.getState().setOffline(false))
  window.addEventListener('offline', () => useStore.getState().setOffline(true))
}
