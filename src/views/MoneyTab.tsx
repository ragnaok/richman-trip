import { useMemo, useState } from 'react'
import { SlidersHorizontal, PencilSimple, CheckSquare, Square } from '@phosphor-icons/react'
import { useStore, useMemberNames } from '../lib/store'
import { CAT_ICON, CAT_COLOR } from '../data/spots'
import { phosphorIcon } from '../lib/icons'
import { rateNum, twd, formatTWD, formatJPY, payMethod, PAY_METHOD_LABEL } from '../lib/money'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { pull as syncPull, push as syncPush } from '../lib/sync'
import PullToRefresh from '../components/PullToRefresh'
import Toast, { useToast } from '../components/Toast'

const ALL_FILTER = '全部'

/**
 * 記帳分頁。金額一律走 lib/money.ts 的 twd() 以台幣為基準，不做「誰欠誰」結算。
 * 區塊順序：總額 → 各人已付卡 → 新增支出按鈕 → 分類統計 → 明細；新增支出刻意放在
 * 上面，不用每次捲到頁尾。
 */
export default function MoneyTab() {
  const expenses = useStore((s) => s.entities.expenses)
  const rateStr = useStore((s) => s.entities.settings.rate ?? '0.216')
  const memberNames = useMemberNames()
  const openAddExpense = useStore((s) => s.openAddExpense)
  const openEditExpense = useStore((s) => s.openEditExpense)
  const openCatMgr = useStore((s) => s.openCatMgr)

  const [expFilter, setExpFilter] = useState<string>(ALL_FILTER)
  const [showDaigou, setShowDaigou] = useState(false)

  const { toast, showToast } = useToast()
  const { containerRef, pull, status } = usePullToRefresh({
    onRefresh: () => syncPull().then(() => syncPush()),
    onDone: () => showToast('已更新'),
  })

  const rate = rateNum(rateStr)
  const items = useMemo(
    () => expenses.filter((e) => e.deleted !== 1).slice().sort((a, b) => b.updated_at - a.updated_at),
    [expenses],
  )

  // 含代購開關只影響金額／分類統計（含「誰已付」卡片），下方明細一律照常顯示全部，
  // 靠 items（未依代購過濾）算 expTabs/filteredItems。
  const effItems = useMemo(() => (showDaigou ? items : items.filter((e) => !e.daigou)), [items, showDaigou])

  const jpyTotal = effItems.filter((e) => e.cur === 'JPY').reduce((sum, e) => sum + e.amt, 0)
  const jpyCashTotal = effItems
    .filter((e) => e.cur === 'JPY' && payMethod(e) === 'cash')
    .reduce((sum, e) => sum + e.amt, 0)
  const twdDirectTotal = effItems.filter((e) => e.cur === 'TWD').reduce((sum, e) => sum + e.amt, 0)
  const grandTotal = effItems.reduce((sum, e) => sum + twd(e, rate), 0)

  const byPayer = (payer: string) => effItems.filter((e) => e.payer === payer)
  const payerTotal = (payer: string) => byPayer(payer).reduce((sum, e) => sum + twd(e, rate), 0)
  const payerJpySum = (payer: string) =>
    byPayer(payer)
      .filter((e) => e.cur === 'JPY')
      .reduce((sum, e) => sum + e.amt, 0)
  const payerJpyCashSum = (payer: string) =>
    byPayer(payer)
      .filter((e) => e.cur === 'JPY' && payMethod(e) === 'cash')
      .reduce((sum, e) => sum + e.amt, 0)

  // 分類統計：每個分類的長條依付款方式拆成現金／信用卡兩段，沿用該分類的 CAT_COLOR，
  // 現金段混 40% 白做區隔（跟圖例一致）。
  const catTotals = useMemo(() => {
    const totals = new Map<string, { sum: number; cash: number }>()
    for (const e of effItems) {
      const entry = totals.get(e.cat) ?? { sum: 0, cash: 0 }
      const amt = twd(e, rate)
      entry.sum += amt
      if (payMethod(e) === 'cash') entry.cash += amt
      totals.set(e.cat, entry)
    }
    return [...totals.entries()]
      .filter(([, v]) => v.sum > 0)
      .sort((a, b) => b[1].sum - a[1].sum)
  }, [effItems, rate])

  // 明細分類頁籤：「全部」+ 只列出有支出的分類（各帶筆數），只影響明細列表。
  const expTabs = useMemo(() => {
    const cats = [...new Set(items.map((e) => e.cat))]
    return [ALL_FILTER, ...cats].map((cat) => ({
      cat,
      count: cat === ALL_FILTER ? items.length : items.filter((e) => e.cat === cat).length,
    }))
  }, [items])

  const filteredItems = expFilter === ALL_FILTER ? items : items.filter((e) => e.cat === expFilter)
  const expEmpty = expFilter !== ALL_FILTER && filteredItems.length === 0

  return (
    <div className="money" ref={containerRef}>
      <PullToRefresh status={status} pull={pull} />

      <div className="money-header-row">
        <h2 className="spots-h2">記帳</h2>
        <button
          type="button"
          className={`daigou-toggle-btn${showDaigou ? ' is-active' : ''}`}
          title="開啟後，金額與分類統計會把代購金額算進來"
          onClick={() => setShowDaigou(!showDaigou)}
        >
          {showDaigou ? <CheckSquare size={14} weight="duotone" /> : <Square size={14} weight="duotone" />}
          含代購
        </button>
      </div>

      <div className="money-total-row">
        <div className="money-total-body">
          <div className="money-total-kicker">
            {showDaigou ? '含代購' : '不含代購'}總支出（台幣計，匯率 {rateStr}）
          </div>
          <div className="money-total-amount">{formatTWD(grandTotal)}</div>

          {/* 雙幣對照：兩欄＋中間分隔線，不是單行文字。 */}
          <div className="money-dual-currency">
            <div className="money-dual-col">
              <div className="money-dual-label">日本現地</div>
              <div className="money-dual-value">{formatJPY(jpyTotal)}</div>
            </div>
            <div className="money-dual-divider" />
            <div className="money-dual-col">
              <div className="money-dual-label">其中現金</div>
              <div className="money-dual-value">{formatJPY(jpyCashTotal)}</div>
            </div>
            <div className="money-dual-divider" />
            <div className="money-dual-col">
              <div className="money-dual-label">行前台幣</div>
              <div className="money-dual-value">{formatTWD(twdDirectTotal)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="money-payer-row">
        {memberNames.map((payer, i) => {
          const jpySum = payerJpySum(payer)
          const jpyCashSum = payerJpyCashSum(payer)
          const isLastOdd = memberNames.length % 2 === 1 && i === memberNames.length - 1
          return (
            <div key={payer} className={`money-payer-card${isLastOdd ? ' money-payer-card--full' : ''}`}>
              <div className="money-payer-name">{payer} 已付</div>
              <div className="money-payer-amount">{formatTWD(payerTotal(payer))}</div>
              <div className="money-payer-sub">{jpySum > 0 ? `含日幣 ¥${jpySum.toLocaleString('zh-Hant')}` : '全為台幣支付'}</div>
              <div className="money-payer-sub">含日幣現金 ¥{jpyCashSum.toLocaleString('zh-Hant')}</div>
            </div>
          )
        })}
      </div>

      <button type="button" className="btn btn-primary btn-block money-add-btn" onClick={openAddExpense}>
        ＋ 新增支出
      </button>

      <div className="money-cats">
        <div className="money-cats-header">
          <div className="money-section-kicker">分類統計（台幣）</div>
          <button type="button" className="btn btn-ghost" onClick={() => openCatMgr('money')}>
            <SlidersHorizontal size={13} weight="duotone" /> 管理分類
          </button>
        </div>
        <div className="money-cat-legend">
          <span className="money-cat-legend-item">
            <span className="money-cat-legend-swatch" style={{ background: 'var(--color-neutral-800)' }} />
            信用卡
          </span>
          <span className="money-cat-legend-item">
            <span
              className="money-cat-legend-swatch"
              style={{ background: 'color-mix(in srgb, var(--color-neutral-800) 40%, white)' }}
            />
            現金
          </span>
        </div>
        {catTotals.map(([cat, { sum, cash }]) => {
          const pct = grandTotal > 0 ? (sum / grandTotal) * 100 : 0
          const cardPct = grandTotal > 0 ? ((sum - cash) / grandTotal) * 100 : 0
          const cashPct = grandTotal > 0 ? (cash / grandTotal) * 100 : 0
          const color = CAT_COLOR[cat] ?? 'var(--color-text)'
          return (
            <div key={cat} className="money-cat-row">
              <div className="money-cat-top">
                <span className="money-cat-name">{cat}</span>
                <span className="money-cat-amount">{formatTWD(sum)}</span>
                <span className="money-cat-pct">{pct.toFixed(0)}%</span>
              </div>
              <div className="money-cat-bar">
                <div className="money-cat-bar-value" style={{ width: `${cardPct}%`, background: color }} />
                <div
                  className="money-cat-bar-value"
                  style={{ width: `${cashPct}%`, background: `color-mix(in srgb, ${color} 40%, white)` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="money-detail-section">
        <div className="money-section-kicker">明細</div>

        <div className="money-exp-tabs">
          {expTabs.map(({ cat, count }) => (
            <button
              key={cat}
              type="button"
              className={`money-exp-tab${expFilter === cat ? ' is-selected' : ''}`}
              onClick={() => setExpFilter(cat)}
            >
              {cat}
              <span className="money-exp-tab-count">{count}</span>
            </button>
          ))}
        </div>

        {expEmpty ? (
          <p className="money-empty">這個分類還沒有支出</p>
        ) : (
          <div className="money-list">
            {filteredItems.map((e) => {
              const Icon = phosphorIcon(CAT_ICON[e.cat] ?? 'ph-receipt')
              return (
                <button
                  key={e.id}
                  type="button"
                  className="money-item-row"
                  onClick={() => openEditExpense(e.id)}
                >
                  {Icon && <Icon size={19} weight="duotone" color="var(--color-accent-700)" />}
                  <div className="money-item-body">
                    <div className="money-item-title-row">
                      <div className="money-item-title">{e.title}</div>
                      {e.daigou && <span className="tag tag-accent-2 money-item-daigou-tag">代購</span>}
                    </div>
                    <div className="money-item-meta">
                      {e.cat} · {e.payer} 付 · {PAY_METHOD_LABEL[payMethod(e)]}
                    </div>
                  </div>
                  <div className="money-item-amounts">
                    <div className="money-item-amount">{e.cur === 'JPY' ? formatJPY(e.amt) : formatTWD(e.amt)}</div>
                    <div className="money-item-converted">
                      {e.cur === 'JPY' ? `≈ ${formatTWD(e.amt * rate)}` : '台幣直付'}
                    </div>
                  </div>
                  <PencilSimple size={15} weight="duotone" className="money-item-edit-icon" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
