// /api/exchange-rate — 代理 haotool/app 鏡射的台銀牌告匯率 JSON，走登入驗證（非公開路徑）。
//
// 資料來源選這個第三方鏡射而不是直接打 rate.bot.com.tw：台銀官網前面擋了一層防爬蟲
// JS challenge（要跑瀏覽器才能過），Pages Function 的 fetch() 打不過去。haotool/app
// 每 5 分鐘同步一次台銀牌告匯率，鏡射成靜態 JSON 丟 GitHub、用 jsDelivr CDN 供應，
// 免金鑰免註冊。取 cash.sell（現金賣出，銀行賣外幣現金給你的匯率），對應「換現金出國
// 花用」的情境，跟這個 App 把外幣花費換算回台幣的用途最貼近。
// 詳見 https://app.haotool.org/ratewise/open-data/
import type { Env } from './_lib/env'

const RATES_URL = 'https://cdn.jsdelivr.net/gh/haotool/app@data/public/rates/latest.json'

interface HaotoolRates {
  details?: Record<string, { cash?: { sell?: number } }>
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const from = (url.searchParams.get('from') || '').toUpperCase()
  if (!/^[A-Z]{2,5}$/.test(from)) {
    return new Response(JSON.stringify({ error: '幣別代碼格式錯誤' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  // 上游每 5 分鐘同步一次，快取 5 分鐘即可跟上，減少重複打 jsDelivr。
  const cache = caches.default
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  let data: HaotoolRates
  try {
    const res = await fetch(RATES_URL)
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    data = await res.json()
  } catch {
    return new Response(JSON.stringify({ error: '匯率服務暫時無法連線，請稍後再試' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rate = data.details?.[from]?.cash?.sell
  if (rate == null) {
    return new Response(JSON.stringify({ error: `抓不到 ${from} 的匯率` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }

  const body = JSON.stringify({ rate, fetched_at: Date.now() })
  const response = new Response(body, {
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
  })
  context.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}
