import type { ReactNode } from 'react'

/**
 * 刪除等破壞性操作的二次確認彈窗，取代 window.confirm()——PWA 加到主畫面／部分內嵌
 * 瀏覽器環境下原生 confirm 對話框不會正常彈出（或直接被判定取消），按下刪除會完全沒反應。
 * 點背景可取消，跟其他 bottom sheet 的慣例一致。
 */
export default function ConfirmDialog({
  message,
  confirmLabel = '刪除',
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  message: ReactNode
  confirmLabel?: string
  /** 需要「思考時間」才能按確認的破壞性操作（例如強制同步）用，倒數期間傳 true。 */
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="confirm-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="confirm-dialog">
        <p>{message}</p>
        <div className="confirm-dialog-row">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary confirm-dialog-danger-btn"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
