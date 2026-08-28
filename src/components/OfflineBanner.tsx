import { useStore } from '../lib/store'

/**
 * 離線提示條：純呈現 store.ui.offline（連線狀態的追蹤在 lib/store.ts 底部）。
 * 掛在 App.tsx 的 app-content 頂部，四個分頁共用同一個實例。
 */
export default function OfflineBanner() {
  const offline = useStore((s) => s.ui.offline)
  if (!offline) return null
  return <div className="offline-banner">離線模式 · 顯示已快取的行程與清單</div>
}
