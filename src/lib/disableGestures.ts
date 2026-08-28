// 禁止全站縮放手勢。viewport meta 的 user-scalable=no 與 CSS 的
// touch-action:pan-x pan-y（見 app.css）擋掉大部分情況，這裡補兩個 iOS Safari 特有的漏網之魚：
// - `gesturestart`：iOS 的雙指縮放是透過這個非標準事件觸發的，跟 touch-action 是分開的機制。
// - 快速雙擊放大：iOS Safari 偵測到 300ms 內兩次 touchend 在同一個大概位置就會放大，
//   跟 pinch 手勢無關，要另外擋。
export function disableZoomGestures(): void {
  document.addEventListener('gesturestart', (e) => e.preventDefault())

  let lastTouchEnd = 0
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now()
      if (now - lastTouchEnd <= 300) e.preventDefault()
      lastTouchEnd = now
    },
    { passive: false },
  )
}
