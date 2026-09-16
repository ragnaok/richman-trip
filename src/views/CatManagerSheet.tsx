import { useState } from 'react'
import { X, Trash, Star } from '@phosphor-icons/react'
import { useStore, useCatNames } from '../lib/store'
import Toast, { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import type { Cat } from '../lib/types'

/**
 * 分類管理 bottom sheet（行李／記帳分頁共用）。
 * 改名暫存在本地 input，按「儲存分類名稱」才套用（renameCat 會連同既有項目一起改）。
 * 刪除點垃圾桶立刻生效，deleteCat 會連同分類裡的項目一起刪除。
 *
 * 「預設分類」只有記帳（kind==='money'）才有：settings.defaultMoneyCat 存哪個分類要在
 * 新增支出時預選。永遠恰好一個——不能點掉變成沒有預設，只能點別的分類換掉，沒設定過
 * 就視覺上退回目前清單第一個（effectiveDefault），跟 ExpenseSheet 的 fallback 邏輯一致。
 * 改名/刪除目前是否為預設的分類時，跟 defaultMethod 一樣不特別同步處理——ExpenseSheet
 * 會檢查 defaultMoneyCat 是否還在目前分類清單裡再套用。
 */
export default function CatManagerSheet({ kind, onClose }: { kind: Cat['kind']; onClose: () => void }) {
  const catNames = useCatNames(kind)
  const packItems = useStore((s) => s.entities.packItems)
  const expenses = useStore((s) => s.entities.expenses)
  const renameCat = useStore((s) => s.renameCat)
  const deleteCat = useStore((s) => s.deleteCat)
  const defaultMoneyCat = useStore((s) => s.entities.settings.defaultMoneyCat)
  const setSetting = useStore((s) => s.setSetting)
  const { toast, showToast } = useToast()

  const effectiveDefault =
    defaultMoneyCat && catNames.includes(defaultMoneyCat) ? defaultMoneyCat : catNames[0]
  const setDefault = (name: string) => setSetting('defaultMoneyCat', name)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

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
    deleteCat(kind, name)
    showToast(`已刪除分類「${name}」與其項目`)
    setDeleteTarget(null)
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
          <div key={name} className="edit-list-row cat-mgr-row">
            {kind === 'money' && (
              <button
                type="button"
                className={`method-mgr-default-btn${effectiveDefault === name ? ' is-default' : ''}`}
                title="設為預設分類"
                onClick={() => setDefault(name)}
              >
                <Star
                  size={14}
                  weight={effectiveDefault === name ? 'fill' : 'duotone'}
                  color={effectiveDefault === name ? 'var(--color-process-yellow)' : 'currentColor'}
                />
              </button>
            )}
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
              onClick={() => setDeleteTarget(name)}
            >
              <Trash size={17} weight="duotone" />
            </button>
          </div>
        ))}

        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={handleSave}>
          儲存分類名稱
        </button>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          message={`刪除分類「${deleteTarget}」？其中的項目也會一併刪除。`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      )}

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
