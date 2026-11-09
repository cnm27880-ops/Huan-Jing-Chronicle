// audit.js 的獨立測試：GM 改角色時的異動紀錄（純函式）
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCharChange, MAX_AUDIT_LINES } from '../src/audit.js';

test('沒有變更：回傳「沒有數值變更」', () => {
  assert.deepEqual(describeCharChange({ gold: 5 }, { gold: 5 }), { lines: ['沒有數值變更'], total: 0 });
});

test('新建角色（before 是 null）', () => {
  const r = describeCharChange(null, { name: '福德', gold: 10 });
  assert.equal(r.lines[0], '新建角色「福德」');
  assert.ok(r.lines.includes('金幣　0 → 10'));
});

test('名稱、金幣、經驗、技能、啟動、生活技能、背包、手動調整的差異', () => {
  const before = { name: 'A', gold: 1, exp: 2, skills: { 劍: 1 }, skillOn: { 劍: false }, lifeSkills: { 釣魚: 3 }, inventory: { 藥水: 2 }, adjust: { 物理傷害: 1 } };
  const after = { name: 'B', gold: 5, exp: 9, skills: { 劍: 2, 盾: 1 }, skillOn: { 劍: true }, lifeSkills: { 釣魚: 4 }, inventory: { 藥水: 0, 鐵: 3 }, adjust: { 物理傷害: 3 } };
  const { lines, total } = describeCharChange(before, after);
  for (const want of ['名稱　A → B', '金幣　1 → 5', '經驗　2 → 9', '技能 劍　1 → 2', '技能 盾　0 → 1', '啟動 劍　關 → 開', '生活技能 釣魚　3 → 4', '背包 藥水　2 → 0', '背包 鐵　0 → 3', '手動調整 物理傷害　1 → 3']) {
    assert.ok(lines.includes(want), want);
  }
  assert.equal(total, lines.length);
});

test('不記生命、資源等玩家自己常變的欄位', () => {
  assert.equal(describeCharChange({ hp: 1, resources: { 靈氣: 1 } }, { hp: 99, resources: { 靈氣: 50 } }).total, 0);
});

test('項數超過上限：只留前 12 行並說明還有幾項；壞資料不丟錯', () => {
  const inv = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`物${i}`, i + 1]));
  const r = describeCharChange({ inventory: {} }, { inventory: inv });
  assert.equal(r.total, 20);
  assert.equal(r.lines.length, MAX_AUDIT_LINES + 1);
  assert.match(r.lines.at(-1), /另外還有 8 項變更/);
  assert.doesNotThrow(() => describeCharChange('壞', [1, 2]));
  assert.equal(describeCharChange({ gold: 'abc' }, { gold: undefined }).total, 0); // 非數字當 0
});
