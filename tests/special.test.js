// 特殊配方、特殊材料、餵肉球、惜未央、動物春藥
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import {
  SPECIAL_RECIPES, craftSpecial, specialMaxTimes, useSpecialItem, gatherDaily, feedMeatball, harvestMeat, MEAT, MONSTER_MEAT,
} from '../src/game/special.js';
import { eat, newDay } from '../src/game/engine.js';
import { drinkPotion } from '../src/game/combat.js';
import { derivedStats } from '../src/game/stats.js';
import { equip } from '../src/game/equipment.js';

const mk = (extra = {}) => ({ ...blankCharacter('測試'), ...extra });
const always = (v) => () => v; // 固定亂數：0.999 → d20 = 20；0 → d20 = 1

test('特殊配方：扣材料、成功得 1 個、失敗材料全毀；材料不夠就停', () => {
  const s = mk({ inventory: { 怪物肉: 12, 南夢水: 12 }, lifeSkills: { ...blankCharacter('x').lifeSkills, 調劑: 10 } });
  assert.equal(specialMaxTimes(s, '花雕怪味魚滴露'), 2);
  const r = craftSpecial(s, '花雕怪味魚滴露', 5, [], always(0.999)); // 20 + 10 ≥ 22；只夠做 2 次
  assert.equal(r.rolls.length, 2);
  assert.equal(s.inventory.花雕怪味魚滴露, 2);
  assert.equal(s.inventory.怪物肉, undefined);
  assert.equal(s.counters.調劑, 2); // 製作也算進 500 次
  const f = mk({ inventory: { 怪物肉: 6, 南夢水: 6 } });
  const bad = craftSpecial(f, '花雕怪味魚滴露', 1, [], always(0)); // 1 + 0 < 22
  assert.equal(bad.rolls[0].success, false);
  assert.equal(f.inventory.花雕怪味魚滴露, undefined);
  assert.equal(f.inventory.怪物肉, undefined); // 失敗材料全毀
});

test('寧心符陣：成功得到固定數值的進階飾品（靈魂傷害 +2、精神意志 +2），可裝備並進數值面板', () => {
  const s = mk({ inventory: { 寧神花: 6, 秘銀礦: 6 }, lifeSkills: { ...blankCharacter('x').lifeSkills, 鑄造: 10 } });
  const before = derivedStats(s);
  craftSpecial(s, '寧心符陣', 1, [], always(0.999));
  assert.equal(s.gear.length, 1);
  assert.equal(s.gear[0].name, '寧心符陣');
  assert.equal(equip(s, s.gear[0].id, 'acc1'), null);
  const after = derivedStats(s);
  assert.equal(after.靈魂傷害.total - before.靈魂傷害.total, 2);
  assert.equal(after.精神意志.total - before.精神意志.total, 2);
});

test('花雕怪味魚滴露：使用後得初階技能感悟 ×10', () => {
  const s = mk({ inventory: { 花雕怪味魚滴露: 1 } });
  assert.equal(useSpecialItem(s, '花雕怪味魚滴露').ok, true);
  assert.equal(s.inventory.初階技能感悟, 10);
  assert.equal(useSpecialItem(s, '花雕怪味魚滴露').ok, false);
  assert.equal(useSpecialItem(s, '鐵礦石').ok, false);
});

test('特殊材料：每天每種 1 次，數量＝1D20＋加值；福瑞毛只能用社交；換日重置', () => {
  const s = mk({ lifeSkills: { ...blankCharacter('x').lifeSkills, 釣魚: 3 } });
  const r = gatherDaily(s, '南夢水', '釣魚', always(0.5)); // d20 = 11，加值 3 + 熟練 1
  assert.equal(r.ok, true);
  assert.equal(r.total, 11 + 3 + 1);
  assert.equal(s.inventory.南夢水, r.total);
  assert.equal(gatherDaily(s, '南夢水', '釣魚').ok, false);
  assert.equal(gatherDaily(s, '福瑞毛', '釣魚').ok, false);
  assert.equal(gatherDaily(s, '福瑞毛', '社交', always(0)).ok, true);
  newDay(s);
  assert.equal(gatherDaily(s, '南夢水', '釣魚', always(0)).ok, true);
});

test('餵肉球與收割：階級決定肉量，5 肉 → 1 怪物肉', () => {
  const s = mk({ inventory: { 綠草藥: 5, 寧神花: 2, 隕星石: 1 } });
  assert.equal(feedMeatball(s, '綠草藥', 5).meat, 5);
  assert.equal(feedMeatball(s, '寧神花', 2).meat, 6);
  assert.equal(feedMeatball(s, '隕星石', 1).meat, 75);
  assert.equal(feedMeatball(s, '鐵礦石', 1).ok, false);
  assert.equal(s.inventory[MEAT], 86);
  assert.equal(harvestMeat(s, 17).ok, true);
  assert.equal(s.inventory[MONSTER_MEAT], 17);
  assert.equal(s.inventory[MEAT], 1);
  assert.equal(harvestMeat(s, 1).ok, false);
});

test('惜未央：吃下 +1 時間，每次刷新最多 2 次，換日重置；熟練 +2', () => {
  const s = mk({ time: 3, inventory: { 惜未央: 5 } });
  assert.equal(eat(s, '惜未央', 'rest'), null);
  eat(s, '惜未央', 'rest');
  s.restStomach = [];
  eat(s, '惜未央', 'rest');
  assert.equal(s.time, 5); // 只有前兩次加時間
  newDay(s);
  s.restStomach = [];
  eat(s, '惜未央', 'rest');
  assert.equal(s.time, 10 + 1); // 換日回到 10，再吃 +1
});

test('動物春藥：回復 40% 魔力、毒性 +2，不超過最大值', () => {
  const s = mk({ inventory: { 動物春藥: 2 }, baseStats: { ...blankCharacter('x').baseStats, 魔力: 100 }, resources: { ...blankCharacter('x').resources, 魔力: 0 } });
  const r = drinkPotion(s, '動物春藥');
  assert.equal(r.restored.魔力, 40);
  assert.equal(s.resources.魔力, 40);
  assert.equal(s.toxicity, 2);
  s.resources.魔力 = 90;
  drinkPotion(s, '動物春藥');
  assert.equal(s.resources.魔力, 100);
});

test('配方表：10 個特殊配方，材料與 DC 照規則原文', () => {
  assert.equal(Object.keys(SPECIAL_RECIPES).length, 10);
  assert.deepEqual(SPECIAL_RECIPES.動物春藥.materials, { 怪物肉: 12, 不穩定能量: 12, 福瑞毛: 12 });
  assert.equal(SPECIAL_RECIPES.福瑞保溫針織袋.dc, 40);
  assert.equal(SPECIAL_RECIPES.傳說重塑魔方.materials.不穩定能量, 16);
});
