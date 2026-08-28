// 用 node 內建的 test runner（node --test）驗證 time.ts 的排序邏輯，不額外裝測試框架。
// Node 22 對 TypeScript 有內建 type-stripping，可以直接 import .ts 檔。
import test from 'node:test'
import assert from 'node:assert/strict'
import { tkey, sortPlans } from './time.ts'

test('tkey：合法 HH:MM 補零成自身', () => {
  assert.equal(tkey('09:00'), '09:00')
  assert.equal(tkey('17:15'), '17:15')
})

test('tkey：H:MM / H:M 缺零寫法會補零', () => {
  assert.equal(tkey('9:5'), '09:05')
  assert.equal(tkey('9:00'), '09:00')
})

test('tkey：未定時間（含 NA "—"）與其他非法格式視為 99:99', () => {
  assert.equal(tkey('—'), '99:99')
  assert.equal(tkey(''), '99:99')
  assert.equal(tkey('待定'), '99:99')
})

test('sortPlans：未定時間排最後，其餘依時間升冪', () => {
  const plans = [{ t: '—' }, { t: '09:00' }, { t: '9:5' }, { t: '17:15' }]
  const sorted = sortPlans(plans).map((p) => p.t)
  assert.deepEqual(sorted, ['09:00', '9:5', '17:15', '—'])
})

test('sortPlans：不改動原陣列（回傳新陣列）', () => {
  const plans = [{ t: '17:15' }, { t: '09:00' }]
  const sorted = sortPlans(plans)
  assert.notEqual(sorted, plans)
  assert.equal(plans[0].t, '17:15') // 原陣列順序不變
})
