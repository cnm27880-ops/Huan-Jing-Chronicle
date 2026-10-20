// 分析頁：誰會被列進比較表、每欄的統計
import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisPlayers, columnStats, archetypeOf, insights, diffOf, GROUPS } from '../src/ui/analysisView.js';

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
  assert.deepEqual(st, { max: 30, min: 10 });
  assert.equal(columnStats([{ v: {} }], { get: (v) => v.stats?.物理傷害 }), null);
});

const full = (stats, extra = {}) => ({ stats: { 真實傷害: 0, 物理傷害: 0, 能量傷害: 0, 靈魂傷害: 0, 絕對防禦: 0, 體魄強韌: 0, 抗性免疫: 0, 精神意志: 0, ...stats }, ...extra });

test('總傷／總防：四項相加；缺資料時沒有數值', () => {
  const [atk, def] = GROUPS;
  const v = full({ 真實傷害: 10, 物理傷害: 20, 能量傷害: 30, 靈魂傷害: 40, 絕對防禦: 1, 體魄強韌: 2, 抗性免疫: 3, 精神意志: 4 });
  assert.equal(atk.cols.at(-1).get(v), 100);
  assert.equal(def.cols.at(-1).get(v), 10);
  assert.equal(atk.cols.at(-1).get({}), undefined);
});

test('流派標籤：看最高的那一項，沒同步就沒有', () => {
  assert.equal(archetypeOf(full({ 靈魂傷害: 50 })), '靈魂特化');
  assert.equal(archetypeOf(full({ 能量傷害: 50 })), '魔導');
  assert.equal(archetypeOf(full({ 精神意志: 50 })), '精神抗性流');
  assert.equal(archetypeOf({}), '');
  assert.equal(archetypeOf(full({})), '');
});

test('差值：以基準玩家為準，任一邊沒數值就不顯示', () => {
  const col = { get: (v) => v.x };
  assert.equal(diffOf(col, { x: 10 }, { x: 4 }), 6);
  assert.equal(diffOf(col, { x: 1 }, { x: 4 }), -3);
  assert.equal(diffOf(col, {}, { x: 4 }), null);
});

test('戰力摘要：三張卡，點出各項最高者', () => {
  const rows = [
    { name: '金先生', v: full({ 物理傷害: 300, 體魄強韌: 200, 抗性免疫: 100, 精神意志: 186 }, { maxHp: 900, res: { 鬥氣: [1, 80] } }) },
    { name: '福德', v: full({ 能量傷害: 100, 體魄強韌: 150, 抗性免疫: 169, 精神意志: 150 }, { maxHp: 1000, res: { 魔力: [1, 500] } }) },
  ];
  const cards = insights(rows);
  assert.equal(cards.length, 3);
  assert.match(cards[0].text, /金先生/);
  assert.match(cards[0].text, /物理傷害 300/);
  assert.match(cards[1].text, /金先生.*486/);
  assert.match(cards[1].text, /生命最高是 福德/);
  assert.match(cards[2].text, /魔力 福德（500）/);
  assert.ok(cards[0].parts.some((x) => x.kind === 'name' && x.v === '金先生'));
  assert.ok(cards[0].parts.some((x) => x.kind === 'num' && x.v === '300'));
  assert.deepEqual(insights([{ name: '甲', v: {} }]), []);
});
