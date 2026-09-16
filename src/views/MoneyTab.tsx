import { useMemo, useState } from 'react'
import {
  SlidersHorizontal,
  PencilSimple,
  Funnel,
  CaretDown,
  CaretUp,
  Scales,
  X,
  MagnifyingGlass,
} from '@phosphor-icons/react'
import { useStore, useMemberNames } from '../lib/store'
import { CAT_ICON } from '../data/spots'
import { phosphorIcon } from '../lib/icons'
import {
  rateNum,
  twd,
  formatTWD,
  formatJPY,
  payMethod,
  payersOf,
  methodLabel,
  methodOrder,
  methodColor,
  settle,
} from '../lib/money'
import { formatExpenseDate } from '../lib/time'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { pull as syncPull, push as syncPush } from '../lib/sync'
import PullToRefresh from '../components/PullToRefresh'
import Toast, { useToast } from '../components/Toast'

const ALL_FILTER = '全部'
type DaigouFilter = '不含代購' | '含代購' | '只看代購'

/**
 * 記帳分頁。金額一律走 lib/money.ts 的 twd() 以台幣為基準。
 * 區塊順序：總覽卡（總額＋雙幣對照＋各人已付，單一身份時不顯示已付）→ 新增支出按鈕 →
 * 洞察區（每日花費／分類統計合併成一個可切換的圖表）→ 明細（搜尋＋可清除的分類篩選標籤）。
 *
 * 篩選（付款方式／日期／身份／代購）統一收在右上角「篩選」bottom sheet，跟明細搜尋框、
 * 分類篩選標籤是分開的兩件事：篩選 sheet 的條件會整頁套用（總額／已付／圖表／明細都跟著
 * 篩），分類標籤跟搜尋只影響明細列表本身。
 *
 * 結算依 splitAmong 計算（見 lib/money.ts settle()），代購一律不列入；只有一位身份時
 * 完全不顯示已付卡／結算按鈕——這兩者只有多人才有意義。
 */
