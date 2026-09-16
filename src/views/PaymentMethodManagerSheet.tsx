import { useState } from 'react'
import { X, Trash, Plus, Star } from '@phosphor-icons/react'
import { useStore, usePaymentMethodNames } from '../lib/store'
import Toast, { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

/**
 * 付款方式管理面板，疊在 ExpenseSheet 之上（同一個「新增支出」流程裡才會開）。
 * 現金是內建固定值，不可改名/刪除；信用卡可改名（存 settings.cardLabel）但不可刪除；
 * 下面才是可改名/可刪除的自訂方式，結構照抄 CatManagerSheet：改名暫存本地 draft，
 * 按儲存才套用，刪除立即生效。
 *
 * 「預設」：settings.defaultMethod 存哪個方式（'card' 或自訂方式名）要顯示在新增支出畫面
 * 「現金」旁邊那個槽位，同時間只有一個是預設，點某個方式的預設＝把 defaultMethod 改成它、
 * 再點一次＝改回 'card'（見 lib/money.ts 開頭註解，這是單一 settings 值而非各列各自的旗標，
 * 避免離線多裝置同時設不同預設造成衝突）。
 */
export default function PaymentMethodManagerSheet({ onClose }: { onClose: () => void }) {
  const methodNames = usePaymentMethodNames()
  const cardLabel = useStore((s) => s.entities.settings.cardLabel ?? '信用卡')
  const defaultMethod = useStore((s) => s.entities.settings.defaultMethod ?? 'card')
  const setSetting = useStore((s) => s.setSetting)
  const addPaymentMethod = useStore((s) => s.addPaymentMethod)
  const renamePaymentMethod = useStore((s) => s.renamePaymentMethod)
  const deletePaymentMethod = useStore((s) => s.deletePaymentMethod)
  const { toast, showToast } = useToast()

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [cardLabelDraft, setCardLabelDraft] = useState(cardLabel)
  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const toggleDefault = (key: string) => setSetting('defaultMethod', defaultMethod === key ? 'card' : key)

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
    const nextCardLabel = cardLabelDraft.trim()
    if (nextCardLabel && nextCardLabel !== cardLabel) setSetting('cardLabel', nextCardLabel)
    showToast('付款方式已更新')
    onClose()
  }

  const handleDelete = (name: string) => {
    deletePaymentMethod(name)
    showToast(`已刪除付款方式「${name}」`)
    setDeleteTarget(null)
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
        <p className="edit-hint">
          現金為預設方式，不可更名或刪除。信用卡可改名，不可刪除。
          設為預設的方式會顯示在新增支出畫面「現金」旁邊的位置。
          改名會套用到既有支出；刪除自訂方式後相關支出會改記為現金。
        </p>

        <div className="edit-list-row">
          <button
            type="button"
            className={`method-mgr-default-btn${defaultMethod === 'card' ? ' is-default' : ''}`}
            title="設為預設"
            onClick={() => toggleDefault('card')}
          >
            <Star
              size={14}
              weight={defaultMethod === 'card' ? 'fill' : 'duotone'}
              color={defaultMethod === 'card' ? 'var(--color-process-yellow)' : 'currentColor'}
            />
            預設
          </button>
          <input className="input" value={cardLabelDraft} onChange={(e) => setCardLabelDraft(e.target.value)} />
        </div>

        {methodNames.length === 0 && <p className="money-empty">還沒有新增其他付款方式</p>}

        {methodNames.map((name) => (
          <div key={name} className="edit-list-row">
            <button
              type="button"
              className={`method-mgr-default-btn${defaultMethod === name ? ' is-default' : ''}`}
              title="設為預設，顯示在新增支出畫面「信用卡」的位置"
              onClick={() => toggleDefault(name)}
            >
              <Star
                size={14}
                weight={defaultMethod === name ? 'fill' : 'duotone'}
                color={defaultMethod === name ? 'var(--color-process-yellow)' : 'currentColor'}
              />
              預設
            </button>
            <input
              className="input"
              value={drafts[name] ?? name}
              onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
            />
            <button
              type="button"
              className="btn btn-ghost edit-list-row-remove"
              aria-label={`刪除付款方式 ${name}`}
              onClick={() => setDeleteTarget(name)}
            >
              <Trash size={17} weight="duotone" />
            </button>
          </div>
        ))}

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

        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={handleSave}>
          儲存變更
        </button>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          message={`刪除付款方式「${deleteTarget}」？相關支出會改記為現金。`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      )}

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
