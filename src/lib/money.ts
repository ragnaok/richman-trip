// 記帳計算邏輯：
// - twd(e) = e.cur==='TWD' ? e.amt : e.amt*rate；總額、每人已付、分類統計都以台幣為基準
// - 匯率非法時 fallback 0.216
// - 刻意不提供「誰欠誰」的結算函式（使用者明確要求移除）
import type { Expense, PayMethod } from './types'

export const DEFAULT_RATE = 0.216

export const PAY_METHOD_LABEL: Record<PayMethod, string> = { cash: '現金', card: '信用卡' }

/** 沒有 method 的舊資料一律視同現金。 */
export function payMethod(e: Pick<Expense, 'method'>): PayMethod {
  return e.method ?? 'cash'
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
