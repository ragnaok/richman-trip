import { X } from '@phosphor-icons/react'

interface PayerSplitSheetProps {
  amount: number
  amountLabel: string
  members: string[]
  payerChecked: string[]
  payers: Record<string, string>
  splitAmong: string[]
  splitAmounts: Record<string, string>
  onTogglePayer: (name: string) => void
  onPayerAmountChange: (name: string, value: string) => void
  onToggleSplit: (name: string) => void
  onSplitAmountChange: (name: string, value: string) => void
  onClose: () => void
}

function isEdited(v: string | undefined): boolean {
  return v !== undefined && v !== ''
}

/**
 * 「誰付了多少」＋「分帳對象」的進階面板，疊在 ExpenseSheet 之上，同一個新增／編輯支出
 * 流程裡才會開。勾選但沒輸入金額的人，畫面上用 placeholder 顯示「總金額扣掉已輸入的人
 * 後平分剩下的人」，實際存檔時才把 placeholder 定案成數字（見 ExpenseSheet 的存檔邏輯）。
 * 這裡只負責畫面跟即時計算 placeholder／金額對不上的警示，草稿狀態（payers/splitAmong等）
 * 由 ExpenseSheet 持有，關閉面板不會遺失、重開仍看得到上次的編輯。
 */
export default function PayerSplitSheet({
  amount,
  amountLabel,
  members,
  payerChecked,
  payers,
  splitAmong,
  splitAmounts,
  onTogglePayer,
  onPayerAmountChange,
  onToggleSplit,
  onSplitAmountChange,
  onClose,
}: PayerSplitSheetProps) {
  const editedPayerSum = payerChecked.reduce((a, n) => a + (isEdited(payers[n]) ? parseFloat(payers[n]) || 0 : 0), 0)
  const uneditedPayers = payerChecked.filter((n) => !isEdited(payers[n]))
  const payerPlaceholderEach = uneditedPayers.length ? (amount - editedPayerSum) / uneditedPayers.length : 0
  // 容許誤差跟著人數放大：n 個數字各自四捨五入，總和最多可能偏離 n*0.5，用 n 當容許值
  // 保守但足夠寬鬆，才不會人一多、除不盡，就把「正常四捨五入」誤判成輸入錯誤擋下來。
  const payerImbalanced =
    payerChecked.length > 0 && uneditedPayers.length === 0 && Math.abs(editedPayerSum - amount) > payerChecked.length

  const editedSplitSum = splitAmong.reduce(
    (a, n) => a + (isEdited(splitAmounts[n]) ? parseFloat(splitAmounts[n]) || 0 : 0),
    0,
  )
  const uneditedSplit = splitAmong.filter((n) => !isEdited(splitAmounts[n]))
  const splitPlaceholderEach = uneditedSplit.length ? (amount - editedSplitSum) / uneditedSplit.length : 0
  const splitImbalanced =
    splitAmong.length > 0 && uneditedSplit.length === 0 && Math.abs(editedSplitSum - amount) > splitAmong.length

  return (
    <div
      className="edit-overlay payer-split-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="edit-sheet payer-split-sheet">
        <div className="edit-header">
          <h3 className="edit-title" style={{ fontSize: 20 }}>
            付款與分帳
          </h3>
          <button type="button" className="btn btn-ghost edit-close-btn" onClick={onClose} aria-label="關閉">
            <X size={16} weight="duotone" />
          </button>
        </div>
        <p className="payer-split-total">總金額 {amountLabel}</p>

        <div className="edit-kind-block">
          <div className="edit-section-label">誰付了多少（勾選加入，未輸入金額自動平分剩餘）</div>
          <div className="payer-split-rows">
            {members.map((p) => {
              const checked = payerChecked.includes(p)
              const edited = isEdited(payers[p])
              return (
                <div key={p} className="payer-split-row">
                  <button
                    type="button"
                    className={`payer-split-check${checked ? ' is-checked' : ''}`}
                    onClick={() => onTogglePayer(p)}
                  >
                    <span className="payer-split-checkbox">{checked ? '✓' : ''}</span>
                    {p}
                  </button>
                  <input
                    className="input payer-split-amt"
                    inputMode="decimal"
                    value={edited ? payers[p] : ''}
                    disabled={!checked}
                    placeholder={checked && !edited ? String(Math.round(payerPlaceholderEach)) : ''}
                    onChange={(e) => onPayerAmountChange(p, e.target.value)}
                  />
                </div>
              )
            })}
          </div>
          {payerImbalanced && <p className="payer-split-warning">付款金額總和需等於總金額才能完成</p>}
        </div>

        <div className="edit-kind-block">
          <div className="edit-section-label">分帳對象（平分這筆金額的人；未輸入金額自動平分剩餘）</div>
          <div className="payer-split-rows">
            {members.map((p) => {
              const checked = splitAmong.includes(p)
              const edited = isEdited(splitAmounts[p])
              return (
                <div key={p} className="payer-split-row">
                  <button
                    type="button"
                    className={`payer-split-check${checked ? ' is-checked' : ''}`}
                    onClick={() => onToggleSplit(p)}
                  >
                    <span className="payer-split-checkbox">{checked ? '✓' : ''}</span>
                    {p}
                  </button>
                  <input
                    className="input payer-split-amt"
                    inputMode="decimal"
                    value={edited ? splitAmounts[p] : ''}
                    disabled={!checked}
                    placeholder={checked && !edited ? String(Math.round(splitPlaceholderEach)) : ''}
                    onChange={(e) => onSplitAmountChange(p, e.target.value)}
                  />
                </div>
              )
            })}
          </div>
          {splitImbalanced && <p className="payer-split-warning">分帳金額總和需等於總金額才能完成</p>}
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={payerImbalanced || splitImbalanced}
          onClick={onClose}
        >
          完成
        </button>
      </div>
    </div>
  )
}
