// 行程排序：H:MM／HH:MM 補零當排序鍵，其餘（含未定時間 '—'）視為 '99:99' 排最後。
import type { PlanItem } from './types'

const TIME_RE = /^(\d{1,2}):(\d{1,2})$/

/** 'H:MM'/'HH:MM'（含 'H:M' 這種缺零寫法）→ 補零成 'HH:MM'；其餘（含 NA '—'）視為 '99:99'。 */
export function tkey(t: string): string {
  const m = TIME_RE.exec(t)
  if (!m) return '99:99'
  const [, h, mm] = m
  return `${h.padStart(2, '0')}:${mm.padStart(2, '0')}`
}

/** 依 tkey 用 localeCompare 排序，未定時間排最後；穩定排序（不改動原陣列）。 */
export function sortPlans<T extends Pick<PlanItem, 't'>>(plans: T[]): T[] {
  return [...plans].sort((a, b) => tkey(a.t).localeCompare(tkey(b.t)))
}

const WD_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

// 行程分頁刊頭日期格式，例如 '2026.09.03 週四'。顯示裝置的真實日期，跟選中的
// day chip 無關——切 chip 只換下面的行程內容。
export function formatMastheadDate(now: Date = new Date()): string {
  const m = now.getMonth() + 1
  const d = now.getDate()
  const wd = WD_NAMES[now.getDay()]
  return `${now.getFullYear()}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} ${wd}`
}

// 行程編輯面板的日期列格式，例如 '2026.09.03 · 週四'。分隔符跟刊頭的
// formatMastheadDate 不同，不要合併成同一個函式。
export function formatEditDayLabel(day: string, wd: string): string {
  const [m, d] = day.split('/')
  return `2026.${m.padStart(2, '0')}.${d.padStart(2, '0')} · ${wd}`
}

// 「今天」用裝置真實日期判斷，不用種子裡示範用的 TODAY 常數，這樣「今天」徽章、
// 下一站判斷才會跟著真實日期走。格式同 DAYINFO 的 'M/D'（不補零）。
export function todayKey(now: Date = new Date()): string {
  return `${now.getMonth() + 1}/${now.getDate()}`
}

// 開場預設選中的行程日：真實日期在行程範圍內就選今天，否則選第一天。
export function defaultDay(days: string[], now: Date = new Date()): string {
  const today = todayKey(now)
  return days.includes(today) ? today : days[0]
}

/** 設定頁「旅遊日期」單日格式，例如 '9/2'（跟 DAYINFO.d、plans 的 day 欄位同一套格式）。 */
export function isoToMd(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** isoToMd 的反方向：'9/2' + 年份 → '2026-09-02'。年份取 tripStart 的年份而非裝置
 * 當前年份，行程可能在別的年份被查看。 */
export function mdToIso(md: string, year: string): string {
  const [m, d] = md.split('/')
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** AuthGate 主視覺日期標題用：{year, range}，例如 {year:'2026', range:'09.02 — 09.07'}。
 * tripStart/tripEnd 不合法時回 null，由呼叫端退回種子文字。 */
export function formatHeroDateRange(startIso: string, endIso: string): { year: string; range: string } | null {
  const [ys, ms, ds] = startIso.split('-')
  const [, me, de] = endIso.split('-')
  if (!ys || !ms || !ds || !me || !de) return null
  return { year: ys, range: `${ms}.${ds} — ${me}.${de}` }
}

/** 從 tripStart/tripEnd 展開成逐日的 { d, wd } 清單，欄位名刻意跟 DAYINFO 一致，
 * 呼叫端才能混用同一種形狀。起訖不合法就回空陣列。 */
export function dayRange(startIso: string, endIso: string): Array<{ d: string; wd: string }> {
  const start = new Date(`${startIso}T00:00:00`)
  const end = new Date(`${endIso}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []
  const out: Array<{ d: string; wd: string }> = []
  const cur = new Date(start)
  while (cur <= end) {
    out.push({ d: `${cur.getMonth() + 1}/${cur.getDate()}`, wd: WD_NAMES[cur.getDay()] })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}
