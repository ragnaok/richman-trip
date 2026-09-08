// 記帳計算邏輯：
// - twd(e) = e.cur==='TWD' ? e.amt : e.amt*rate；總額、每人已付、分類統計都以台幣為基準
// - 匯率非法時 fallback 0.216
// - 刻意不提供「誰欠誰」的結算函式（使用者明確要求移除）
import type { Expense, PayMethod } from './types'

export const DEFAULT_RATE = 0.216

/** 沒有 method 的舊資料一律視同現金。 */
export function payMethod(e: Pick<Expense, 'method'>): PayMethod {
  return e.method ?? 'cash'
}

/** 'cash'/'card' 顯示固定中文，其餘（自訂付款方式）本身就是顯示名稱。 */
export function methodLabel(method: PayMethod): string {
  return method === 'cash' ? '現金' : method === 'card' ? '信用卡' : method
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

/** 付款方式在長條圖／圖例上的顏色：同一色相依 methodOrder 的順序從淡到濃排開
 * （現金最淡、順序最後一個最濃），base 可以是分類色（分類統計）或中性色
 * （每日花費／圖例本身）。 */
export function methodColor(base: string, index: number, total: number): string {
  const share = total <= 1 ? 100 : Math.round(40 + (60 * index) / (total - 1))
  return share >= 100 ? base : `color-mix(in srgb, ${base} ${share}%, white)`
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

export function formatJPY(n: number): string {
  return `¥${Math.round(n).toLocaleString('zh-Hant')}`
}
