import { useMemo, useState } from 'react'
import { SlidersHorizontal, PencilSimple, CheckSquare, Square, Funnel, CaretDown, CaretUp } from '@phosphor-icons/react'
import { useStore, useMemberNames } from '../lib/store'
import { CAT_ICON } from '../data/spots'
import { phosphorIcon } from '../lib/icons'
import { rateNum, twd, formatTWD, formatJPY, payMethod, methodLabel, methodOrder, methodColor } from '../lib/money'
import { formatExpenseDate } from '../lib/time'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { pull as syncPull, push as syncPush } from '../lib/sync'
import PullToRefresh from '../components/PullToRefresh'
import Toast, { useToast } from '../components/Toast'

const ALL_FILTER = '全部'

/**
 * 記帳分頁。金額一律走 lib/money.ts 的 twd() 以台幣為基準，不做「誰欠誰」結算。
 * 區塊順序：總額 → 各人已付卡 → 新增支出按鈕 → 每日花費 → 分類統計 → 明細；新增支出
 * 刻意放在上面，不用每次捲到頁尾。
 *
 * expDate（點每日花費某一天）、expMethod（點付款方式圖例）都跟 showDaigou 一樣
 * 會影響 effItems，進而讓總額／雙幣對照／已付卡／分類統計整頁一起篩選（點一下套用，
 * 再點同一個取消）；expFilter（明細分類頁籤）只影響明細列表。這幾個篩選彼此是
 * AND 條件，可以疊加（例如篩某一天＋某種付款方式）。
 */
