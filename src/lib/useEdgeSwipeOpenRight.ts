// 右緣滑動開啟設定頁：跟 useEdgeSwipeBack 同一套手感（拖曳回報進度、放開才判斷門檻），
// 但方向相反、觸發的是「開啟」，且觸發條件與回傳形狀都不同，所以獨立成一個 hook。
//
// dragX 是往左拖過的距離（正值），呼叫端把 `windowWidth - dragX` 當設定頁的 translateX，
// isDragging 為 true 時不要接 CSS transition。沒過門檻由 hook 收回 0 讓它彈回螢幕外；
// 過門檻直接呼叫 onOpen()，不需要動畫等待。
import { useEffect, useRef, useState } from 'react'

const EDGE_WIDTH = 24
const COMMIT_THRESHOLD = 70
const MAX_VERTICAL_DRIFT_RATIO = 0.6

export function useEdgeSwipeOpenRight(enabled: boolean, onOpen: () => void) {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    let startX: number | null = null
    let startY: number | null = null
    let active = false

    function onTouchStart(e: TouchEvent) {
      if (!enabledRef.current) {
        active = false
        return
      }
      const t = e.touches[0]
      if (!t || t.clientX < window.innerWidth - EDGE_WIDTH) {
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
      const dx = startX - t.clientX // 往左拖為正
      const dy = Math.abs(t.clientY - startY)
      if (dx <= 0) {
        setDragX(0)
        setIsDragging(false)
        return
      }
      if (dy > dx * MAX_VERTICAL_DRIFT_RATIO) {
        active = false
        setDragX(0)
        setIsDragging(false)
        return
      }
      e.preventDefault()
      setDragX(Math.min(window.innerWidth, dx))
      setIsDragging(true)
    }

    function onTouchEnd(e: TouchEvent) {
      if (active && startX !== null) {
        const t = e.changedTouches[0]
        const dx = t ? startX - t.clientX : 0
        if (dx > COMMIT_THRESHOLD) {
          setDragX(0)
          setIsDragging(false)
          onOpenRef.current()
        } else {
          setDragX(0)
          setIsDragging(false)
        }
      } else {
        setDragX(0)
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
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  return { dragX, isDragging }
}
