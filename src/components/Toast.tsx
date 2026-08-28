import { useCallback, useEffect, useRef, useState } from 'react'

/** 可重用 Toast 元件 + 狀態管理 hook，呼叫端用 showToast() 顯示訊息。 */

export interface ToastState {
  id: number
  message: string
}

const TOAST_DURATION_MS = 2600

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<number | null>(null)

  const showToast = useCallback((message: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setToast({ id: Date.now(), message })
    timerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  return { toast, showToast }
}

export default function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
