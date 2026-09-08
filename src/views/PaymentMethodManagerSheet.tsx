import { useState } from 'react'
import { X, Trash, Plus } from '@phosphor-icons/react'
import { useStore, usePaymentMethodNames } from '../lib/store'
import Toast, { useToast } from '../components/Toast'

/**
 * 付款方式管理面板，疊在 ExpenseSheet 之上（同一個「新增支出」流程裡才會開）。
 * 現金／信用卡是內建固定值，不可改名/刪除；下面才是可改名/可刪除的自訂方式，
 * 結構照抄 CatManagerSheet：改名暫存本地 draft，按儲存才套用，刪除立即生效。
 */
export default function PaymentMethodManagerSheet({ onClose }: { onClose: () => void }) {
  const methodNames = usePaymentMethodNames()
  const addPaymentMethod = useStore((s) => s.addPaymentMethod)
  const renamePaymentMethod = useStore((s) => s.renamePaymentMethod)
  const deletePaymentMethod = useStore((s) => s.deletePaymentMethod)
  const { toast, showToast } = useToast()

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) return
    addPaymentMethod(name)
    setNewName('')
  }

  const handleSave = () => {
    for (const name of methodNames) {
      const next = (drafts[name] ?? name).trim()
      if (next && next !== name) renamePaymentMethod(name, next)
    }
    showToast('付款方式已更新')
    onClose()
  }

  const handleDelete = (name: string) => {
    if (!window.confirm(`刪除付款方式「${name}」？相關支出會改記為現金。`)) return
    deletePaymentMethod(name)
    showToast(`已刪除付款方式「${name}」`)
  }

  return (
    <div
      className="edit-overlay expense-method-mgr-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="edit-sheet">
        <div className="edit-header">
          <h3 className="edit-title">管理付款方式</h3>
          <button type="button" className="btn btn-ghost edit-close-btn" onClick={onClose} aria-label="關閉">
            <X size={16} weight="duotone" />
          </button>
        </div>
        <p className="edit-hint">現金、信用卡為預設方式，不可更名或刪除。改名會套用到既有支出；刪除後相關支出會改記為現金。</p>

        <div className="edit-list-row method-mgr-builtin-row">
          <span>現金</span>
          <span>信用卡</span>
        </div>

        <div className="edit-list-row">
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
            placeholder="新增付款方式，例如 西瓜卡"
          />
          <button type="button" className="btn btn-secondary" onClick={handleAdd} aria-label="新增付款方式">
            <Plus size={16} weight="bold" />
          </button>
        </div>

        {methodNames.length === 0 && <p className="money-empty">還沒有新增其他付款方式</p>}

        {methodNames.map((name) => (
          <div key={name} className="edit-list-row">
            <input
              className="input"
              value={drafts[name] ?? name}
              onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
            />
            <button
              type="button"
              className="btn btn-ghost edit-list-row-remove"
              aria-label={`刪除付款方式 ${name}`}
              onClick={() => handleDelete(name)}
            >
              <Trash size={17} weight="duotone" />
            </button>
          </div>
        ))}

        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={handleSave}>
          儲存變更
        </button>
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
