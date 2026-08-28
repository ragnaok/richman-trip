import { useState } from 'react'
import { X, Trash } from '@phosphor-icons/react'
import { useStore, useCatNames, useMemberNames } from '../lib/store'
import Toast, { useToast } from '../components/Toast'
import type { Owner, PackItem } from '../lib/types'

const SHARED_OWNER = '共同'

/** 行李項目編輯 bottom sheet，由 PackTab 的鉛筆鈕開啟（store.ui.packEditItemId）。
 * 跟其他 bottom sheet 一樣在 App.tsx 頂層渲染，不能塞進 PackTab 的捲動容器。 */
export default function PackItemEditSheet({ itemId, onClose }: { itemId: PackItem['id']; onClose: () => void }) {
  const catNames = useCatNames('pack')
  const packItems = useStore((s) => s.entities.packItems)
  const upsertPackItem = useStore((s) => s.upsertPackItem)
  const deletePackItem = useStore((s) => s.deletePackItem)
  const { toast, showToast } = useToast()

  const memberNames = useMemberNames()
  const ownerOpts: Owner[] = [SHARED_OWNER, ...memberNames]
  const item = packItems.find((i) => i.id === itemId)

  const [name, setName] = useState(item?.name ?? '')
  const [cat, setCat] = useState(item?.cat ?? '')
  const [owner, setOwner] = useState<Owner>(item?.owner ?? SHARED_OWNER)

  if (!item) return null

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    upsertPackItem({ id: item.id, name: trimmed, cat, owner, done: item.done })
    showToast('已更新行李項目')
    onClose()
  }

  const handleDelete = () => {
    if (!window.confirm(`刪除「${item.name}」這個項目？`)) return
    deletePackItem(item.id)
    showToast('已刪除項目')
    onClose()
  }

  return (
    <div
      className="edit-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="edit-sheet">
        <div className="edit-header">
          <h3 className="edit-title">編輯項目</h3>
          <button type="button" className="btn btn-ghost edit-close-btn" onClick={onClose} aria-label="關閉">
            <X size={16} weight="duotone" />
          </button>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>名稱</label>
          <input className="input" placeholder="項目名稱" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="edit-section-label" style={{ marginTop: 14 }}>
          分類
        </div>
        <div className="edit-kind-chips" style={{ marginTop: 6 }}>
          {catNames.map((c) => (
            <button
              key={c}
              type="button"
              className={`edit-kind-chip${cat === c ? ' is-selected' : ''}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="edit-section-label" style={{ marginTop: 14 }}>
          持有人
        </div>
        <div className="pack-owner-chips" style={{ marginTop: 6 }}>
          {ownerOpts.map((o) => (
            <button
              key={o}
              type="button"
              className={`itin-day-chip${owner === o ? ' is-selected' : ''}`}
              onClick={() => setOwner(o)}
            >
              {o}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block edit-save-btn"
          disabled={!name.trim()}
          onClick={handleSave}
        >
          儲存變更
        </button>
        <button type="button" className="btn btn-secondary btn-block edit-delete-btn" onClick={handleDelete}>
          <Trash size={16} weight="duotone" /> 刪除這個項目
        </button>
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
