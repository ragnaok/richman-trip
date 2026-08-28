// /api/weather — 代理 Open-Meteo 的 Pages Function，免認證（SW 用 NetworkFirst 24h）。
//
// 地區與日期不寫死：讀 D1 hotels（設定頁「住宿地點」的緯經度）與 settings 的
// tripStart/tripEnd，每間有座標的飯店各打一次 forecast，再依自己的入住/退房日期
// 把每日資料對映回 'M/D' day key（同 StoredHotel 的 checkin<=day<checkout 規則）。
// 沒有任何飯店填座標時回空 days，讓前端自己 fallback。
//
// caches.default 快取 30 分鐘，cache key 帶飯店設定簽章。單一飯店請求失敗（含超出
// 16 天預報窗）只是少那幾天，不讓整個 request 失敗。
import type { Env } from './_lib/env'

interface HotelRow {
  id: string
  checkin: string
  checkout: string
  lat: number | null
  lon: number | null
}

interface DayWeather {
  code: number
  hi: number
  lo: number
  pop: number
}

interface OpenMeteoDaily {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_probability_max: number[]
}

interface OpenMeteoResponse {
  daily?: OpenMeteoDaily
  error?: boolean
  reason?: string
}

// 把查詢窗口收斂到「行程區間 ∩ 入住區間」，避免打超出這間飯店入住期間的多餘請求。
function overlapRange(hotel: HotelRow, start: string, end: string): { start: string; end: string } | null {
  const s = hotel.checkin > start ? hotel.checkin : start
  // checkout 是退房日（exclusive），Open-Meteo 的 end_date 是 inclusive，所以要減一天。
  const checkoutMinusOne = hotel.checkout ? addDays(hotel.checkout, -1) : end
  const e = checkoutMinusOne < end ? checkoutMinusOne : end
  if (!s || !e || s > e) return null
  return { start: s, end: e }
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** 一間飯店（入住期間）的每日資料，keyed by 'M/D'。失敗（含超出預報窗）回傳 null。 */
async function fetchHotelWeather(hotel: HotelRow, start: string, end: string): Promise<Record<string, DayWeather> | null> {
  if (hotel.lat == null || hotel.lon == null) return null
  const range = overlapRange(hotel, start, end)
  if (!range) return null

  const params = new URLSearchParams({
    latitude: String(hotel.lat),
    longitude: String(hotel.lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Asia/Tokyo',
    start_date: range.start,
    end_date: range.end,
  })
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as OpenMeteoResponse
    if (data.error || !data.daily) return null

    const { time, weather_code, temperature_2m_max, temperature_2m_min, precipitation_probability_max } = data.daily
    const out: Record<string, DayWeather> = {}
    time.forEach((iso, i) => {
      const [, m, d] = iso.split('-')
      const key = `${Number(m)}/${Number(d)}`
      out[key] = {
        code: weather_code[i],
        hi: Math.round(temperature_2m_max[i]),
        lo: Math.round(temperature_2m_min[i]),
        pop: precipitation_probability_max[i] ?? 0,
      }
    })
    return out
  } catch {
    return null
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)

  const [hotelsResult, settingsResult] = await Promise.all([
    context.env.DB.prepare('SELECT id, checkin, checkout, lat, lon FROM hotels WHERE deleted = 0').all<HotelRow>(),
    context.env.DB.prepare("SELECT k, v FROM settings WHERE k IN ('tripStart','tripEnd')").all<{ k: string; v: string }>(),
  ])
  const settingsMap = new Map(settingsResult.results.map((r) => [r.k, r.v]))
  const start = url.searchParams.get('start') || settingsMap.get('tripStart') || ''
  const end = url.searchParams.get('end') || settingsMap.get('tripEnd') || ''
  const hotels = hotelsResult.results.filter((h) => h.lat != null && h.lon != null)

  if (!start || !end || hotels.length === 0) {
    // 沒設日期或沒有飯店座標：回空 days，讓前端走 fallback 鏈，不要整個 request 失敗。
    return new Response(JSON.stringify({ fetched_at: Date.now(), days: {} }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
    })
  }

  // cache key 帶飯店設定簽章（id/座標/日期），設定一改就命中新 key，不用等舊快取過期。
  const signature = hotels
    .map((h) => `${h.id}:${h.lat}:${h.lon}:${h.checkin}:${h.checkout}`)
    .sort()
    .join('|')
  const cache = caches.default
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?start=${start}&end=${end}&sig=${encodeURIComponent(signature)}`,
    { method: 'GET' },
  )
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const hotelResults: Array<Record<string, DayWeather> | null> = await Promise.all(
    hotels.map((h) => fetchHotelWeather(h, start, end)),
  )

  const days: Record<string, DayWeather> = {}
  for (const result of hotelResults) {
    if (!result) continue
    Object.assign(days, result)
  }

  const body = JSON.stringify({ fetched_at: Date.now(), days })
  const response = new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'max-age=1800',
    },
  })

  context.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}
