// 用 node 內建的 test runner（node --test）驗證 money.ts 的分攤計算，不額外裝測試框架。
// 重點是「A 幫 B 付」這種情境下，每個人的消費金額要歸對人——付款人付的錢不等於他的消費。
import test from 'node:test'
import assert from 'node:assert/strict'
import { isInSplit, shareNative, shareOfTwd } from './money.ts'

const MEMBERS = ['A', 'B']
const RATE = 0.2

test('A 幫 B 付 1000：A 的消費是 0、B 的消費是 1000（付款人不等於消費者）', () => {
  const e = { cur: 'TWD', amt: 1000, payer: 'A', splitAmong: ['B'] }
  assert.equal(shareNative(e, 'A', MEMBERS), 0)
  assert.equal(shareNative(e, 'B', MEMBERS), 1000)
  assert.equal(isInSplit(e, 'A', MEMBERS), false)
  assert.equal(isInSplit(e, 'B', MEMBERS), true)
})

test('沒指定分攤對象視同全員均分：共同花費每個人都算自己那份', () => {
  const e = { cur: 'TWD', amt: 1000, payer: 'A' }
  assert.equal(isInSplit(e, 'B', MEMBERS), true)
  assert.equal(shareNative(e, 'A', MEMBERS), 500)
  assert.equal(shareNative(e, 'B', MEMBERS), 500)
})

test('有 splitAmounts 覆寫值就用覆寫值，不是平分', () => {
  const e = { cur: 'TWD', amt: 1000, payer: 'A', splitAmong: ['A', 'B'], splitAmounts: { A: 300, B: 700 } }
  assert.equal(shareNative(e, 'A', MEMBERS), 300)
  assert.equal(shareNative(e, 'B', MEMBERS), 700)
})

test('日幣支出的分攤維持日幣；換算成台幣才乘匯率', () => {
  const e = { cur: 'JPY', amt: 3000, payer: 'A', splitAmong: ['A', 'B'] }
  assert.equal(shareNative(e, 'B', MEMBERS), 1500)
  assert.equal(shareOfTwd(e, 'B', MEMBERS, RATE), 1500 * RATE)
})

test('不在分攤名單內即使有覆寫值也不算（名單是唯一依據）', () => {
  const e = { cur: 'TWD', amt: 1000, payer: 'A', splitAmong: ['B'], splitAmounts: { A: 400, B: 600 } }
  assert.equal(shareNative(e, 'A', MEMBERS), 0)
})

test('各人分攤加總等於整筆金額（不會多算或漏算）', () => {
  const members = ['A', 'B', 'C']
  for (const e of [
    { cur: 'TWD', amt: 900, payer: 'A' },
    { cur: 'TWD', amt: 900, payer: 'A', splitAmong: ['B', 'C'] },
    { cur: 'JPY', amt: 1000, payer: 'B', splitAmong: ['A', 'C'], splitAmounts: { A: 250, C: 750 } },
  ]) {
    const sum = members.reduce((acc, m) => acc + shareNative(e, m, members), 0)
    assert.equal(sum, e.amt)
  }
})
