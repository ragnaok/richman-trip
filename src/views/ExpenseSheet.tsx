import { useState } from 'react'
import {
  Plus,
  X,
  Trash,
  Money,
  CreditCard,
  CaretDown,
  SlidersHorizontal,
  CheckSquare,
  Square,
  UsersThree,
} from '@phosphor-icons/react'
import { useStore, useCatNames, useMemberNames, usePaymentMethodNames } from '../lib/store'
import { genId } from '../lib/id'
import { rateNum, formatTWD, formatJPY, payMethod, methodLabel, truncateMethodLabel } from '../lib/money'
import { todayISO } from '../lib/time'
import Toast, { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import PaymentMethodManagerSheet from './PaymentMethodManagerSheet'
import PayerSplitSheet from './PayerSplitSheet'
import type { Currency, Payer, PayMethod } from '../lib/types'

function numMap(src: Record<string, number> | undefined): Record<string, string> {
  if (!src) return {}
  return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, String(v)]))
}

function isEdited(v: string | undefined): boolean {
  return v !== undefined && v !== ''
}

/**
 * 新增／編輯支出 bottom sheet，樣式沿用 PlanEditSheet 的 edit-overlay / edit-sheet 慣例。
 * ui.editingExpenseId 有值是編輯既有支出，否則是 ui.addExpenseOpen 的新增流程；
 * isNew 靠有沒有找到對應的既有支出判斷。
 *
 * 「誰付的」是單一主要付款人（payer），永遠存在；「付款與分帳」面板（PayerSplitSheet）
 * 是進階選項，用來設定多付款人（payers）跟自訂分帳對象／金額（splitAmong/splitAmounts）。
 * 沒開過那個面板就照單一付款人＋全員均分存檔，跟這個功能上線前的行為完全一樣。
 * 只有一位身份時完全不需要「誰付的」跟分帳，兩者都不顯示。
 */
