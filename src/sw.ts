/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

// 手寫 Service Worker（injectManifest 策略，見 vite.config.ts）。
// 之所以不用 generateSW：Web Push 的 `push`／`notificationclick` 監聽器沒辦法用
// 宣告式設定表達，必須手寫 SW 本體。
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

self.skipWaiting()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// 景點靜態資料與照片：CacheFirst，離線也能顯示已看過的圖。
registerRoute(
  ({ request, url }) => request.destination === 'image' || /\.(?:png|jpe?g|svg|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'images-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
)

// /api/weather：NetworkFirst，跟伺服器自己的 30 分鐘快取呼應。
registerRoute(
  ({ url }) => url.pathname === '/api/weather',
  new NetworkFirst({
    cacheName: 'weather-cache',
    networkTimeoutSeconds: 3,
    plugins: [
      new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 60 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// 登入/同步/訂閱相關端點：絕不快取。
registerRoute(({ url }) => /^\/api\/(login|logout|pull|push|push-subscribe)$/.test(url.pathname), new NetworkOnly())

// SPA navigation fallback，排除 /api/ 開頭的路徑（離線時打 /api/weather 之類的請求
// 不該被導覽 fallback 攔截、錯誤回傳 index.html）。
const navigationHandler = createHandlerBoundToURL('/index.html')
registerRoute(new NavigationRoute(navigationHandler, { denylist: [/^\/api\//] }))

// --- Web Push ---
// payload 形狀見 worker-cron/src/index.ts 送出時組的 JSON：
// { title, body, tag, data: { url } }。收到就直接顯示，data.url 給 notificationclick 用。
interface PushPayload {
  title?: string
  body?: string
  tag?: string
  data?: { url?: string }
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    // 非 JSON payload 就當純文字標題處理，不讓整個事件失敗。
    payload = { title: event.data ? event.data.text() : '' }
  }

  const title = payload.title || ''
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      data: payload.data,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url || '/'
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clientsList.find((c) => 'focus' in c)
      if (existing) {
        await (existing as WindowClient).focus()
        if ('navigate' in existing) await (existing as WindowClient).navigate(url).catch(() => {})
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
