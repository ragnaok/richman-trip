// 記帳計算邏輯：
// - twd(e) = e.cur==='TWD' ? e.amt : e.amt*rate；總額、每人已付、分類統計都以台幣為基準
// - 匯率非法時 fallback 0.216
// - 結算（settle）依 splitAmong 算出「誰該轉給誰多少」，代購也算進去（只是不算進「不含
//   代購」的花費統計）；splitAmong 沒有值（包含所有既有支出）視同「目前全體成員均分」——
//   這是設計上的預設，不是遺漏
import type { Expense, PayMethod } from './types'

export const DEFAULT_RATE = 0.216

/** 沒有 method 的舊資料一律視同現金。 */
export function payMethod(e: Pick<Expense, 'method'>): PayMethod {
  return e.method ?? 'cash'
}

/** 'cash' 顯示固定中文，'card' 顯示可改名的 cardLabel（見 settings.cardLabel），其餘（自訂
 * 付款方式）本身就是顯示名稱。 */
export function methodLabel(method: PayMethod, cardLabel = '信用卡'): string {
  return method === 'cash' ? '現金' : method === 'card' ? cardLabel : method
}

/** 自訂付款方式名稱太長時（例如新增支出表單裡取代「信用卡」的那顆窄按鈕）截到
 * 第 3 個字加省略號，避免把按鈕撐爆或換行——CSS text-overflow 是照像素寬度截，
 * 遇到中英文混排寬度不一時效果不穩定，這裡改成按字數固定截斷。 */
export function truncateMethodLabel(label: string, max = 3): string {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

/** 付款方式在圖表（每日花費／分類統計的長條＋圖例）上的固定順序：現金、信用卡永遠
 * 在前，其餘自訂方式依第一次出現的順序接在後面。統一用這份順序決定顏色深淺
 * （見 methodColor），篩選/翻頁時同一種付款方式的顏色才不會跳動。 */
export function methodOrder(methods: Iterable<PayMethod>): PayMethod[] {
  const custom: string[] = []
  const seen = new Set<string>()
  for (const m of methods) {
    if (m === 'cash' || m === 'card' || seen.has(m)) continue
    seen.add(m)
    custom.push(m)
  }
  return ['cash', 'card', ...custom]
}

// 付款方式圖表色票：固定幾個彼此好分辨的色相（沿用 tokens.css 既有色票，不新增
// 顏色），不是同一色相的深淺變化——付款方式一多，深淺差異的辨識度太差（例如 5 種
// 灰階幾乎看不出差別）。同一種付款方式在整個記帳頁（每日花費／分類統計的長條＋
// 圖例）都吃同一個顏色，圖例的顏色就是長條的顏色，兩邊不會對不上；分類統計因此
// 不再用 CAT_COLOR（分類色）當長條底色——分類名稱本來就在最左邊用文字標出來，
// 顏色改負責標示付款方式這件事，不用同時扛兩種意義。
const METHOD_PALETTE = [
  'var(--color-neutral-800)',
  'var(--color-accent)',
  'var(--color-accent-2)',
  'var(--color-process-yellow)',
  'var(--color-accent-700)',
  'var(--color-accent-2-700)',
  'var(--color-neutral-500)',
]

/** 付款方式在長條圖／圖例上的顏色，依 methodOrder 給的順序從 METHOD_PALETTE 固定
 * 指派，超過色票長度就循環使用。 */
export function methodColor(index: number): string {
  return METHOD_PALETTE[index % METHOD_PALETTE.length]
}

/** 匯率字串轉數字，非法輸入（空字串、非數字、負數、0）一律 fallback 0.216。 */
export function rateNum(rate: string): number {
  const n = Number(rate)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATE
  return n
}

/** 單筆支出換算成台幣。 */
export function twd(e: Pick<Expense, 'cur' | 'amt'>, rate: number): number {
  return e.cur === 'TWD' ? e.amt : e.amt * rate
}

export function formatTWD(n: number): string {
  return `NT$ ${Math.round(n).toLocaleString('zh-Hant')}`
}

/** symbol 預設 ¥，實際顯示要吃 settings.currencySymbol（見呼叫端）。 */
export function formatJPY(n: number, symbol = '¥'): string {
  return `${symbol}${Math.round(n).toLocaleString('zh-Hant')}`
}

/** 這筆支出「誰付了多少」：payers（多付款人）有值就照 payers，否則視同 payer 一人付 amt 全額。 */
export function payersOf(e: Pick<Expense, 'payer' | 'payers' | 'amt'>): Record<string, number> {
  return e.payers ?? { [e.payer]: e.amt }
}

/** 這筆支出的分攤對象：splitAmong 有值就照 splitAmong，沒有值視同傳入的 allMembers 全員
 * （既有支出、或新增時沒特別調整分攤對象的支出，一律視同全員均分）。 */
export function splitOf(e: Pick<Expense, 'splitAmong'>, allMembers: string[]): string[] {
  return e.splitAmong ?? allMembers
}

/** 某人在這筆支出裡付了多少（換算台幣）。 */
export function paidTwd(e: Pick<Expense, 'cur' | 'payer' | 'payers' | 'amt'>, person: string, rate: number): number {
  const amt = payersOf(e)[person] ?? 0
  return e.cur === 'TWD' ? amt : amt * rate
}

/** 某人在這筆支出裡應分攤多少（換算台幣）：splitAmounts 有指定該人的覆寫值就用覆寫值，
 * 否則這筆支出的台幣總額平分給 splitAmong（或全員）。 */
export function shareTwd(
  e: Pick<Expense, 'cur' | 'amt' | 'splitAmong' | 'splitAmounts'>,
  person: string,
  allMembers: string[],
  rate: number,
): number {
  const override = e.splitAmounts?.[person]
  if (override !== undefined) return e.cur === 'TWD' ? override : override * rate
  const among = splitOf(e, allMembers)
  return twd(e, rate) / Math.max(1, among.length)
}

export interface SettleLine {
  from: string
  to: string
  amount: number
}

/** 結算：每人淨額 = Σ(該筆付了多少 − 該筆該分攤多少)，代購一樣列入計算——代購只是不算進
 * 「不含代購」的花費統計，錢還是有人先墊、還是要算進結算。淨額為負（欠錢）跟為正（該收錢）
 * 的人依金額大小貪婪配對，湊出最少交易數的轉帳清單。 */
export function settle(expenses: Expense[], members: string[], rate: number): SettleLine[] {
  const splitBase = expenses.filter((e) => e.deleted !== 1)
  const balances = members.map((name) => ({
    name,
    net: splitBase.reduce((sum, e) => {
      const among = splitOf(e, members)
      const share = among.includes(name) ? shareTwd(e, name, members, rate) : 0
      return sum + paidTwd(e, name, rate) - share
    }, 0),
  }))
  const debtors = balances
    .filter((b) => b.net < -1)
    .map((b) => ({ name: b.name, amt: -b.net }))
    .sort((a, b) => b.amt - a.amt)
  const creditors = balances
    .filter((b) => b.net > 1)
    .map((b) => ({ name: b.name, amt: b.net }))
    .sort((a, b) => b.amt - a.amt)
  const lines: SettleLine[] = []
  let di = 0
  let ci = 0
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di]
    const c = creditors[ci]
    const pay = Math.min(d.amt, c.amt)
    if (pay > 1) lines.push({ from: d.name, to: c.name, amount: Math.round(pay) })
    d.amt -= pay
    c.amt -= pay
    if (d.amt <= 1) di++
    if (c.amt <= 1) ci++
  }
  return lines
}
