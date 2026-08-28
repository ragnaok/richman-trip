import { useState } from 'react'
import { X, Trash } from '@phosphor-icons/react'
import { useStore, useCatNames } from '../lib/store'
import Toast, { useToast } from '../components/Toast'
import type { Cat } from '../lib/types'

/**
 * 分類管理 bottom sheet（行李／記帳分頁共用）。
 * 改名暫存在本地 input，按「儲存分類名稱」才套用（renameCat 會連同既有項目一起改）。
 * 刪除點垃圾桶立刻生效，deleteCat 會連同分類裡的項目一起刪除。
 */
export default function CatManagerSheet({ kind, onClose }: { kind: Cat['kind']; onClose: () => void }) {
  const catNames = useCatNames(kind)
  const packItems = useStore((s) => s.entities.packItems)
  const expenses = useStore((s) => s.entities.expenses)
  const renameCat = useStore((s) => s.renameCat)
  const deleteCat = useStore((s) => s.deleteCat)
  const { toast, showToast } = useToast()

  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const countFor = (name: string): number =>
    kind === 'pack'
      ? packItems.filter((i) => i.deleted !== 1 && i.cat === name).length
      : expenses.filter((e) => e.deleted !== 1 && e.cat === name).length

  const handleSave = () => {
    for (const name of catNames) {
      const next = (drafts[name] ?? name).trim()
      if (next && next !== name) renameCat(kind, name, next)
    }
    showToast('已更新分類名稱')
    onClose()
  }

  const handleDelete = (name: string) => {
    if (!window.confirm(`刪除分類「${name}」？其中的項目也會一併刪除。`)) return
    deleteCat(kind, name)
    showToast(`已刪除分類「${name}」與其項目`)
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
          <h3 className="edit-title">{kind === 'pack' ? '管理行李分類' : '管理記帳分類'}</h3>
          <button type="button" className="btn btn-ghost edit-close-btn" onClick={onClose} aria-label="關閉">
            <X size={16} weight="duotone" />
          </button>
        </div>
        <p className="edit-hint">改名會一併套用到既有項目；刪除分類會連同其中的項目一起刪除。</p>

        {catNames.map((name) => (
          <div key={name} className="edit-list-row">
            <input
              className="input"
              value={drafts[name] ?? name}
              onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
            />
            <span className="cat-mgr-count">{countFor(name)}</span>
            <button
              type="button"
              className="btn btn-ghost edit-list-row-remove"
              aria-label={`刪除分類 ${name}`}
              onClick={() => handleDelete(name)}
            >
              <Trash size={17} weight="duotone" />
            </button>
          </div>
        ))}

        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={handleSave}>
          儲存分類名稱
        </button>
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