export default function MoneyTab() {
  const expenses = useStore((s) => s.entities.expenses)
  const rateStr = useStore((s) => s.entities.settings.rate ?? '0.216')
  const memberNames = useMemberNames()
  const openAddExpense = useStore((s) => s.openAddExpense)
  const openEditExpense = useStore((s) => s.openEditExpense)
  const openCatMgr = useStore((s) => s.openCatMgr)

  const [expFilter, setExpFilter] = useState<string>(ALL_FILTER)
  const [expDate, setExpDate] = useState<string>(ALL_FILTER)
  const [expMethod, setExpMethod] = useState<string>(ALL_FILTER)
  const [showDaigou, setShowDaigou] = useState(false)
  const [dailyHintOpen, setDailyHintOpen] = useState(false)
  const [dailyExpanded, setDailyExpanded] = useState(false)

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

  // 含代購開關 + 選中的付款方式：兩者一起決定 dayBase，effItems 再疊上選中的那天。
  // 每日花費列表本身用 dayBase（不吃 expDate，只吃代購開關／付款方式篩選）——要讓
  // 使用者一直看得到所有日期可以點，選中某一天不該讓自己從列表消失；付款方式篩選則
  // 要讓每日花費的金額跟著篩選結果變（篩「信用卡」時看到的是每天刷卡花了多少）。
  const dayBase = useMemo(() => {
    const base = showDaigou ? items : items.filter((e) => !e.daigou)
    return expMethod === ALL_FILTER ? base : base.filter((e) => payMethod(e) === expMethod)
  }, [items, showDaigou, expMethod])
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

  // 圖表（每日花費／分類統計）共用的付款方式順序：現金、信用卡固定在前，其餘自訂
  // 方式接在後面，順序基於全部未刪除支出（不受代購/日期篩選影響），篩選時顏色
  // 才不會跳動；也讓圖例一定會列出使用者新增過的自訂付款方式。
  const methods = useMemo(() => methodOrder(items.map(payMethod)), [items])

  // 分類統計：每個分類的長條依付款方式拆成多段，顏色跟每日花費、圖例共用同一份
  // methodColor 色票（見 lib/money.ts），不再用分類色——付款方式一多，色票的顏色
  // 辨識度比「同色相深淺」好很多，圖例的顏色也才會跟長條對得上。
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

  // 每日花費：不限旅遊區間，直接列出所有有記帳的日期（依 dayBase，不吃 expDate），
  // 最新日期排最前面。dayBase 有吃 expMethod，篩選成單一付款方式時天數常常只剩
  // 1（尤其新加的自訂方式，可能只有一兩筆），這種情況下方渲染要放行顯示（見下方
  // JSX 的顯示條件），不能套用「只有一天就整塊隱藏」那條只給預設檢視用的規則。
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
  // 預設只顯示最新兩天，超過兩天才出現「顯示更多／更少」切換。
  const visibleDailyTotals = dailyExpanded ? dailyTotals : dailyTotals.slice(0, 2)

  // 明細分類頁籤：「全部」+ 只列出有支出的分類（各帶筆數），只影響明細列表。
  const expTabs = useMemo(() => {
    const cats = [...new Set(items.map((e) => e.cat))]
    return [ALL_FILTER, ...cats].map((cat) => ({
      cat,
      count: cat === ALL_FILTER ? items.length : items.filter((e) => e.cat === cat).length,
    }))
  }, [items])

  const filteredItems = items.filter(
    (e) =>
      (expFilter === ALL_FILTER || e.cat === expFilter) &&
      (expDate === ALL_FILTER || e.spent_on === expDate) &&
      (expMethod === ALL_FILTER || payMethod(e) === expMethod),
  )
  const expEmpty =
    filteredItems.length === 0 && (expFilter !== ALL_FILTER || expDate !== ALL_FILTER || expMethod !== ALL_FILTER)

  const toggleExpDate = (day: string) => setExpDate((cur) => (cur === day ? ALL_FILTER : day))
  const toggleExpMethod = (m: string) => setExpMethod((cur) => (cur === m ? ALL_FILTER : m))

  // 付款方式圖例：每日花費、分類統計 header 都會渲染一份，點了會整頁篩選成該付款
  // 方式（再點同一個取消），兩處共用同一個 expMethod 狀態，畫面上會同步反白。
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
            onClick={() => toggleExpMethod(m)}
          >
            <span className="money-cat-legend-swatch" style={{ background: methodColor(i) }} />
            {methodLabel(m)}
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
              <div className="money-dual-label">日幣總計</div>
              <div className="money-dual-value">{formatJPY(jpyTotal)}</div>
            </div>
            <div className="money-dual-divider" />
            <div className="money-dual-col">
              <div className="money-dual-label">日幣現金</div>
              <div className="money-dual-value">{formatJPY(jpyCashTotal)}</div>
            </div>
            <div className="money-dual-divider" />
            <div className="money-dual-col">
              <div className="money-dual-label">台幣總計</div>
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

      {dailyTotals.length > 0 && (dailyTotals.length > 1 || expMethod !== ALL_FILTER) && (
        <div className="money-cats">
          <div className="money-cats-header">
            <div className="money-section-kicker money-daily-kicker">
              每日花費
              <button
                type="button"
                className="money-filter-hint-btn"
                aria-label="每日花費說明"
                onClick={() => setDailyHintOpen(!dailyHintOpen)}
              >
                <Funnel size={12} weight="duotone" />
              </button>
              {dailyHintOpen && (
                <>
                  <div className="money-filter-hint-backdrop" onClick={() => setDailyHintOpen(false)} />
                  <div className="money-filter-hint-tip">
                    點一天可篩選下方明細；點右邊的付款方式也可以篩選；再點一次同一個可取消篩選，恢復顯示全部。
                  </div>
                </>
              )}
            </div>
            {renderMethodLegend()}
          </div>
          {visibleDailyTotals.map(([day, { sum, byMethod }]) => {
            const pct = dailyGrandTotal > 0 ? (sum / dailyGrandTotal) * 100 : 0
            const isSelected = expDate === day
            // 選了某一天之後，其餘天數的文字＋長條圖除了變灰階，還要再淡化
            // （opacity 降到 0.4，比預設的 0.85 更淡），凸顯選中的那天——只有實際
            // 有選日期時才生效，沒有篩選時大家都是原本的淡出樣式，不要整排都變灰。
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
                <span
                  className="money-cat-name"
                  style={{ fontWeight: isSelected ? 600 : 400, opacity: dimOpacity }}
                >
                  {formatExpenseDate(day)}
                </span>
                <span className="money-cat-bar" style={{ opacity: dimOpacity }}>
                  <span className="money-cat-bar-fill" style={{ width: `${pct}%` }}>
                    {methods.map((m, i) => (
                      <span
                        key={m}
                        className="money-cat-bar-value"
                        style={{
                          width: `${sum > 0 ? ((byMethod[m] ?? 0) / sum) * 100 : 0}%`,
                          background: methodColor(i),
                        }}
                      />
                    ))}
                  </span>
                </span>
                <span className="money-cat-amount">{formatTWD(sum)}</span>
                <span className="money-cat-pct">{pct.toFixed(0)}%</span>
              </button>
            )
          })}
          {dailyTotals.length > 2 && (
            <button
              type="button"
              className="money-daily-toggle"
              onClick={() => setDailyExpanded(!dailyExpanded)}
            >
              {dailyExpanded ? '顯示更少' : '顯示更多'}
              {dailyExpanded ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
            </button>
          )}
        </div>
      )}

      <div className="money-cats">
        <div className="money-cats-header">
          <div className="money-section-kicker">分類統計（台幣）</div>
          {renderMethodLegend()}
        </div>
        {catTotals.map(([cat, { sum, byMethod }]) => {
          const pct = grandTotal > 0 ? (sum / grandTotal) * 100 : 0
          return (
            <div key={cat} className="money-cat-row">
              <span className="money-cat-name">{cat}</span>
              <span className="money-cat-bar">
                <span className="money-cat-bar-fill" style={{ width: `${pct}%` }}>
                  {methods.map((m, i) => (
                    <span
                      key={m}
                      className="money-cat-bar-value"
                      style={{
                        width: `${sum > 0 ? ((byMethod[m] ?? 0) / sum) * 100 : 0}%`,
                        background: methodColor(i),
                      }}
                    />
                  ))}
                </span>
              </span>
              <span className="money-cat-amount">{formatTWD(sum)}</span>
              <span className="money-cat-pct">{pct.toFixed(0)}%</span>
            </div>
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
                      {e.spent_on ? `${formatExpenseDate(e.spent_on)} · ` : ''}
                      {e.cat} · {e.payer} 付 · {methodLabel(payMethod(e))}
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