export default function ExpenseSheet() {
  const rateStr = useStore((s) => s.entities.settings.rate ?? '0.216')
  const currencyName = useStore((s) => s.entities.settings.currencyName ?? '日幣')
  const currencySymbol = useStore((s) => s.entities.settings.currencySymbol ?? '¥')
  const cardLabel = useStore((s) => s.entities.settings.cardLabel ?? '信用卡')
  const defaultMethod = useStore((s) => s.entities.settings.defaultMethod ?? 'card')
  const defaultMoneyCat = useStore((s) => s.entities.settings.defaultMoneyCat)
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
  const singleMember = memberNames.length <= 1

  const editing = editingId != null ? expenses.find((e) => e.id === editingId) : undefined
  const isNew = !editing

  const [title, setTitle] = useState(editing?.title ?? '')
  const [spentOn, setSpentOn] = useState(editing?.spent_on ?? todayISO())
  const [cur, setCur] = useState<Currency>(editing?.cur ?? 'JPY')
  const [amt, setAmt] = useState(editing ? String(editing.amt) : '')
  const [cat, setCat] = useState(
    editing?.cat ?? (defaultMoneyCat && moneyCats.includes(defaultMoneyCat) ? defaultMoneyCat : moneyCats[0]),
  )
  const [payer, setPayer] = useState<Payer>(editing?.payer ?? currentRole ?? memberNames[0] ?? '')
  const [method, setMethod] = useState<PayMethod>(editing ? payMethod(editing) : 'cash')
  const [daigou, setDaigou] = useState(editing?.daigou ?? false)
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)
  const [methodMgrOpen, setMethodMgrOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // null＝還沒動過，套用「單一付款人／全員均分」的預設值；一旦開過付款與分帳面板就會
  // materialize 成實際陣列（見 openPayerPanel）。payers/splitAmounts 是輸入框的字串草稿，
  // 存檔時才 parseFloat。
  const [payerChecked, setPayerChecked] = useState<string[] | null>(editing?.payers ? Object.keys(editing.payers) : null)
  const [payers, setPayers] = useState<Record<string, string>>(numMap(editing?.payers))
  const [splitAmong, setSplitAmong] = useState<string[] | null>(editing?.splitAmong ? [...editing.splitAmong] : null)
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(numMap(editing?.splitAmounts))
  const [payerPanelOpen, setPayerPanelOpen] = useState(false)

  const rate = rateNum(rateStr)
  const amtNum = Number(amt)
  const validAmt = Number.isFinite(amtNum) && amtNum > 0
  const methodIsCustom = method !== 'cash' && method !== defaultMethod

  const close = () => closeAddExpense()

  const handleCreateCat = () => {
    const name = newCatName.trim()
    if (!name) return
    upsertCat({ kind: 'money', name })
    setCat(name)
    setNewCatName('')
    setShowNewCat(false)
  }

  const handlePayerChipChange = (p: Payer) => {
    setPayer(p)
    setPayerChecked(null)
    setPayers({})
    setSplitAmong(null)
  }

  const openPayerPanel = () => {
    setPayerChecked((cur) => cur ?? [payer])
    setSplitAmong((cur) => cur ?? [...memberNames])
    setPayerPanelOpen(true)
  }

  const togglePayerChecked = (name: string) => {
    setPayerChecked((cur) => {
      const list = cur ?? [payer]
      const next = list.includes(name) ? list.filter((r) => r !== name) : [...list, name]
      return next.length === 0 ? [name] : next
    })
    setPayers((p) => {
      const next = { ...p }
      delete next[name]
      return next
    })
  }

  const toggleSplitAmong = (name: string) => {
    setSplitAmong((cur) => {
      const list = cur ?? memberNames
      const next = list.includes(name) ? list.filter((r) => r !== name) : [...list, name]
      return next.length === 0 ? [name] : next
    })
    setSplitAmounts((p) => {
      const next = { ...p }
      delete next[name]
      return next
    })
  }

  const handleSave = () => {
    if (!title.trim() || !validAmt) return

    const checked = payerChecked ?? [payer]
    const editedPayerSum = checked.reduce((a, n) => a + (isEdited(payers[n]) ? parseFloat(payers[n]) || 0 : 0), 0)
    const uneditedPayers = checked.filter((n) => !isEdited(payers[n]))
    const payerPlaceholderEach = uneditedPayers.length ? (amtNum - editedPayerSum) / uneditedPayers.length : 0
    if (checked.length > 0 && uneditedPayers.length === 0 && Math.abs(editedPayerSum - amtNum) > checked.length) {
      showToast('付款金額總和需等於總金額才能儲存')
      return
    }
    const payerEntries = checked
      .map((n): [string, number] => [n, isEdited(payers[n]) ? parseFloat(payers[n]) || 0 : Math.round(payerPlaceholderEach)])
      .filter(([, v]) => v > 0)
    const payersFinal = payerEntries.length >= 2 ? Object.fromEntries(payerEntries) : undefined
    // 「誰付的」單選 chip 只是預設值；如果使用者在「付款與分帳」面板裡只勾選了一個人
    // （不管是不是跟 chip 選的同一個人），要以面板勾選的那個人為準，不能悄悄被丟掉——
    // 否則像「小美付了全額、勾選只留小美」這種操作，儲存後會退回 chip 原本選的人。
    const finalPayer = payerEntries.length === 1 ? payerEntries[0][0] : payer

    const among = splitAmong ?? memberNames
    const splitAmongFinal = among.length === memberNames.length ? undefined : [...among]

    const editedSplitSum = among.reduce((a, n) => a + (isEdited(splitAmounts[n]) ? parseFloat(splitAmounts[n]) || 0 : 0), 0)
    const uneditedSplit = among.filter((n) => !isEdited(splitAmounts[n]))
    const splitPlaceholderEach = uneditedSplit.length ? (amtNum - editedSplitSum) / uneditedSplit.length : 0
    if (among.length > 0 && uneditedSplit.length === 0 && Math.abs(editedSplitSum - amtNum) > among.length) {
      showToast('分帳金額總和需等於總金額才能儲存')
      return
    }
    const splitAmountsFinal =
      among.some((n) => isEdited(splitAmounts[n]))
        ? Object.fromEntries(
            among.map((n): [string, number] => [
              n,
              isEdited(splitAmounts[n]) ? parseFloat(splitAmounts[n]) || 0 : Math.round(splitPlaceholderEach),
            ]),
          )
        : undefined

    upsertExpense({
      id: editing?.id ?? genId(),
      title: title.trim(),
      cat,
      cur,
      amt: amtNum,
      payer: finalPayer,
      payers: payersFinal,
      splitAmong: splitAmongFinal,
      splitAmounts: splitAmountsFinal,
      method,
      daigou,
      spent_on: spentOn,
    })
    showToast(isNew ? `記一筆 · ${title.trim()}` : `已更新 · ${title.trim()}`)
    close()
  }

  // 不用 window.confirm——PWA 加到主畫面／某些內嵌瀏覽器環境下原生 confirm 對話框不會彈出
  // 或直接被判定取消，按下刪除會完全沒反應。改成畫面內的二次確認區塊，跟 SettingsSheet
  // 改旅遊日期的確認方式一致。
  const handleDelete = () => {
    if (!editing) return
    deleteExpense(editing.id)
    showToast('已刪除這筆支出')
    close()
  }

  const payerPanelActive = (payerChecked?.length ?? 1) > 1 || (splitAmong != null && splitAmong.length !== memberNames.length)

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
            title="代購金額不計入「不含代購」的統計，但一樣列入結算，明細會標記「代購」"
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
          <div className="field" style={{ flex: 6 }}>
            <label>項目</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 4, minWidth: 0 }}>
            <label>日期</label>
            <input className="input" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
          </div>
        </div>

        <div className="expense-field-row">
          <div className="field" style={{ flex: 4, minWidth: 0 }}>
            <label>幣別</label>
            <div className="expense-cur-chips">
              <button
                type="button"
                className={`expense-cur-chip${cur === 'JPY' ? ' is-selected' : ''}`}
                onClick={() => setCur('JPY')}
              >
                {currencyName} {currencySymbol}
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

          <div className="field" style={{ flex: 6, minWidth: 0 }}>
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
                    setMethod(defaultMethod)
                    setMethodMenuOpen(false)
                  }}
                >
                  <CreditCard size={15} weight="duotone" />
                  {truncateMethodLabel(methodLabel(methodIsCustom ? method : defaultMethod, cardLabel))}
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
                    <button
                      type="button"
                      className={`expense-method-menu-item${method === 'card' ? ' is-selected' : ''}`}
                      onClick={() => {
                        setMethod('card')
                        setMethodMenuOpen(false)
                      }}
                    >
                      {cardLabel}
                    </button>
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
                    <div className="expense-method-menu-divider" />
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
          <label>金額（{cur === 'JPY' ? currencyName : '台幣'}）</label>
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

        {!singleMember && (
          <div className="field">
            <label>誰付的</label>
            <div className="expense-cur-chips">
              {memberNames.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`expense-cur-chip${payer === p ? ' is-selected' : ''}`}
                  onClick={() => handlePayerChipChange(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="expense-save-row">
          <button
            type="button"
            className="btn btn-primary expense-save-btn"
            disabled={!title.trim() || !validAmt}
            onClick={handleSave}
          >
            {isNew ? '記一筆' : '儲存變更'}
          </button>
          {!singleMember && (
            <button
              type="button"
              className={`expense-payer-panel-btn${payerPanelActive ? ' is-active' : ''}`}
              title="設定多人付款金額與分帳對象"
              onClick={openPayerPanel}
            >
              <UsersThree size={20} weight={payerPanelActive ? 'fill' : 'duotone'} />
            </button>
          )}
          {!isNew && (
            <button
              type="button"
              className="btn btn-secondary edit-delete-btn expense-delete-btn"
              onClick={() => setConfirmDeleteOpen(true)}
              aria-label="刪除這筆支出"
            >
              <Trash size={20} weight="duotone" />
            </button>
          )}
        </div>
      </div>

      {confirmDeleteOpen && (
        <ConfirmDialog
          message={`確定要刪除「${title}」這筆支出？此動作無法復原。`}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      )}

      {payerPanelOpen && (
        <PayerSplitSheet
          amount={validAmt ? amtNum : 0}
          amountLabel={cur === 'JPY' ? formatJPY(amtNum, currencySymbol) : formatTWD(amtNum)}
          members={memberNames}
          payerChecked={payerChecked ?? [payer]}
          payers={payers}
          splitAmong={splitAmong ?? memberNames}
          splitAmounts={splitAmounts}
          onTogglePayer={togglePayerChecked}
          onPayerAmountChange={(name, value) =>
            setPayers((p) => {
              const next = { ...p }
              if (value === '') delete next[name]
              else next[name] = value
              return next
            })
          }
          onToggleSplit={toggleSplitAmong}
          onSplitAmountChange={(name, value) =>
            setSplitAmounts((p) => {
              const next = { ...p }
              if (value === '') delete next[name]
              else next[name] = value
              return next
            })
          }
          onClose={() => setPayerPanelOpen(false)}
        />
      )}

      {methodMgrOpen && <PaymentMethodManagerSheet onClose={() => setMethodMgrOpen(false)} />}

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
