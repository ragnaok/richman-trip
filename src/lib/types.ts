// 共用型別，對應 D1 各表的欄位（含 id/updated_at/deleted 三個同步用欄位）。

export type Kind = 'f' | 'r' | 'c' | 's' | 'e' | 'h' | 'p' // 航班/電車/車/景點/餐食/住宿/購物

/** 行程項目。id 在種子資料裡是 number，之後使用者新增的用 genId()（string）。 */
export interface PlanItem {
  id: number | string
  day: string // '9/3'
  t: string // 'HH:MM' 或 '—'（未定）
  title: string
  sub: string
  k: Kind
  q: string // 導航關鍵字
  spot?: string // 對應景點 id
  cands?: string[] // 候選景點 id（未定項目用）
  drive?: string // 車程（自駕日）
  park?: string // 停車（自駕日）
  notify?: boolean
  lead?: number // 提前分鐘數，預設 30；remindAt 有值時忽略，改用 remindAt 當發送時間
  remindAt?: string // 'YYYY-MM-DDTHH:MM'（日本時間），指定提醒時間用；不設就沿用 day+t-lead 的相對提醒
  photo?: string
  updated_at: number
  deleted: 0 | 1
}

export interface WalkStep {
  min: string
  text: string
}

export interface FoodRec {
  name: string
  note: string
  address?: string // 有值時「點名稱」直接開 Google Maps 導這個地址，見 SpotInfo.tsx
}

/** 景點資料形狀。種子景點（src/data/spots.ts 的 SPOTS）是靜態內容，不進 IndexedDB；
 * 使用者透過「連結景點 → 新增景點」建立的則是 CustomSpot（下方），存 IndexedDB + D1
 * 的 spots 表，兩者合併後才是畫面上完整的景點清單。 */
export interface Spot {
  id: string
  name: string
  jp: string
  area: string
  teaser: string
  intro: string
  hours: string
  fee: string
  access: string
  walk: WalkStep[]
  food: FoodRec[]
  q: string
  real?: boolean
}

/** 使用者新增的景點（對應 D1 的 spots 表）。 */
export interface CustomSpot extends Spot {
  updated_at: number
  deleted: 0 | 1
}

/** 景點個人化資料（對應 D1 的 spots_meta 表），使用者互動後才會有資料。 */
export interface SpotMeta {
  id: string // = spot id
  visited: boolean
  note: string
  photo?: string
  updated_at: number
  deleted: 0 | 1
}

// 身分是使用者可管理的動態清單（見 Member），所以 Owner/Payer 是一般字串。
// '共同' 對行李持有人仍有特殊意義（篩選時永遠顯示），但不是型別層級的限制。
export type Owner = string

export interface PackItem {
  id: number | string
  cat: string
  name: string
  owner: Owner
  done: boolean
  updated_at: number
  deleted: 0 | 1
}

export type Currency = 'JPY' | 'TWD'
export type Payer = string
export type PayMethod = 'cash' | 'card'

/** 身分（D1 members 表）。role 是自然鍵，updated_at/deleted 同 cats 走墓碑刪除，
 * 好讓「改名／刪除」能跨裝置同步。 */
export interface Member {
  role: string
  updated_at: number
  deleted: 0 | 1
}

export interface Expense {
  id: number | string
  title: string
  cat: string
  cur: Currency
  amt: number
  payer: Payer
  method?: PayMethod // 沒有值視同 'cash'（舊資料相容，見 lib/money.ts payMethod()）
  daigou?: boolean // 代購：不計入「不含代購」的統計，明細一律照常顯示
  spent_on?: string // 日期 '9/3'
  updated_at: number
  deleted: 0 | 1
}

/** 使用者自建分類（D1 cats 表），kind 為 'money' 或 'pack'。
 * deleted 是墓碑旗標：刪除與改名（舊名字塞墓碑 + 新名字建新列）都靠它，內建預設分類
 * 本身不進這張表，也是靠墓碑列才能把「刪掉它」的意圖同步出去。 */
export interface Cat {
  kind: 'money' | 'pack'
  name: string
  updated_at: number
  deleted: 0 | 1
}

export interface Setting {
  k: string
  v: string
  updated_at: number
}

export interface DayInfo {
  d: string
  wd: string
  hotel: string
  w: { i: string; t: string; x: string; h: string }
}

/** 種子資料的靜態飯店對照（data/spots.ts 的 HOTELS，DAYINFO.hotel 是查詢 key）。
 * 「返回飯店」卡片優先看動態的 StoredHotel，沒命中才退回這份。 */
export interface Hotel {
  name: string
  q: string
}

/** 設定頁「住宿地點」可編輯的飯店（D1 hotels 表），同 members/cats 的墓碑刪除機制。
 * checkin/checkout 是 'YYYY-MM-DD'，ItineraryTab 用 checkin<=day<checkout 判斷當天
 * 住哪一間。lat/lon 供 functions/api/weather.ts 決定要查哪個地區的天氣，改設定即可
 * 換城市，不用改程式碼。 */
export interface StoredHotel {
  id: string
  name: string
  q: string
  checkin: string
  checkout: string
  lat?: number
  lon?: number
  updated_at: number
  deleted: 0 | 1
}
