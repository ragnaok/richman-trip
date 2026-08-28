// 刊頭定位文字的 hook 包裝（同 useWeather.ts 的模式）：接上 lib/geo.ts 的抓取＋
// fallback 鏈，對外只回傳一個字串。
import { useEffect, useState } from 'react'
import { getMastheadSnapshot, subscribeMasthead, refreshMasthead } from './geo'

// 模組層級旗標：只在第一次掛載時自動抓一次定位，tab 切換的 remount 與 StrictMode
// 雙重呼叫都不會重複跳權限請求。下拉更新走 refreshMasthead()，不受此旗標影響。
let started = false

export function useMasthead(): string {
  const [label, setLabel] = useState(() => getMastheadSnapshot())

  useEffect(() => {
    const unsubscribe = subscribeMasthead(() => setLabel(getMastheadSnapshot()))
    if (!started) {
      started = true
      void refreshMasthead()
    }
    return unsubscribe
  }, [])

  return label
}
