#!/usr/bin/env node
// 從 design/Inuyama Trip PWA.dc.html 的 <script type="text/x-dc"> 區塊抽出種子資料常數，
// 輸出成 src/data/seed.json。
//
// 不能用 JSON.parse：原型裡的 const 是不合法 JSON 的 JS 物件字面值（key 沒引號、
// 單引號字串、還有 NA 這種變數參照）。改成切出原始碼片段再用 `new Function` 在隔離
// 作用域求值，取得真正的物件後 JSON.stringify 輸出。
// 切片錨點是 `const ME=` 與 `const nav` 這兩個穩定字串，不依賴行號。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC_HTML = path.join(ROOT, 'design', 'Inuyama Trip PWA.dc.html')
const OUT_JSON = path.join(ROOT, 'src', 'data', 'seed.json')

const html = readFileSync(SRC_HTML, 'utf8')

const START_MARKER = 'const ME='
const END_MARKER = 'const nav'

const startIdx = html.indexOf(START_MARKER)
const endIdx = html.indexOf(END_MARKER, startIdx)

if (startIdx === -1) {
  throw new Error(`找不到起始錨點 "${START_MARKER}"，design 檔案可能被改過，請確認種子常數區塊還在。`)
}
if (endIdx === -1) {
  throw new Error(`找不到結束錨點 "${END_MARKER}"，design 檔案可能被改過，請確認種子常數區塊還在。`)
}

const codeSlice = html.slice(startIdx, endIdx)

// 這個切片裡應該包含以下所有 const 宣告，逐一確認都存在，避免切片範圍不小心漏掉誰。
const EXPECTED_CONSTS = [
  'ME', 'YOU', 'NA', 'HOTELS', 'DAYINFO', 'PLANS', 'KIND',
  'SPOTS', 'PACK', 'EXPS', 'CATICON', 'CATCOLOR', 'TODAY',
]
for (const name of EXPECTED_CONSTS) {
  // ME/YOU/NA 是同一句裡的多重宣告，所以只檢查變數名帶等號出現，不要求緊接 "const"。
  if (!new RegExp(`\\b${name}\\s*=`).test(codeSlice)) {
    throw new Error(`切片範圍內找不到 "${name} ="，切片邊界可能不對，請檢查 START_MARKER/END_MARKER。`)
  }
}

// 用 new Function 包一層隔離作用域求值（不是 eval，不污染全域），
// 取出所有 const 綁定塞進 module.exports。
const wrapped = `
${codeSlice}
module.exports = { ME, YOU, NA, HOTELS, DAYINFO, PLANS, KIND, SPOTS, PACK, EXPS, CATICON, CATCOLOR, TODAY };
`
const runner = new Function('module', wrapped)
const mod = { exports: {} }
runner(mod)
const data = mod.exports

// --- 驗證筆數（README 描述：6 天、30 筆行程、14 景點、15 行李、6 記帳） ---
const dayCount = Object.keys(data.PLANS).length
const planCount = Object.values(data.PLANS).reduce((sum, list) => sum + list.length, 0)
const spotCount = data.SPOTS.length
const packCount = data.PACK.length
const expCount = data.EXPS.length

const checks = [
  ['DAYINFO 天數', data.DAYINFO.length, 6],
  ['PLANS 天數', dayCount, 6],
  // 逐天核對後實際是 29 筆（7+4+6+4+3+5），以實際資料為準。
  ['PLANS 行程總筆數', planCount, 29],
  ['SPOTS 筆數', spotCount, 14],
  ['PACK 筆數', packCount, 15],
  ['EXPS 筆數', expCount, 6],
]

let hasError = false
for (const [label, actual, expected] of checks) {
  const ok = actual === expected
  if (!ok) hasError = true
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${label}: 實際 ${actual} / 預期 ${expected}`)
}

// 按天列出行程筆數，方便對不上時排查是哪一天出問題
console.log('\n各天行程筆數：')
for (const [day, list] of Object.entries(data.PLANS)) {
  console.log(`  ${day}: ${list.length} 筆`)
}

if (hasError) {
  console.error('\n筆數驗證失敗，請檢查 design 原始檔或切片邏輯。仍會輸出 seed.json 供人工檢查。')
}

// --- 輸出 seed.json ---
// 頂層形狀：
// {
//   ME, YOU, NA, TODAY: string,
//   hotels: Record<hotelKey, {name, q}>,
//   dayinfo: Array<{d, wd, hotel, w:{i,t,x,h}}>,
//   plans: Record<day, PlanItem[]>,
//   kind: Record<kindCode, [icon, colorVar, label]>,
//   spots: Spot[],
//   pack: PackItem[],
//   exps: Expense[],
//   catIcon: Record<catName, iconClass>,
//   catColor: Record<catName, colorVar>,
// }
const seed = {
  ME: data.ME,
  YOU: data.YOU,
  NA: data.NA,
  TODAY: data.TODAY,
  hotels: data.HOTELS,
  dayinfo: data.DAYINFO,
  plans: data.PLANS,
  kind: data.KIND,
  spots: data.SPOTS,
  pack: data.PACK,
  exps: data.EXPS,
  catIcon: data.CATICON,
  catColor: data.CATCOLOR,
}

mkdirSync(path.dirname(OUT_JSON), { recursive: true })
writeFileSync(OUT_JSON, JSON.stringify(seed, null, 2) + '\n', 'utf8')
console.log(`\n已寫入 ${path.relative(ROOT, OUT_JSON)}`)

if (hasError) {
  process.exitCode = 1
}
