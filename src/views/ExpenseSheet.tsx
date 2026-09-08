import { useState } from 'react'
import { Plus, X, Trash, Money, CreditCard, CaretDown, SlidersHorizontal, CheckSquare, Square } from '@phosphor-icons/react'
import { useStore, useCatNames, useMemberNames, usePaymentMethodNames } from '../lib/store'
import { genId } from '../lib/id'
import { rateNum, formatTWD, payMethod, truncateMethodLabel } from '../lib/money'
import { todayISO } from '../lib/time'
import Toast, { useToast } from '../components/Toast'
import PaymentMethodManagerSheet from './PaymentMethodManagerSheet'
import type { Currency, Payer, PayMethod } from '../lib/types'

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
  const paymentMethods = usePaymentMethodNames()
  const currentRole = useStore((s) => s.ui.auth.role)

  const editing = editingId != null ? expenses.find((e) => e.id === editingId) : undefined
  const isNew = !editing

  const [title, setTitle] = useState(editing?.title ?? '')
  const [spentOn, setSpentOn] = useState(editing?.spent_on ?? todayISO())
  const [cur, setCur] = useState<Currency>(editing?.cur ?? 'JPY')
  const [amt, setAmt] = useState(editing ? String(editing.amt) : '')
  const [cat, setCat] = useState(editing?.cat ?? moneyCats[0])
  const [payer, setPayer] = useState<Payer>(editing?.payer ?? currentRole ?? memberNames[0] ?? '')
  const [method, setMethod] = useState<PayMethod>(editing ? payMethod(editing) : 'cash')
  const [daigou, setDaigou] = useState(editing?.daigou ?? false)
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)
  const [methodMgrOpen, setMethodMgrOpen] = useState(false)

  const rate = rateNum(rateStr)
  const amtNum = Number(amt)
  const validAmt = Number.isFinite(amtNum) && amtNum > 0
  const methodIsCustom = method !== 'cash' && method !== 'card'

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
      spent_on: spentOn,
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

        <div className="expense-field-row">
          <div className="field" style={{ flex: 7 }}>
            <label>項目</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 3, minWidth: 0 }}>
            <label>日期</label>
            <input className="input" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
          </div>
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
            <div className="expense-method-field">
              <button
                type="button"
                className={`expense-cur-chip expense-method-cash${method === 'cash' ? ' is-selected' : ''}`}
                onClick={() => {
                  setMethod('cash')
                  setMethodMenuOpen(false)
                }}
              >
                <Money size={15} weight="duotone" />
                現金
              </button>
              <div className="expense-method-card-group">
                <button
                  type="button"
                  className={`expense-method-card${method !== 'cash' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setMethod('card')
                    setMethodMenuOpen(false)
                  }}
                >
                  <CreditCard size={15} weight="duotone" />
                  {methodIsCustom ? truncateMethodLabel(method) : '信用卡'}
                </button>
                <button
                  type="button"
                  className="expense-method-caret"
                  aria-label="選擇其他付款方式"
                  onClick={() => setMethodMenuOpen(!methodMenuOpen)}
                >
                  <CaretDown size={12} weight="bold" />
                </button>
              </div>

              {methodMenuOpen && (
                <>
                  <div className="expense-method-menu-backdrop" onClick={() => setMethodMenuOpen(false)} />
                  <div className="expense-method-menu">
                    {methodIsCustom && (
                      <button
                        type="button"
                        className="expense-method-menu-item"
                        onClick={() => {
                          setMethod('card')
                          setMethodMenuOpen(false)
                        }}
                      >
                        信用卡
                      </button>
                    )}
                    {paymentMethods.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`expense-method-menu-item${method === m ? ' is-selected' : ''}`}
                        onClick={() => {
                          setMethod(m)
                          setMethodMenuOpen(false)
                        }}
                      >
                        {m}
                      </button>
                    ))}
                    {(paymentMethods.length > 0 || methodIsCustom) && <div className="expense-method-menu-divider" />}
                    <button
                      type="button"
                      className="expense-method-menu-item expense-method-menu-manage"
                      onClick={() => {
                        setMethodMenuOpen(false)
                        setMethodMgrOpen(true)
                      }}
                    >
                      <SlidersHorizontal size={13} weight="duotone" />
                      管理
                    </button>
                  </div>
                </>
              )}
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

      {methodMgrOpen && <PaymentMethodManagerSheet onClose={() => setMethodMgrOpen(false)} />}

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
