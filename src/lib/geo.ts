// 定位刊頭邏輯本體。不碰 React，供 lib/useMasthead.ts 訂閱，也讓下拉更新可以直接
// 呼叫 refreshMasthead()。
//
// Fallback 鏈：即時定位 → IDB 上次成功的 label → 當日 DAYINFO 對應區域 → 靜態種子值。
// 不阻塞渲染：先回 fallback，定位/reverse geocode 完成後才換字。
import { DAYINFO, TODAY } from '../data/spots'
import { getMeta, setMeta } from './db'

const STATIC_FALLBACK = ''

// hotel → 區域顯示名，沿用 ItineraryTab「依 hotel 分區域」的判斷方式。
const HOTEL_AREA: Record<string, string> = {
  hotel1: '',
}

function seedLabel(): string {
  const info = DAYINFO.find((d) => d.d === TODAY)
  if (!info) return STATIC_FALLBACK
  return HOTEL_AREA[info.hotel] ?? STATIC_FALLBACK
}

// --- 模組層級狀態 + 簡易 pub/sub（跟 lib/weather.ts 同一個模式）---
let liveLabel: string | null = null // 這次連線期間，定位成功換來的字
let cachedLabel: string | null = null // 從 IDB 載入的「上次成功」快取
let idbLoaded = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribeMasthead(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getMastheadSnapshot(): string {
  return liveLabel ?? cachedLabel ?? seedLabel()
}

async function loadCachedLabel(): Promise<void> {
  if (idbLoaded) return
  idbLoaded = true
  try {
    const stored = await getMeta<string>('mastheadLabel')
    if (stored) {
      cachedLabel = stored
      notify()
    }
  } catch {
    // IDB 不可用，忽略，維持種子 fallback。
  }
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      maximumAge: 600_000,
      timeout: 8_000,
      enableHighAccuracy: false,
    })
  })
}

// BigDataCloud 的中文行政區名會帶「市/縣/區/鎮/鄉」尾字，種子/英文格式不含，
// 顯示時去掉最後一個常見尾字對齊。
function stripAdminSuffix(name: string): string {
  return name.replace(/[市縣區鎮鄉]$/, '')
}

interface ReverseGeocodeResp {
  city?: string
  locality?: string
}

/**
 * BigDataCloud reverse-geocode-client。免金鑰、支援 CORS，客戶端直接呼叫。
 * 中英文分兩次平行呼叫：zh-Hant 回應的 city 層級沒有羅馬拼音欄位（isoName 只到縣級），
 * 沒辦法一次拿到兩種語言。
 */
async function reverseGeocode(lat: number, lon: number, lang: string): Promise<string | undefined> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`reverse geocode ${res.status}`)
  const data = (await res.json()) as ReverseGeocodeResp
  return data.city || data.locality || undefined
}

/** 觸發一次真的重抓（App 開啟 + 下拉更新呼叫）。任何失敗都吞掉，讓 snapshot 自動退到下一層 fallback。 */
export async function refreshMasthead(): Promise<void> {
  await loadCachedLabel() // 先確保有上次成功快取墊底
  try {
    const pos = await getPosition()
    const { latitude, longitude } = pos.coords
    const [zh, en] = await Promise.all([
      reverseGeocode(latitude, longitude, 'zh-Hant'),
      reverseGeocode(latitude, longitude, 'en'),
    ])
    const zhName = zh ? stripAdminSuffix(zh) : ''
    const enName = en ? en.toUpperCase() : ''
    const label = [zhName, enName].filter(Boolean).join(' ')
    if (!label) throw new Error('empty reverse geocode result')
    liveLabel = label
    cachedLabel = label
    await setMeta('mastheadLabel', label).catch(() => {})
  } catch {
    // 權限拒絕／離線／逾時／API 失敗：liveLabel 維持 null，snapshot 自動退到下一層。
  } finally {
    notify()
  }
}
