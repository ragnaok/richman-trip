#!/usr/bin/env node
// 讀 src/data/seed.json，依 schema.sql 的表結構產生 INSERT 語句，輸出成 seed.sql。
// 只產生檔案，不執行 wrangler d1 execute。

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SEED_JSON = path.join(ROOT, 'src', 'data', 'seed.json')
const OUT_SQL = path.join(ROOT, 'seed.sql')

const seed = JSON.parse(readFileSync(SEED_JSON, 'utf8'))

// 跟 src/lib/db.ts 的 SEED_TIMESTAMP 同一個常數，讓兩邊種子列的 updated_at 語意一致。
const SEED_TIMESTAMP = 1_756_000_000_000

/** SQL 字串字面值：單引號跳脫成兩個單引號；null/undefined 輸出 NULL。 */
function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL'
  return String(v)
}

function sqlBool01(v) {
  return v ? '1' : '0'
}

const lines = []
lines.push('-- 由 scripts/seed-d1.mjs 從 src/data/seed.json 產生，勿手動編輯。')
lines.push('-- 使用方式：wrangler d1 execute <trip> --local --file=seed.sql')
lines.push('')

// members：不預塞任何範例身分，由使用者在「管理身分」新增
lines.push('-- members（無範例，使用者自行新增）')
lines.push('')

// plans：從 seed.plans（Record<day, PlanItem[]>）攤平
lines.push('-- plans')
let planCount = 0
for (const [day, list] of Object.entries(seed.plans)) {
  for (const p of list) {
    planCount++
    const cands = p.cands ? JSON.stringify(p.cands) : null
    lines.push(
      `INSERT INTO plans (id,day,t,title,sub,kind,q,spot,cands,drive,park,notify,lead,photo,updated_at,deleted) VALUES ` +
        `(${sqlStr(p.id)},${sqlStr(day)},${sqlStr(p.t)},${sqlStr(p.title)},${sqlStr(p.sub ?? '')},${sqlStr(p.k)},` +
        `${sqlStr(p.q ?? '')},${sqlStr(p.spot)},${sqlStr(cands)},${sqlStr(p.drive)},${sqlStr(p.park)},` +
        `${sqlBool01(p.notify)},${sqlNum(p.lead ?? 30)},${sqlStr(p.photo)},${SEED_TIMESTAMP},0);`,
    )
  }
}
lines.push('')

// pack_items
lines.push('-- pack_items')
for (const item of seed.pack) {
  lines.push(
    `INSERT INTO pack_items (id,cat,name,owner,done,updated_at,deleted) VALUES ` +
      `(${sqlStr(item.id)},${sqlStr(item.cat)},${sqlStr(item.name)},${sqlStr(item.owner)},${sqlBool01(item.done)},${SEED_TIMESTAMP},0);`,
  )
}
lines.push('')

// expenses（spent_on 留空，見 db.ts 的說明：種子花費不牽強對應到某一天）
lines.push('-- expenses')
for (const e of seed.exps) {
  lines.push(
    `INSERT INTO expenses (id,title,cat,cur,amt,payer,method,spent_on,updated_at,deleted) VALUES ` +
      `(${sqlStr(e.id)},${sqlStr(e.title)},${sqlStr(e.cat)},${sqlStr(e.cur)},${sqlNum(e.amt)},${sqlStr(e.payer)},${sqlStr(e.method ?? 'cash')},${sqlStr('')},${SEED_TIMESTAMP},0);`,
  )
}
lines.push('')

// settings：預設匯率 + 設定頁其他欄位，跟 src/lib/db.ts 的種子邏輯一致
function mdToIso(md) {
  const [m, d] = md.split('/')
  return `2026-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
lines.push('-- settings')
lines.push(`INSERT INTO settings (k,v,updated_at) VALUES (${sqlStr('rate')},${sqlStr('0.216')},${SEED_TIMESTAMP});`)
lines.push(`INSERT INTO settings (k,v,updated_at) VALUES (${sqlStr('destTitle')},${sqlStr('')},${SEED_TIMESTAMP});`)
lines.push(`INSERT INTO settings (k,v,updated_at) VALUES (${sqlStr('destSubtitle')},${sqlStr('')},${SEED_TIMESTAMP});`)
const firstDay = seed.dayinfo[0]?.d
const lastDay = seed.dayinfo[seed.dayinfo.length - 1]?.d
if (firstDay) lines.push(`INSERT INTO settings (k,v,updated_at) VALUES (${sqlStr('tripStart')},${sqlStr(mdToIso(firstDay))},${SEED_TIMESTAMP});`)
if (lastDay) lines.push(`INSERT INTO settings (k,v,updated_at) VALUES (${sqlStr('tripEnd')},${sqlStr(mdToIso(lastDay))},${SEED_TIMESTAMP});`)
lines.push('')

// hotels：設定頁「住宿地點」，從 dayinfo 反推每間飯店的入住/退房日期範圍（跟 db.ts 同一套算法）
lines.push('-- hotels')
const hotelRanges = {}
for (const d of seed.dayinfo) {
  const iso = mdToIso(d.d)
  const r = hotelRanges[d.hotel]
  if (!r) hotelRanges[d.hotel] = { min: iso, max: iso }
  else {
    if (iso < r.min) r.min = iso
    if (iso > r.max) r.max = iso
  }
}
let hotelCount = 0
for (const [key, info] of Object.entries(seed.hotels)) {
  const r = hotelRanges[key]
  let checkout = ''
  if (r) {
    // 不能用 toISOString()：時區換算會讓退房日期少一天。
    const d = new Date(`${r.max}T00:00:00`)
    d.setDate(d.getDate() + 1)
    checkout = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  hotelCount++
  lines.push(
    `INSERT INTO hotels (id,name,q,checkin,checkout,updated_at,deleted) VALUES ` +
      `(${sqlStr(key)},${sqlStr(info.name)},${sqlStr(info.q)},${sqlStr(r?.min ?? '')},${sqlStr(checkout)},${SEED_TIMESTAMP},0);`,
  )
}
lines.push('')

// cats：使用者自建分類，種子階段留空（CATICON/CATCOLOR 是圖示對照表，不是使用者分類列表）
lines.push('-- cats：種子階段留空（使用者自建分類表，CATICON/CATCOLOR 只是圖示/顏色對照表，不塞資料）')
lines.push('')

// spots_meta：使用者互動後才產生，種子階段留空
lines.push('-- spots_meta：種子階段留空（已去過/備註是使用者互動後才有的個人化資料）')
lines.push('')

writeFileSync(OUT_SQL, lines.join('\n') + '\n', 'utf8')

// --- 簡單驗證輸出的 SQL：每個表都有對應筆數的 INSERT ---
const sql = readFileSync(OUT_SQL, 'utf8')
const countInserts = (table) => (sql.match(new RegExp(`INSERT INTO ${table} `, 'g')) || []).length

const checks = [
  ['members', 0],
  ['plans', planCount],
  ['pack_items', seed.pack.length],
  ['expenses', seed.exps.length],
  ['settings', 5],
  ['hotels', hotelCount],
]

let ok = true
for (const [table, expected] of checks) {
  const actual = countInserts(table)
  const pass = actual === expected
  if (!pass) ok = false
  console.log(`${pass ? 'OK ' : 'FAIL'}  ${table}: ${actual} 筆 INSERT / 預期 ${expected}`)
}

console.log(`\n已寫入 ${path.relative(ROOT, OUT_SQL)}`)
if (!ok) process.exitCode = 1
