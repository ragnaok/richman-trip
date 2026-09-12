// functions/icon-192.png.ts、icon-512.png.ts 共用：設定頁有上傳過就把存在 D1
// settings 的 data URL 解成真正的圖片 bytes 吐出去；沒有就退回 public/ 裡建置時
// 就有的範本預設圖。
//
// 為什麼要吐真正的 bytes、不是導向 data URL 或轉址：iOS「加到主畫面」讀的
// <link rel="apple-touch-icon"> 只認得能實際 fetch 到圖片內容的網址，不吃
// data:/blob: scheme（跟 functions/manifest.webmanifest.ts 檔頭註解提到的限制
// 是同一件事）。網址維持固定的 /icon-192.png、/icon-512.png，只是背後的內容
// 從「建置時的靜態檔」換成「請求當下查 D1 動態產生」。
import type { Env } from '../api/_lib/env'

const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/

export async function serveIcon(
  context: { env: Env; request: Request },
  settingsKey: string,
  defaultPath: string,
): Promise<Response> {
  const row = await context.env.DB.prepare('SELECT v FROM settings WHERE k = ?').bind(settingsKey).first<{ v: string }>()
  const match = row?.v ? DATA_URL_RE.exec(row.v) : null

  if (match) {
    const [, mime, base64] = match
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Response(bytes, {
      headers: {
        'content-type': mime,
        // 短快取：設定頁改了圖示希望不用等太久就生效（見 App.tsx 的說明，主畫面
        // 圖示本來就只有「以後加入的人」看得到新的，這裡快取時間不是關鍵）。
        'cache-control': 'public, max-age=300',
      },
    })
  }

  const url = new URL(context.request.url)
  return context.env.ASSETS.fetch(new URL(defaultPath, url.origin).toString())
}
