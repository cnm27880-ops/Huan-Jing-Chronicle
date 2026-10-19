// 分析頁：誰會被列進比較表、每欄的統計
import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisPlayers, columnStats } from '../src/ui/analysisView.js';

const room = (over = {}) => ({
  phase: 'online', me: { uid: 'a', isGm: false }, gm: { uids: ['g'] }, hiddenVitals: ['c'],
  vitals: { a: { name: '甲', maxHp: 10 }, b: { name: '乙', maxHp: 20 }, c: { name: '丙', maxHp: 30 }, g: { name: 'GM', maxHp: 1 } }, ...over,
});

test('一般玩家：看不到 GM 與被隱藏的人，自己標記為「我」', () => {
  const rows = analysisPlayers(room(), null);
  assert.deepEqual(rows.map((r) => r.uid).sort(), ['a', 'b']);
  assert.equal(rows.find((r) => r.uid === 'a').me, true);
});

test('GM：看得到被隱藏的玩家，但不列 GM 自己', () => {
  const rows = analysisPlayers(room({ me: { uid: 'g', isGm: true } }), null);
  assert.deepEqual(rows.map((r) => r.uid).sort(), ['a', 'b', 'c']);
});

test('沒加入房間：只有自己', () => {
  const rows = analysisPlayers({ phase: 'local' }, { name: '福德', maxHp: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].me, true);
});

test('欄位統計：略過沒有數值的人', () => {
  const rows = [{ v: { stats: { 物理傷害: 10 } } }, { v: { stats: { 物理傷害: 30 } } }, { v: {} }];
  const st = columnStats(rows, { get: (v) => v.stats?.物理傷害 });
  assert.deepEqual(st, { max: 30, min: 10, avg: 20, mid: 20 });
  assert.equal(columnStats([{ v: {} }], { get: (v) => v.stats?.物理傷害 }), null);
});
