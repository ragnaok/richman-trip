// 動態產生 Web App Manifest：name/short_name/description 用這趟行程的 destTitle 與
// 日期，而不是建置時寫死的範本文字。iOS「加入主畫面」主要看 index.html 的
// apple-mobile-web-app-title，但 Android/Chrome 安裝與較新的 iOS 會讀這份。
// 免認證：這幾個欄位本來就會在登入畫面顯示。
import type { Env } from './api/_lib/env'

const ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await context.env.DB.prepare(
    "SELECT k, v FROM settings WHERE k IN ('destTitle','tripStart','tripEnd')",
  ).all<{ k: string; v: string }>()
  const settings = new Map(result.results.map((r) => [r.k, r.v]))

  const name = settings.get('destTitle') || '我的旅行'
  const tripStart = settings.get('tripStart')
  const tripEnd = settings.get('tripEnd')
  const description = tripStart && tripEnd ? `${name}（${tripStart} – ${tripEnd}）` : name

  const manifest = {
    name,
    short_name: name,
    description,
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'zh-Hant',
    theme_color: '#f3f2f2',
    background_color: '#f3f2f2',
    icons: ICONS,
  }

  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json',
      // 短快取：只有安裝那一刻會讀，設定改了也能很快生效。
      'cache-control': 'public, max-age=60',
    },
  })
}
