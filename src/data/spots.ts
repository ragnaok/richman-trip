// 靜態內容資料（不進 IndexedDB）：景點介紹、行程類型對照、記帳分類圖示/顏色、飯店、
// 天氣種子。這些是內容而非使用者可變更並需要同步的資料，從 seed.json 讀出後做型別包裝。
import seed from './seed.json'
import type { Spot, DayInfo, Hotel, Kind, PlanItem } from '../lib/types'

export const NA: string = seed.NA
export const TODAY: string = seed.TODAY

export const HOTELS: Record<string, Hotel> = seed.hotels

export const DAYINFO: DayInfo[] = seed.dayinfo

export const SPOTS: Spot[] = seed.spots

// KIND: kind code → [icon class, color var, 中文標籤]
export const KIND: Record<Kind, [string, string, string]> = seed.kind as Record<
  Kind,
  [string, string, string]
>

export const CAT_ICON: Record<string, string> = seed.catIcon
export const CAT_COLOR: Record<string, string> = seed.catColor

// findSpot/findSpotForPlan 吃 allSpots 參數而不是直接讀 SPOTS：使用者新增的景點存在
// store 裡，呼叫端要自己合併 [...SPOTS, ...customSpots] 傳進來。
export function findSpot(allSpots: Spot[], id: string | undefined): Spot | undefined {
  if (!id) return undefined
  return allSpots.find((s) => s.id === id)
}

// 行程 ↔ 景點對應：行程可帶 spot（景點 id）明確指定，否則以標題／地點正規化
// （去空白與 ·）後雙向 includes 比對。
function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, '').replace(/·/g, '')
}

/** 行程資訊頁 / 編輯面板用：找出這筆行程對應到的景點（若有）。 */
export function findSpotForPlan(allSpots: Spot[], plan: Pick<PlanItem, 'spot' | 'title' | 'q'>): Spot | undefined {
  const explicit = findSpot(allSpots, plan.spot)
  if (explicit) return explicit

  const title = normalizeForMatch(plan.title)
  const q = normalizeForMatch(plan.q)
  if (!title && !q) return undefined

  return allSpots.find((s) => {
    const name = normalizeForMatch(s.name)
    const sq = normalizeForMatch(s.q)
    const titleMatch = title && name && (title.includes(name) || name.includes(title))
    const qMatch = q && sq && (q.includes(sq) || sq.includes(q))
    return Boolean(titleMatch || qMatch)
  })
}
