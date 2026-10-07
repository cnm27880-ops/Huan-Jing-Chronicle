// 執行方式：npm test
// 機器人存檔 → 網站角色（資料都是假的；真實的 players_data.json 永遠不能進 git）
import test from 'node:test';
import assert from 'node:assert/strict';
import { convertBotPlayer, countInventory, blankCharacter } from '../src/game/importBot.js';
import { derivedStats, maxHp } from '../src/game/stats.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const bot = () => ({
  name: '測試角色', login_days: 12, time: 3, gold: 500, exp: 80, spent_exp: 900,
  inventory: ['綠草藥', '綠草藥', '代金券', '代金券', '代金券', '兄弟好相助', '🎀 自製紀念品'],
  sort_order: ['🎀 自製紀念品', '沒擁有的東西', '綠草藥'],
  counters: { 釣魚: 7, 烹飪: 3 }, hp: 20, max_hp: 50,
});

test('背包：一個物品一筆的清單 → 名稱: 數量；也接受已經是數量格式；忽略空白與過長名稱', () => {
  assert.deepEqual(countInventory(['a', 'a', 'b', '', '  ', 5, null]), { a: 2, b: 1 });
  assert.deepEqual(countInventory({ a: 3, b: 0, c: -1, d: '2' }), { a: 3, d: 2 });
  assert.deepEqual(countInventory('x'), {});
  assert.deepEqual(countInventory(['x'.repeat(81)]), {});
});

test('新角色：機器人有的欄位照搬，技能與數值是空白，最大生命照機器人', () => {
  const { data, summary } = convertBotPlayer(bot());
  assert.equal(data.name, '測試角色');
  assert.equal(data.loginDays, 12); assert.equal(data.time, 3); assert.equal(data.gold, 500); assert.equal(data.exp, 80); assert.equal(data.spentExp, 900);
  assert.deepEqual(data.inventory, { 綠草藥: 2, 代金券: 3, 兄弟好相助: 1, '🎀 自製紀念品': 1 });
  assert.deepEqual(data.sortOrder, ['🎀 自製紀念品', '綠草藥']); // 沒擁有的不放
  assert.equal(data.counters.釣魚, 7); assert.equal(data.counters.採藥, 0);
  assert.equal(data.keepsakes.兄弟好相助.bonus, 3); // 已知紀念品沿用效果
  assert.equal(data.keepsakes['🎀 自製紀念品'], undefined); // 自製的沒有效果
  assert.equal(data.skills.暴徒, undefined); // 不會偷到示範角色的技能
  assert.equal(data.baseStats.物理傷害, 0);
  assert.equal(maxHp(data), 50); assert.equal(data.hp, 20);
  assert.deepEqual(summary, { name: '測試角色', kinds: 4, items: 7, gold: 500, exp: 80, loginDays: 12 });
  assert.ok(derivedStats(data)); // 面板算得出來
});

test('數值夾限：生命為負 = 倒地(0)、時間不超過上限、亂填的數字變 0', () => {
  const { data } = convertBotPlayer({ ...bot(), hp: -519, max_hp: 479, time: 99, gold: -5, exp: 'abc', login_days: 0 });
  assert.equal(data.hp, 0); assert.equal(data.time, 10); assert.equal(data.gold, 0); assert.equal(data.exp, 0); assert.equal(data.loginDays, 1);
  assert.equal(convertBotPlayer({ ...bot(), hp: 99, max_hp: 10 }).data.hp, 10);
  assert.equal(convertBotPlayer({ ...bot(), max_hp: 0 }).data.baseStats.生命, 1);
});

test('已有角色：只覆蓋機器人有的欄位，技能、數值、裝備、招式、生命都保留；不改傳進來的物件', () => {
  const base = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  const before = JSON.stringify(base);
  const { data } = convertBotPlayer(bot(), base);
  assert.equal(JSON.stringify(base), before);
  assert.equal(data.gold, 500);
  assert.deepEqual(data.inventory, { 綠草藥: 2, 代金券: 3, 兄弟好相助: 1, '🎀 自製紀念品': 1 });
  assert.deepEqual(data.baseStats, SAMPLE_CHARACTER.baseStats);
  assert.deepEqual(data.skills, SAMPLE_CHARACTER.skills);
  assert.equal(data.moves.length, SAMPLE_CHARACTER.moves.length);
  assert.equal(data.hp, SAMPLE_CHARACTER.hp);
  assert.equal(data.equipment.weapon.id, SAMPLE_CHARACTER.equipment.weapon.id);
});

test('壞資料：回傳錯誤，不丟例外', () => {
  for (const x of [null, [], 'x', 5, {}, { name: '  ' }]) assert.ok(convertBotPlayer(x).error, JSON.stringify(x));
  assert.ok(blankCharacter('甲').inventory);
});

test('超大背包：種類有上限，數量照實加總（機器人最大的背包有三十多萬筆）', () => {
  const inv = Array.from({ length: 300_000 }, () => '代金券').concat(Array.from({ length: 600 }, (_, i) => `物品${i}`));
  const { data } = convertBotPlayer({ ...bot(), inventory: inv });
  assert.equal(data.inventory.代金券, 300_000);
  assert.equal(Object.keys(data.inventory).length, 500);
  assert.ok(JSON.stringify(data).length < 50_000);
});
