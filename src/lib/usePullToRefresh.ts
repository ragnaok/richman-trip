// 下拉更新：內容區 scrollTop<=0 時記錄手指 Y，往下拖的位移 ×0.45、上限 64px；
// 放開若 >44px 就顯示「更新中…」，約 1 秒後收起並吐 toast，否則彈回。
//
// 用原生 touch 事件並在確認是下拉手勢時 preventDefault：standalone 全螢幕模式下 iOS
// 會把「在內容頂部往下拖」當成自己的橡皮筋手勢，不擋預設行為就收不到連續的 move。
import { useEffect, useRef, useState } from 'react'

export type PullStatus = 'idle' | 'pull' | 'release' | 'refreshing'

const PULL_RATIO = 0.45
const MAX_PULL = 64
const RELEASE_THRESHOLD = 44
const REFRESH_PULL_HEIGHT = 56
const MIN_REFRESH_MS = 950

export function usePullToRefresh({
  onRefresh,
  onDone,
}: {
  /** 實際的更新工作（重抓天氣/定位）。 */
  onRefresh: () => void | Promise<void>
  /** 收起動畫結束後才呼叫（例如吐 toast），跟 onRefresh 分開是為了讓 toast 在畫面收起後才出現。 */
  onDone?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [status, setStatus] = useState<PullStatus>('idle')

  // 用 ref 保存目前值，讓 touch 事件 handler 不必因為 pull/status 變化而重新綁定。
  const liveRef = useRef({ startY: null as number | null, pulling: false, pull: 0, status: 'idle' as PullStatus })
  useEffect(() => {
    liveRef.current.pull = pull
    liveRef.current.status = status
  }, [pull, status])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      if (liveRef.current.status === 'refreshing') return
      if (el!.scrollTop > 0) {
        liveRef.current.startY = null
        return
      }
      liveRef.current.startY = e.touches[0]?.clientY ?? null
      liveRef.current.pulling = false
    }

    function onTouchMove(e: TouchEvent) {
      const { startY, status: st } = liveRef.current
      if (startY === null || st === 'refreshing') return
      const y = e.touches[0]?.clientY
      if (y === undefined) return
      const dy = y - startY
      if (dy <= 0) {
        if (liveRef.current.pulling) {
          liveRef.current.pulling = false
          liveRef.current.pull = 0
          setPull(0)
          setStatus('idle')
        }
        return
      }
      // 確認是下拉手勢才擋掉預設行為，避免吃掉一般的垂直捲動（scrollTop>0 時本來就不會走到這）。
      liveRef.current.pulling = true
      if (e.cancelable) e.preventDefault()
      const offset = Math.min(MAX_PULL, dy * PULL_RATIO)
      liveRef.current.pull = offset
      setPull(offset)
      setStatus(offset > RELEASE_THRESHOLD ? 'release' : 'pull')
    }

    async function onTouchEnd() {
      const { startY, pull: p } = liveRef.current
      liveRef.current.startY = null
      liveRef.current.pulling = false
      if (startY === null) return
      if (p > RELEASE_THRESHOLD) {
        setStatus('refreshing')
        setPull(REFRESH_PULL_HEIGHT)
        const started = Date.now()
        await Promise.resolve(onRefresh())
        const wait = MIN_REFRESH_MS - (Date.now() - started)
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        setStatus('idle')
        setPull(0)
        onDone?.()
      } else {
        setStatus('idle')
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRefresh, onDone])

  return { containerRef, pull, status }
}
