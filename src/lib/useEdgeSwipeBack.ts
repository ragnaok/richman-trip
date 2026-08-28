// 左緣滑動返回（模仿 iOS 系統手勢）：從螢幕最左邊往右滑觸發 onBack()。
// 用原生 touch 事件而非 Pointer Events，跟 usePullToRefresh 監聽不同軸向、不搶手勢。
//
// 拖曳中只回報進度（呼叫端可畫跟著手指走的返回箭頭），放開的當下才判斷有沒有過門檻；
// 沒過就把進度彈回 0，讓使用者看得到「拖到這裡放開才會返回」的回饋。
//
// pageDragX/isDragging 給「整頁跟手指滑動」的全螢幕頁面用（跟上限 MAX_DRAG 的箭頭
// 指示器 dragX 分開）：把 pageDragX 當 translateX 套在頁面根節點，isDragging 為 true
// 時不要接 CSS transition（要 1:1 跟手指走）。沒過門檻由 hook 自己收回 0；過了門檻則
// 由呼叫端決定要不要用 onBack 收到的 animateClose(cb)——不用就一放開立刻觸發
// （bottom sheet 的行為），用了則等滑出動畫跑完才執行 cb()。
import { useEffect, useRef, useState } from 'react'

const EDGE_WIDTH = 24 // 只有從螢幕最左邊這個寬度內開始的觸碰才算「邊緣滑動」
const MAX_DRAG = 90 // 箭頭指示器的位移上限
const COMMIT_THRESHOLD = 70 // 放開時，水平位移超過這個值才真的觸發返回
const MAX_VERTICAL_DRIFT_RATIO = 0.6 // 垂直位移超過水平位移這個比例，視為在捲動不是滑動返回
const CLOSE_ANIM_MS = 220 // 整頁滑出動畫時長，跟 App.tsx 裡 CSS transition 的時間一致

export function useEdgeSwipeBack(onBack: (helpers: { animateClose: (cb: () => void) => void }) => void) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const [dragX, setDragX] = useState(0)
  const [pageDragX, setPageDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    let startX: number | null = null
    let startY: number | null = null
    let active = false // 目前這次觸碰是否已經判定為「邊緣滑動」手勢
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    function animateClose(cb: () => void) {
      setIsDragging(false)
      setPageDragX(window.innerWidth)
      closeTimer = setTimeout(() => {
        cb()
        setPageDragX(0)
      }, CLOSE_ANIM_MS)
    }

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0]
      if (!t || t.clientX > EDGE_WIDTH) {
        startX = null
        startY = null
        active = false
        return
      }
      startX = t.clientX
      startY = t.clientY
      active = true
    }

    function onTouchMove(e: TouchEvent) {
      if (!active || startX === null || startY === null) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dx <= 0) {
        setDragX(0)
        setPageDragX(0)
        setIsDragging(false)
        return
      }
      if (dy > dx * MAX_VERTICAL_DRIFT_RATIO) {
        // 垂直位移太大，判定使用者是在捲動內容，取消這次的邊緣滑動判定。
        active = false
        setDragX(0)
        setPageDragX(0)
        setIsDragging(false)
        return
      }
      // 已確認是水平方向的邊緣滑動，擋掉這次觸碰接下來的預設捲動行為，
      // 避免手指同時往下漂移時畫面跟著上下跳動。
      e.preventDefault()
      setDragX(Math.min(MAX_DRAG, dx))
      setPageDragX(Math.min(window.innerWidth, dx))
      setIsDragging(true)
    }

    function onTouchEnd(e: TouchEvent) {
      if (active && startX !== null) {
        const t = e.changedTouches[0]
        const dx = t ? t.clientX - startX : 0
        if (dx > COMMIT_THRESHOLD) {
          setDragX(0)
          onBackRef.current({ animateClose })
        } else {
          setDragX(0)
          setPageDragX(0)
          setIsDragging(false)
        }
      } else {
        setDragX(0)
        setPageDragX(0)
        setIsDragging(false)
      }
      startX = null
      startY = null
      active = false
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      if (closeTimer) clearTimeout(closeTimer)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  return { dragX, maxDragX: MAX_DRAG, commitThreshold: COMMIT_THRESHOLD, pageDragX, isDragging }
}
