// 天氣邏輯本體（useWeather.ts 只是薄薄一層 hook 包裝）：抓取／WMO 對照／提示句規則／
// IDB 快取／fallback 鏈都在這裡，完全不碰 React，可獨立測試。
//
// Fallback 鏈：即時 API → IDB 上次成功的回應 → DAYINFO 種子值 → 空狀態（—°、無提示句）。
// 任何一步失敗都往下一層，不讓 App 掛掉。
import { DAYINFO } from '../data/spots'
import { getMeta, setMeta } from './db'

export interface WeatherInfo {
  icon: string // Phosphor kebab-case 名字，見 lib/icons.ts
  temp: string
  desc: string
  hint: string
}

interface DayWeather {
  code: number
  hi: number
  lo: number
  pop: number
}

interface WeatherResponse {
  fetched_at: number
  days: Record<string, DayWeather>
}

const EMPTY: WeatherInfo = { icon: 'ph-cloud', temp: '—°', desc: '—', hint: '' }

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

// WMO weather_code → [Phosphor icon, 繁中描述]
const WMO_TABLE: Array<[number[], string, string]> = [
  [[0], 'ph-sun', '晴'],
  [[1], 'ph-sun', '晴時多雲'],
  [[2], 'ph-cloud-sun', '多雲'],
  [[3], 'ph-cloud', '陰'],
  [[45, 48], 'ph-cloud-fog', '霧'],
  [range(51, 57), 'ph-cloud-rain', '毛毛雨'],
  [range(61, 67), 'ph-cloud-rain', '有雨'],
  [[80, 81, 82], 'ph-cloud-rain', '陣雨'],
  [[...range(71, 77), 85, 86], 'ph-cloud-snow', '降雪'],
  [range(95, 99), 'ph-cloud-lightning', '雷雨'],
]

function wmoLookup(code: number): [string, string] | undefined {
  const row = WMO_TABLE.find(([codes]) => codes.includes(code))
  return row ? [row[1], row[2]] : undefined
}

/** 決定性提示句規則，先中先贏。 */
export function buildHint(code: number, hi: number, pop: number): string {
  if (code >= 95 && code <= 99) return '午後可能有雷雨，室內行程優先。'
  if (pop >= 60 || (code >= 61 && code <= 82)) return '降雨機率高，記得帶雨具。'
  if (hi >= 33) return '高溫炎熱，記得補水與防曬。'
  if (hi >= 30 && code <= 1) return '紫外線強，注意防曬。'
  return '天氣穩定，適合戶外行程。'
}

function fromDayWeather(dw: DayWeather): WeatherInfo | undefined {
  const looked = wmoLookup(dw.code)
  if (!looked) return undefined // code 對不上表：視為這個來源沒有可用資料，讓呼叫端往下一層 fallback
  const [icon, desc] = looked
  return { icon, temp: `${dw.hi}° / ${dw.lo}°`, desc, hint: buildHint(dw.code, dw.hi, dw.pop) }
}

function seedInfo(day: string): WeatherInfo {
  const info = DAYINFO.find((d) => d.d === day)
  if (!info) return EMPTY
  return { icon: info.w.i, temp: info.w.t, desc: info.w.x, hint: info.w.h }
}

// --- 模組層級狀態 + 簡易 pub/sub：多個 useWeather() 共用同一份抓取結果，
//     下拉更新也能直接呼叫 refreshWeather() 重抓。---
let liveDays: Record<string, DayWeather> | null = null // 這次連線期間，即時 API 成功回來的資料
let cachedResponse: WeatherResponse | null = null // 從 IDB 載入的「上次成功」快取
let idbLoaded = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribeWeather(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 目前已知的最佳資料（同步讀取，供 hook 初始值與重新渲染用）。 */
export function getWeatherSnapshot(day: string): WeatherInfo {
  const live = liveDays?.[day]
  if (live) {
    const info = fromDayWeather(live)
    if (info) return info
  }
  const cached = cachedResponse?.days?.[day]
  if (cached) {
    const info = fromDayWeather(cached)
    if (info) return info
  }
  return seedInfo(day)
}

async function loadCachedWeather(): Promise<void> {
  if (idbLoaded) return
  idbLoaded = true
  try {
    const stored = await getMeta<WeatherResponse>('weatherCache')
    if (stored) {
      cachedResponse = stored
      notify()
    }
  } catch {
    // IDB 不可用（例如私密瀏覽），維持種子 fallback。
  }
}

/** 觸發一次真的重抓（App 開啟 + 下拉更新呼叫）。任何失敗都吞掉，讓 snapshot 自動退到下一層 fallback。 */
export async function refreshWeather(): Promise<void> {
  await loadCachedWeather() // 先確保有上次成功快取墊底，即時 API 還沒回來前不會閃回種子值
  try {
    const res = await fetch('/api/weather', { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`weather fetch ${res.status}`)
    const data = (await res.json()) as WeatherResponse
    if (!data || typeof data.fetched_at !== 'number' || !data.days) throw new Error('unexpected shape')
    liveDays = data.days
    // 只在真的有資料時覆蓋 IDB 快取：超出 16 天預報窗時會回空 days，不該洗掉上次的快取。
    if (Object.keys(data.days).length > 0) {
      cachedResponse = data
      await setMeta('weatherCache', data).catch(() => {})
    }
  } catch {
    // 離線／fetch 失敗：liveDays 維持原值，snapshot 自動退到下一層。
  } finally {
    notify()
  }
}
