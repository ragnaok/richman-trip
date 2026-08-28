import { useState } from 'react'
import { Plus, X, Trash, Money, CreditCard, CheckSquare, Square } from '@phosphor-icons/react'
import { useStore, useCatNames, useMemberNames } from '../lib/store'
import { genId } from '../lib/id'
import { rateNum, formatTWD, payMethod, PAY_METHOD_LABEL } from '../lib/money'
import Toast, { useToast } from '../components/Toast'
import type { Currency, Payer, PayMethod } from '../lib/types'

const METHOD_OPTS: Array<{ key: PayMethod; Icon: typeof Money }> = [
  { key: 'cash', Icon: Money },
  { key: 'card', Icon: CreditCard },
]

/**
 * 新增／編輯支出 bottom sheet，樣式沿用 PlanEditSheet 的 edit-overlay / edit-sheet 慣例。
 * ui.editingExpenseId 有值是編輯既有支出，否則是 ui.addExpenseOpen 的新增流程；
 * isNew 靠有沒有找到對應的既有支出判斷。
 */
export default function ExpenseSheet() {
  const rateStr = useStore((s) => s.entities.settings.rate ?? '0.216')
  const expenses = useStore((s) => s.entities.expenses)
  const editingId = useStore((s) => s.ui.editingExpenseId)
  const closeAddExpense = useStore((s) => s.closeAddExpense)
  const upsertExpense = useStore((s) => s.upsertExpense)
  const deleteExpense = useStore((s) => s.deleteExpense)
  const upsertCat = useStore((s) => s.upsertCat)

  const { toast, showToast } = useToast()
  const moneyCats = useCatNames('money')
  const memberNames = useMemberNames()
  const currentRole = useStore((s) => s.ui.auth.role)

  const editing = editingId != null ? expenses.find((e) => e.id === editingId) : undefined
  const isNew = !editing

  const [title, setTitle] = useState(editing?.title ?? '')
  const [cur, setCur] = useState<Currency>(editing?.cur ?? 'JPY')
  const [amt, setAmt] = useState(editing ? String(editing.amt) : '')
  const [cat, setCat] = useState(editing?.cat ?? moneyCats[0])
  const [payer, setPayer] = useState<Payer>(editing?.payer ?? currentRole ?? memberNames[0] ?? '')
  const [method, setMethod] = useState<PayMethod>(editing ? payMethod(editing) : 'cash')
  const [daigou, setDaigou] = useState(editing?.daigou ?? false)
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const rate = rateNum(rateStr)
  const amtNum = Number(amt)
  const validAmt = Number.isFinite(amtNum) && amtNum > 0

  const close = () => closeAddExpense()

  const handleCreateCat = () => {
    const name = newCatName.trim()
    if (!name) return
    upsertCat({ kind: 'money', name })
    setCat(name)
    setNewCatName('')
    setShowNewCat(false)
  }

  const handleSave = () => {
    if (!title.trim() || !validAmt) return
    upsertExpense({
      id: editing?.id ?? genId(),
      title: title.trim(),
      cat,
      cur,
      amt: amtNum,
      payer,
      method,
      daigou,
      spent_on: editing?.spent_on,
    })
    showToast(isNew ? `記一筆 · ${title.trim()}` : `已更新 · ${title.trim()}`)
    close()
  }

  const handleDelete = () => {
    if (!editing) return
    if (!window.confirm(`刪除「${editing.title}」這筆支出？`)) return
    deleteExpense(editing.id)
    showToast('已刪除這筆支出')
    close()
  }

  return (
    <div
      className="edit-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="edit-sheet">
        <div className="edit-header">
          <h3 className="edit-title">{isNew ? '新增支出' : '編輯支出'}</h3>
          <button
            type="button"
            className={`daigou-toggle-btn${daigou ? ' is-active' : ''}`}
            title="代購金額不計入「不含代購」的統計，明細會標記「代購」"
            onClick={() => setDaigou(!daigou)}
          >
            {daigou ? <CheckSquare size={14} weight="duotone" /> : <Square size={14} weight="duotone" />}
            代購
          </button>
          <button type="button" className="btn btn-ghost edit-close-btn" onClick={close} aria-label="關閉">
            <X size={16} weight="duotone" />
          </button>
        </div>

        <div className="field">
          <label>項目</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="expense-field-row">
          <div className="field">
            <label>幣別</label>
            <div className="expense-cur-chips">
              <button
                type="button"
                className={`expense-cur-chip${cur === 'JPY' ? ' is-selected' : ''}`}
                onClick={() => setCur('JPY')}
              >
                日圓 ¥
              </button>
              <button
                type="button"
                className={`expense-cur-chip${cur === 'TWD' ? ' is-selected' : ''}`}
                onClick={() => setCur('TWD')}
              >
                台幣 NT$
              </button>
            </div>
          </div>

          <div className="field">
            <label>付款方式</label>
            <div className="expense-cur-chips">
              {METHOD_OPTS.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`expense-cur-chip expense-method-chip${method === key ? ' is-selected' : ''}`}
                  onClick={() => setMethod(key)}
                >
                  <Icon size={15} weight="duotone" />
                  {PAY_METHOD_LABEL[key]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <label>金額（{cur === 'JPY' ? '日圓' : '台幣'}）</label>
          <input
            className="input"
            inputMode="decimal"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />
          {validAmt && (
            <p className="expense-converted">
              {cur === 'JPY' ? `約合 ${formatTWD(amtNum * rate)}` : '台幣直付'}
            </p>
          )}
        </div>

        <div className="field">
          <label>分類</label>
          <div className="edit-kind-chips">
            {moneyCats.map((c) => (
              <button
                key={c}
                type="button"
                className={`edit-kind-chip${cat === c ? ' is-selected' : ''}`}
                onClick={() => setCat(c)}
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              className="expense-new-cat-btn"
              onClick={() => setShowNewCat(!showNewCat)}
              aria-label="新增分類"
            >
              <Plus size={16} weight="bold" />
            </button>
          </div>
          {showNewCat && (
            <div className="pack-new-cat">
              <input
                className="input"
                placeholder="新分類名稱"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={handleCreateCat}>
                建立
              </button>
            </div>
          )}
        </div>

        <div className="field">
          <label>誰付的</label>
          <div className="expense-cur-chips">
            {memberNames.map((p) => (
              <button
                key={p}
                type="button"
                className={`expense-cur-chip${payer === p ? ' is-selected' : ''}`}
                onClick={() => setPayer(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="expense-save-row">
          <button
            type="button"
            className="btn btn-primary expense-save-btn"
            disabled={!title.trim() || !validAmt}
            onClick={handleSave}
          >
            {isNew ? '記一筆' : '儲存變更'}
          </button>
          {!isNew && (
            <button
              type="button"
              className="btn btn-secondary edit-delete-btn expense-delete-btn"
              onClick={handleDelete}
              aria-label="刪除這筆支出"
            >
              <Trash size={16} weight="duotone" />
            </button>
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