export default function MoneyTab() {
  const expenses = useStore((s) => s.entities.expenses)
  const rateStr = useStore((s) => s.entities.settings.rate ?? '0.216')
  const currencyName = useStore((s) => s.entities.settings.currencyName ?? '日幣')
  const currencySymbol = useStore((s) => s.entities.settings.currencySymbol ?? '¥')
  const cardLabel = useStore((s) => s.entities.settings.cardLabel ?? '信用卡')
  const memberNames = useMemberNames()
  const openAddExpense = useStore((s) => s.openAddExpense)
  const openEditExpense = useStore((s) => s.openEditExpense)
  const openCatMgr = useStore((s) => s.openCatMgr)
  const singleMember = memberNames.length <= 1

  const [expFilter, setExpFilter] = useState<string>(ALL_FILTER) // 明細分類篩選標籤
  const [expSearch, setExpSearch] = useState('')
  const [expDate, setExpDate] = useState<string>(ALL_FILTER)
  const [expMethod, setExpMethod] = useState<string>(ALL_FILTER)
  const [expPayer, setExpPayer] = useState<string>(ALL_FILTER)
  const [daigouFilter, setDaigouFilter] = useState<DaigouFilter>('不含代購')
  const [chartMode, setChartMode] = useState<'day' | 'cat'>('day')
  const [dailyExpanded, setDailyExpanded] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)

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

  // 篩選鏈：代購 → 付款方式 → 身份（決定 dayBase，每日花費維持全部日期可點）→ 日期
  // （決定 effItems，總額／已付卡／分類統計都吃這層）。
  const daigouFiltered = useMemo(
    () =>
      daigouFilter === '含代購'
        ? items
        : daigouFilter === '只看代購'
          ? items.filter((e) => e.daigou)
          : items.filter((e) => !e.daigou),
    [items, daigouFilter],
  )
  const dayBase = useMemo(() => {
    const byMethod = expMethod === ALL_FILTER ? daigouFiltered : daigouFiltered.filter((e) => payMethod(e) === expMethod)
    return expPayer === ALL_FILTER ? byMethod : byMethod.filter((e) => e.payer === expPayer)
  }, [daigouFiltered, expMethod, expPayer])
  const effItems = useMemo(
    () => (expDate === ALL_FILTER ? dayBase : dayBase.filter((e) => e.spent_on === expDate)),
    [dayBase, expDate],
  )

  const jpyTotal = effItems.filter((e) => e.cur === 'JPY').reduce((sum, e) => sum + e.amt, 0)
  const jpyCashTotal = effItems
    .filter((e) => e.cur === 'JPY' && payMethod(e) === 'cash')
    .reduce((sum, e) => sum + e.amt, 0)
  const twdDirectTotal = effItems.filter((e) => e.cur === 'TWD').reduce((sum, e) => sum + e.amt, 0)
  const grandTotal = effItems.reduce((sum, e) => sum + twd(e, rate), 0)

  const paidTwdOf = (person: string) => effItems.reduce((sum, e) => sum + (twd({ cur: e.cur, amt: payersOf(e)[person] ?? 0 }, rate)), 0)
  const paidJpyOf = (person: string) =>
    effItems.filter((e) => e.cur === 'JPY').reduce((sum, e) => sum + (payersOf(e)[person] ?? 0), 0)
  const paidJpyCashOf = (person: string) =>
    effItems
      .filter((e) => e.cur === 'JPY' && payMethod(e) === 'cash')
      .reduce((sum, e) => sum + (payersOf(e)[person] ?? 0), 0)

  // 圖表（每日花費／分類統計）共用的付款方式順序：現金、信用卡固定在前，其餘自訂
  // 方式接在後面，順序基於全部未刪除支出（不受篩選影響），篩選時顏色才不會跳動。
  const methods = useMemo(() => methodOrder(items.map(payMethod)), [items])

  const catTotals = useMemo(() => {
    const totals = new Map<string, { sum: number; byMethod: Record<string, number> }>()
    for (const e of effItems) {
      const entry = totals.get(e.cat) ?? { sum: 0, byMethod: {} }
      const amt = twd(e, rate)
      entry.sum += amt
      const m = payMethod(e)
      entry.byMethod[m] = (entry.byMethod[m] ?? 0) + amt
      totals.set(e.cat, entry)
    }
    return [...totals.entries()]
      .filter(([, v]) => v.sum > 0)
      .sort((a, b) => b[1].sum - a[1].sum)
  }, [effItems, rate])

  const dailyTotals = useMemo(() => {
    const totals = new Map<string, { sum: number; byMethod: Record<string, number> }>()
    for (const e of dayBase) {
      if (!e.spent_on) continue
      const entry = totals.get(e.spent_on) ?? { sum: 0, byMethod: {} }
      const amt = twd(e, rate)
      entry.sum += amt
      const m = payMethod(e)
      entry.byMethod[m] = (entry.byMethod[m] ?? 0) + amt
      totals.set(e.spent_on, entry)
    }
    return [...totals.entries()]
      .filter(([, v]) => v.sum > 0)
      .sort((a, b) => b[0].localeCompare(a[0]))
  }, [dayBase, rate])
  const dailyGrandTotal = dailyTotals.reduce((sum, [, v]) => sum + v.sum, 0)
  const visibleDailyTotals = dailyExpanded ? dailyTotals : dailyTotals.slice(0, 2)

  const tabScope = useMemo(
    () => effItems.filter((e) => !expSearch || e.title.toLowerCase().includes(expSearch.toLowerCase())),
    [effItems, expSearch],
  )
  const filteredItems = tabScope.filter((e) => expFilter === ALL_FILTER || e.cat === expFilter)
  const expEmpty = filteredItems.length === 0

  const toggleExpDate = (day: string) => setExpDate((cur) => (cur === day ? ALL_FILTER : day))
  const toggleExpFilter = (c: string) => setExpFilter((cur) => (cur === c ? ALL_FILTER : c))

  const activeFilterCount =
    (expMethod !== ALL_FILTER ? 1 : 0) +
    (daigouFilter !== '不含代購' ? 1 : 0) +
    (expDate !== ALL_FILTER ? 1 : 0) +
    (expPayer !== ALL_FILTER ? 1 : 0)
  const clearFilters = () => {
    setExpMethod(ALL_FILTER)
    setDaigouFilter('不含代購')
    setExpDate(ALL_FILTER)
    setExpPayer(ALL_FILTER)
  }

  const settleLines = useMemo(() => settle(items, memberNames, rate), [items, memberNames, rate])

  const renderMethodLegend = () => (
    <div className="money-cat-legend">
      {methods.map((m, i) => {
        const isSelected = expMethod === m
        return (
          <button
            key={m}
            type="button"
            className={`money-cat-legend-item${isSelected ? ' is-selected' : ''}`}
            style={{ opacity: expMethod === ALL_FILTER || isSelected ? 1 : 0.4 }}
            onClick={() => setExpMethod((cur) => (cur === m ? ALL_FILTER : m))}
          >
            <span className="money-cat-legend-swatch" style={{ background: methodColor(i) }} />
            {methodLabel(m, cardLabel)}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="money" ref={containerRef}>
      <PullToRefresh status={status} pull={pull} />

      <div className="money-header-row">
        <h2 className="spots-h2">記帳</h2>
        <div className="money-header-actions">
          {!singleMember && (
            <div className="money-settle-wrap">
              <button type="button" className="money-header-btn" onClick={() => setSettleOpen(!settleOpen)}>
                <Scales size={14} weight="duotone" />
                結算
              </button>
              {settleOpen && (
                <>
                  <div className="money-filter-hint-backdrop" onClick={() => setSettleOpen(false)} />
                  <div className="money-settle-popover">
                    {settleLines.length === 0 ? (
                      <div>目前已平衡，不需轉帳</div>
                    ) : (
                      settleLines.map((l) => (
                        <div key={`${l.from}-${l.to}`}>
                          {l.from} 應轉給 {l.to} {formatTWD(l.amount)}
                        </div>
                      ))
                    )}
                    <div className="money-settle-note">僅計入勾選分帳的項目</div>
                  </div>
                </>
              )}
            </div>
          )}
          <button type="button" className="money-header-btn" onClick={() => setFilterOpen(true)}>
            <Funnel size={14} weight="duotone" />
            篩選
            {activeFilterCount > 0 && <span className="money-filter-badge">{activeFilterCount}</span>}
          </button>
        </div>
      </div>

      <div className="money-total-row">
        <div className="money-total-body">
          <div className="money-total-kicker">總支出（台幣計，匯率 {rateStr}）</div>
          <div className="money-total-amount">{formatTWD(grandTotal)}</div>

          <div className="money-dual-currency">
            <div className="money-dual-col">
              <div className="money-dual-label">{currencyName}總計</div>
              <div className="money-dual-value">{formatJPY(jpyTotal, currencySymbol)}</div>
            </div>
            <div className="money-dual-divider" />
            <div className="money-dual-col">
              <div className="money-dual-label">{currencyName}現金</div>
              <div className="money-dual-value">{formatJPY(jpyCashTotal, currencySymbol)}</div>
            </div>
            <div className="money-dual-divider" />
            <div className="money-dual-col">
              <div className="money-dual-label">台幣總計</div>
              <div className="money-dual-value">{formatTWD(twdDirectTotal)}</div>
            </div>
          </div>

          {!singleMember && (
            <div className="money-payer-row">
              {memberNames.map((payer, i) => {
                const jpySum = paidJpyOf(payer)
                const jpyCashSum = paidJpyCashOf(payer)
                const isLastOdd = memberNames.length % 2 === 1 && i === memberNames.length - 1
                return (
                  <div key={payer} className={`money-payer-card${isLastOdd ? ' money-payer-card--full' : ''}`}>
                    <div className="money-payer-name">{payer} 已付</div>
                    <div className="money-payer-amount">{formatTWD(paidTwdOf(payer))}</div>
                    <div className="money-payer-sub">
                      {jpySum > 0 ? `含${currencyName} ${currencySymbol}${jpySum.toLocaleString('zh-Hant')}` : '全為台幣支付'}
                    </div>
                    <div className="money-payer-sub">
                      含{currencyName}現金 {currencySymbol}
                      {jpyCashSum.toLocaleString('zh-Hant')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-block money-add-btn" onClick={openAddExpense}>
        ＋ 新增支出
      </button>

      <div className="money-cats">
        <div className="money-cats-header">
          <div className="money-chart-toggle">
            <button
              type="button"
              className={`money-chart-toggle-btn${chartMode === 'day' ? ' is-selected' : ''}`}
              onClick={() => setChartMode('day')}
            >
              依日期
            </button>
            <button
              type="button"
              className={`money-chart-toggle-btn${chartMode === 'cat' ? ' is-selected' : ''}`}
              onClick={() => setChartMode('cat')}
            >
              依分類
            </button>
          </div>
          {renderMethodLegend()}
        </div>
        <p className="money-chart-hint">點一項可篩選下方明細；再點一次取消篩選。</p>

        {chartMode === 'day' &&
          visibleDailyTotals.map(([day, { sum, byMethod }]) => {
            const pct = dailyGrandTotal > 0 ? (sum / dailyGrandTotal) * 100 : 0
            const isSelected = expDate === day
            const isOtherSelected = expDate !== ALL_FILTER && !isSelected
            const dimOpacity = isSelected ? 1 : isOtherSelected ? 0.4 : 0.85
            return (
              <button
                key={day}
                type="button"
                className="money-cat-row money-daily-row"
                style={{ filter: isOtherSelected ? 'grayscale(1)' : 'none' }}
                onClick={() => toggleExpDate(day)}
              >
                <span className="money-cat-name" style={{ fontWeight: isSelected ? 600 : 400, opacity: dimOpacity }}>
                  {formatExpenseDate(day)}
                </span>
                <span className="money-cat-bar" style={{ opacity: dimOpacity }}>
                  <span className="money-cat-bar-fill" style={{ width: `${pct}%` }}>
                    {methods.map((m, i) => (
                      <span
                        key={m}
                        className="money-cat-bar-value"
                        style={{ width: `${sum > 0 ? ((byMethod[m] ?? 0) / sum) * 100 : 0}%`, background: methodColor(i) }}
                      />
                    ))}
                  </span>
                </span>
                <span className="money-cat-amount">{formatTWD(sum)}</span>
                <span className="money-cat-pct">{pct.toFixed(0)}%</span>
              </button>
            )
          })}
        {chartMode === 'day' && dailyTotals.length > 2 && (
          <button type="button" className="money-daily-toggle" onClick={() => setDailyExpanded(!dailyExpanded)}>
            {dailyExpanded ? '顯示更少' : '顯示更多'}
            {dailyExpanded ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
          </button>
        )}

        {chartMode === 'cat' &&
          catTotals.map(([cat, { sum, byMethod }]) => {
            const pct = grandTotal > 0 ? (sum / grandTotal) * 100 : 0
            const isSelected = expFilter === cat
            const isOtherSelected = expFilter !== ALL_FILTER && !isSelected
            const dimOpacity = isSelected ? 1 : isOtherSelected ? 0.55 : 1
            return (
              <button
                key={cat}
                type="button"
                className="money-cat-row money-daily-row"
                onClick={() => toggleExpFilter(cat)}
              >
                <span className="money-cat-name" style={{ fontWeight: isSelected ? 600 : 400, opacity: dimOpacity }}>
                  {cat}
                </span>
                <span className="money-cat-bar" style={{ opacity: dimOpacity }}>
                  <span className="money-cat-bar-fill" style={{ width: `${pct}%` }}>
                    {methods.map((m, i) => (
                      <span
                        key={m}
                        className="money-cat-bar-value"
                        style={{ width: `${sum > 0 ? ((byMethod[m] ?? 0) / sum) * 100 : 0}%`, background: methodColor(i) }}
                      />
                    ))}
                  </span>
                </span>
                <span className="money-cat-amount">{formatTWD(sum)}</span>
                <span className="money-cat-pct">{pct.toFixed(0)}%</span>
              </button>
            )
          })}
      </div>

      <div className="money-detail-section">
        <div className="money-cats-header">
          <div className="money-section-kicker">明細</div>
          <button type="button" className="btn btn-ghost" onClick={() => openCatMgr('money')}>
            <SlidersHorizontal size={13} weight="duotone" /> 管理分類
          </button>
        </div>

        <div className="money-search-row">
          <MagnifyingGlass size={14} weight="duotone" className="money-search-icon" />
          <input
            className="input money-search-input"
            value={expSearch}
            onChange={(e) => setExpSearch(e.target.value)}
            placeholder="搜尋明細項目"
          />
        </div>
        {expFilter !== ALL_FILTER && (
          <button type="button" className="tag tag-accent money-cat-filter-tag" onClick={() => setExpFilter(ALL_FILTER)}>
            篩選分類：{expFilter}
            <X size={11} weight="duotone" />
          </button>
        )}

        {expEmpty ? (
          <p className="money-empty">這個分類還沒有支出</p>
        ) : (
          <div className="money-list">
            {filteredItems.map((e) => {
              const Icon = phosphorIcon(CAT_ICON[e.cat] ?? 'ph-receipt')
              const isMulti = !!e.payers
              return (
                <button key={e.id} type="button" className="money-item-row" onClick={() => openEditExpense(e.id)}>
                  <div className="money-item-row-main">
                    {Icon && <Icon size={19} weight="duotone" color="var(--color-accent-700)" />}
                    <div className="money-item-body">
                      <div className="money-item-title-row">
                        <div className="money-item-title">{e.title}</div>
                        {e.daigou && <span className="tag tag-accent-2 money-item-daigou-tag">代購</span>}
                      </div>
                      <div className="money-item-meta">
                        {e.spent_on ? `${formatExpenseDate(e.spent_on)} · ` : ''}
                        {e.cat}
                        {!singleMember && !isMulti ? ` · ${e.payer} 付` : ''} · {methodLabel(payMethod(e), cardLabel)}
                      </div>
                    </div>
                    <div className="money-item-amounts">
                      <div className="money-item-amount">{e.cur === 'JPY' ? formatJPY(e.amt, currencySymbol) : formatTWD(e.amt)}</div>
                      <div className="money-item-converted">
                        {e.cur === 'JPY' ? `≈ ${formatTWD(e.amt * rate)}` : '台幣直付'}
                      </div>
                    </div>
                    <PencilSimple size={15} weight="duotone" className="money-item-edit-icon" />
                  </div>
                  {!singleMember && isMulti && (
                    <div className="money-item-payers">
                      {Object.entries(payersOf(e)).map(([name, amt]) => (
                        <div key={name} className="money-item-payer">
                          <span className="money-item-payer-name">{name}</span>
                          <span className="money-item-payer-amt">
                            {e.cur === 'JPY' ? formatJPY(amt, currencySymbol) : formatTWD(amt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {filterOpen && (
        <div className="edit-overlay" onClick={(e) => e.target === e.currentTarget && setFilterOpen(false)}>
          <div className="edit-sheet">
            <div className="edit-header">
              <h3 className="edit-title">篩選明細</h3>
              <button type="button" className="btn btn-ghost edit-close-btn" onClick={() => setFilterOpen(false)} aria-label="關閉">
                <X size={16} weight="duotone" />
              </button>
            </div>

            <div className="edit-kind-block">
              <div className="edit-section-label">付款方式</div>
              <div className="edit-kind-chips">
                {[ALL_FILTER, ...methods].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`edit-kind-chip${expMethod === m ? ' is-selected' : ''}`}
                    onClick={() => setExpMethod(m)}
                  >
                    {m === ALL_FILTER ? ALL_FILTER : methodLabel(m, cardLabel)}
                  </button>
                ))}
              </div>
            </div>

            <div className="edit-kind-block">
              <div className="edit-section-label">日期</div>
              <select className="input" style={{ marginTop: 6 }} value={expDate} onChange={(e) => setExpDate(e.target.value)}>
                {[ALL_FILTER, ...Array.from(new Set(items.map((e) => e.spent_on).filter((d): d is string => !!d))).sort().reverse()].map(
                  (d) => (
                    <option key={d} value={d}>
                      {d === ALL_FILTER ? ALL_FILTER : formatExpenseDate(d)}
                    </option>
                  ),
                )}
              </select>
            </div>

            {!singleMember && (
              <div className="edit-kind-block">
                <div className="edit-section-label">身份</div>
                <div className="edit-kind-chips">
                  {[ALL_FILTER, ...memberNames].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`edit-kind-chip${expPayer === v ? ' is-selected' : ''}`}
                      onClick={() => setExpPayer(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="edit-kind-block">
              <div className="edit-section-label">代購</div>
              <div className="edit-kind-chips">
                {(['不含代購', '含代購', '只看代購'] as DaigouFilter[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`edit-kind-chip${daigouFilter === v ? ' is-selected' : ''}`}
                    onClick={() => setDaigouFilter(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="expense-save-row">
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={clearFilters}>
                清除篩選
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setFilterOpen(false)}>
                套用
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
