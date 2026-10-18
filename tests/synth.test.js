// 合成（強效藥水、套餐）、神級滴露、神級料理：GM 定案 2026-10-19，數字照抄
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { SYNTH_RECIPES, POTIONS, FOODS, FOOD_STATS, CLEANSE_ITEMS, RECIPES } from '../src/game/rules.js';
import { synthMaxTimes, craftSynth } from '../src/game/synth.js';
import { eat, endSession } from '../src/game/engine.js';
import { drinkPotion, useCleanse, giveHealPotion } from '../src/game/combat.js';
import { derivedStats } from '../src/game/stats.js';
import { proficiency } from '../src/game/engine.js';

const mk = (extra = {}) => ({ ...blankCharacter('測試'), ...extra });
const skills = (o) => ({ ...blankCharacter('x').lifeSkills, ...o });
const always = (v) => () => v; // 0.999 → d20 = 20；0 → d20 = 1

test('配方表：8 個強效藥水與 4 個套餐的 DC、材料照 GM 定案', () => {
  const potions = [['強效黃藥水', '黃藥水', 30], ['強效綠藥水', '綠藥水', 30], ['強效強擊藥', '強擊藥', 35], ['強效堅盾藥', '堅盾藥', 35],
    ['強效狂暴湯', '狂暴湯', 40], ['強效玄武湯', '玄武湯', 40], ['強效力量泉', '力量泉', 45], ['強效抗性泉', '抗性泉', 45]];
  for (const [n, base, dc] of potions) {
    assert.equal(SYNTH_RECIPES[n].skill, '調劑');
    assert.equal(SYNTH_RECIPES[n].dc, dc);
    assert.deepEqual(SYNTH_RECIPES[n].materials, { [base]: 6, 福瑞毛: 12 });
  }
  assert.deepEqual(SYNTH_RECIPES.碳水炸彈套餐.materials, { 炒飯: 3, 拉麵: 3, 怪物肉: 6 });
  assert.deepEqual(SYNTH_RECIPES.小確幸套餐.materials, { 什錦飯: 3, 大肉棒: 3, 怪物肉: 6 });
  assert.deepEqual(SYNTH_RECIPES.大土豪套餐.materials, { 豪華蓋飯: 3, 碳烤肉排: 3, 怪物肉: 6 });
  assert.deepEqual(SYNTH_RECIPES.尊爵不凡套餐.materials, { 滿漢全席: 3, 傳奇盛宴: 3, 怪物肉: 6 });
  assert.deepEqual(['碳水炸彈套餐', '小確幸套餐', '大土豪套餐', '尊爵不凡套餐'].map((n) => SYNTH_RECIPES[n].dc), [35, 35, 45, 45]);
  assert.ok(Object.values(SYNTH_RECIPES).filter((x) => x.type === '套餐').every((x) => x.skill === '烹飪'));
  assert.ok(Object.keys(SYNTH_RECIPES).every((n) => n in POTIONS || n in FOODS));
});

test('強效藥水合成：成功得 1 瓶、扣材料、不算進 500 次、算一次修整檢定', () => {
  const s = mk({ inventory: { 黃藥水: 12, 福瑞毛: 24 }, lifeSkills: skills({ 調劑: 20 }) });
  s.restStomach = [{ food: '拉麵', left: 10 }];
  assert.equal(synthMaxTimes(s, '強效黃藥水'), 2);
  const r = craftSynth(s, '強效黃藥水', 5, [], always(0.999)); // 20 + 20 + 熟練 ≥ 30；只夠 2 次
  assert.equal(r.rolls.length, 2);
  assert.ok(r.rolls.every((x) => x.success));
  assert.equal(s.inventory.強效黃藥水, 2);
  assert.equal(s.inventory.黃藥水, undefined);
  assert.equal(s.inventory.福瑞毛, undefined);
  assert.equal(s.counters.調劑 ?? 0, 0); // 合成不計入 500 次徽章
  assert.equal(s.restStomach[0].left, 8); // 兩次修整檢定
});

test('強效藥水合成失敗：材料全毀、沒有成品；DC 邊界', () => {
  const f = mk({ inventory: { 力量泉: 6, 福瑞毛: 12 }, lifeSkills: skills({ 調劑: 0 }) });
  const bad = craftSynth(f, '強效力量泉', 1, [], always(0)); // 1 + 0 + 熟練 1 < 45
  assert.equal(bad.rolls[0].success, false);
  assert.equal(f.inventory.強效力量泉, undefined);
  assert.equal(f.inventory.力量泉, undefined);
  assert.equal(f.inventory.福瑞毛, undefined);
  const e = mk({ inventory: { 黃藥水: 6, 福瑞毛: 12 }, lifeSkills: skills({ 調劑: 29 }) }); // 擲 1：1 + 29 + 熟練 1 = 31 ≥ 30
  assert.equal(craftSynth(e, '強效黃藥水', 1, [], always(0)).rolls[0].success, true);
  const g = mk({ inventory: { 黃藥水: 6, 福瑞毛: 12 }, lifeSkills: skills({ 調劑: 27 }) }); // 1 + 27 + 1 = 29 < 30
  assert.equal(craftSynth(g, '強效黃藥水', 1, [], always(0)).rolls[0].success, false);
});

test('材料不足：一份都不能合成，什麼都不扣；少一種也不行', () => {
  const s = mk({ inventory: { 黃藥水: 6, 福瑞毛: 11 } });
  assert.equal(synthMaxTimes(s, '強效黃藥水'), 0);
  const r = craftSynth(s, '強效黃藥水', 3, [], always(0.999));
  assert.equal(r.rolls.length, 0);
  assert.equal(s.inventory.黃藥水, 6);
  assert.equal(s.inventory.福瑞毛, 11);
  const m = mk({ inventory: { 炒飯: 3, 拉麵: 3, 怪物肉: 5 } });
  assert.equal(synthMaxTimes(m, '碳水炸彈套餐'), 0);
});

test('套餐合成：成功得 1 份、失敗全毀、不計 500 次', () => {
  const s = mk({ inventory: { 炒飯: 6, 拉麵: 6, 怪物肉: 12 }, lifeSkills: skills({ 烹飪: 30 }) });
  const r = craftSynth(s, '碳水炸彈套餐', 2, [], always(0.999));
  assert.equal(r.rolls.filter((x) => x.success).length, 2);
  assert.equal(s.inventory.碳水炸彈套餐, 2);
  assert.equal(s.inventory.怪物肉, undefined);
  assert.equal(s.counters.烹飪 ?? 0, 0);
  const f = mk({ inventory: { 滿漢全席: 3, 傳奇盛宴: 3, 怪物肉: 6 } });
  assert.equal(craftSynth(f, '尊爵不凡套餐', 1, [], always(0)).rolls[0].success, false);
  assert.equal(f.inventory.尊爵不凡套餐, undefined);
  assert.equal(f.inventory.滿漢全席, undefined);
});

test('合成可以用紀念品（加值型），「非配方的困難」型不適用', () => {
  const s = mk({
    inventory: { 黃藥水: 6, 福瑞毛: 12, 門門的採藥心得: 1, 彌月思念的書信: 1 },
    lifeSkills: skills({ 調劑: 0 }),
    keepsakes: { 門門的採藥心得: { scope: ['採藥'], bonus: 5 }, 彌月思念的書信: { scope: ['調劑'], bonus: 5, diff: ['困難'] } },
  });
  const r = craftSynth(s, '強效黃藥水', 1, ['門門的採藥心得', '彌月思念的書信'], always(0));
  assert.deepEqual(r.rolls[0].used, []); // 前者技能不符、後者有難度限制
  const t = mk({ inventory: { 黃藥水: 6, 福瑞毛: 12, 調劑心得: 1 }, lifeSkills: skills({ 調劑: 0 }), keepsakes: { 調劑心得: { scope: ['調劑'], bonus: 4 } } });
  const r2 = craftSynth(t, '強效黃藥水', 1, ['調劑心得'], always(0));
  assert.deepEqual(r2.rolls[0].used, ['調劑心得']);
  assert.equal(r2.rolls[0].mod, 0 + 1 + 4); // 技能 0 + 熟練 1 + 紀念品 4
  assert.equal(t.inventory.調劑心得, undefined);
});

test('新食物的數值進面板與熟練（只算跑團胃袋）', () => {
  const stats = (food) => { const s = mk({ inventory: { [food]: 1 } }); assert.equal(eat(s, food, 'session'), null); return s; };
  const a = stats('碳水炸彈套餐');
  assert.equal(derivedStats(a).生命.parts.find((p) => p.label === '食物').value, 40);
  assert.equal(derivedStats(a).真實傷害.parts.find((p) => p.label === '食物').value, 5);
  assert.equal(derivedStats(a).絕對防禦.parts.find((p) => p.label === '食物').value, 5);
  const b = stats('大土豪套餐');
  assert.deepEqual([60, 7, 7], [derivedStats(b).生命, derivedStats(b).真實傷害, derivedStats(b).絕對防禦].map((x) => x.parts.find((p) => p.label === '食物').value));
  const c = stats('汙濁饗宴');
  assert.deepEqual([100, 10, 10], [derivedStats(c).生命, derivedStats(c).真實傷害, derivedStats(c).絕對防禦].map((x) => x.parts.find((p) => p.label === '食物').value));
  assert.equal(FOOD_STATS.小確幸套餐, undefined);
  for (const [food, p] of [['小確幸套餐', 4], ['尊爵不凡套餐', 5], ['肉棒王宴', 6]]) {
    const s = stats(food);
    assert.equal(proficiency(s, 'session').total, 1 + p);
    assert.equal(proficiency(s, 'rest').total, 1); // 跑團胃袋的食物不影響修整
    assert.equal(s.sessionStomach.length, 1); // 占胃袋 1 格
  }
});

test('套餐比照一般食物：修整胃袋 10 次檢定', () => {
  const s = mk({ inventory: { 小確幸套餐: 1 } });
  assert.equal(eat(s, '小確幸套餐', 'rest'), null);
  assert.equal(s.restStomach[0].left, 10);
  assert.equal(proficiency(s, 'rest').total, 1 + 4);
});

test('神級滴露：神怒／神皮毒性 0，加成 +20；神愛毒性 1，回復 10D20', () => {
  assert.deepEqual(POTIONS.神怒滴露, { toxicity: 0, atk: 20 });
  assert.deepEqual(POTIONS.神皮滴露, { toxicity: 0, def: 20 });
  assert.deepEqual(POTIONS.神愛滴露, { toxicity: 1, heal: { n: 10, sides: 20 } });
  const s = mk({ inventory: { 神怒滴露: 1, 神皮滴露: 1, 神愛滴露: 1 }, hp: 5 });
  drinkPotion(s, '神怒滴露');
  drinkPotion(s, '神皮滴露');
  assert.equal(s.buffs.atk, 20);
  assert.equal(s.buffs.def, 20);
  assert.equal(s.toxicity, 0);
  const r = drinkPotion(s, '神愛滴露', () => 0.99); // 10 顆 D20 全擲 20
  assert.equal(r.dice, '10D20');
  assert.equal(r.rolled, 200);
  assert.equal(s.toxicity, 1);
  assert.equal(s.hp, 5 + r.healed);
});

test('神愛滴露可以餵隊友（當一般回復藥水），毒性算對方', () => {
  const giver = mk({ inventory: { 神愛滴露: 1 } });
  const target = mk({ hp: 1 });
  const r = giveHealPotion(giver, target, '神愛滴露', () => 0.99);
  assert.equal(r.rolled, 200);
  assert.equal(target.toxicity, 1);
  assert.equal(giver.toxicity, 0);
  assert.equal(giver.inventory.神愛滴露, undefined);
});

test('強效藥水與原藥水是不同名稱：加成相加；同名仍取代', () => {
  const s = mk({ inventory: { 狂暴湯: 2, 強效狂暴湯: 2 } });
  drinkPotion(s, '狂暴湯');
  drinkPotion(s, '強效狂暴湯');
  assert.equal(s.buffs.atk, 5 + 15);
  drinkPotion(s, '強效狂暴湯');
  assert.equal(s.buffs.atk, 20);
  assert.equal(s.toxicity, 3);
});

test('純潔聖宴：清除所有毒素、扣背包；毒性為 0 不能用；不進胃袋', () => {
  assert.ok('純潔聖宴' in CLEANSE_ITEMS);
  assert.ok(!('純潔聖宴' in FOODS) && !('純潔聖宴' in POTIONS)); // 是料理，不是藥水，也不是胃袋食物
  assert.ok(RECIPES.烹飪.神級.rewards.includes('純潔聖宴'));
  const s = mk({ inventory: { 純潔聖宴: 2 }, toxicity: 11 });
  const r = useCleanse(s, '純潔聖宴');
  assert.equal(r.cleared, 11);
  assert.equal(s.toxicity, 0);
  assert.equal(s.inventory.純潔聖宴, 1);
  assert.match(useCleanse(s, '純潔聖宴').error, /毒性已經是 0/);
  assert.equal(s.inventory.純潔聖宴, 1); // 被擋下不消耗
  assert.equal(s.sessionStomach.length + s.restStomach.length, 0);
  assert.ok(eat(s, '純潔聖宴', 'session')); // 吃不了（回傳錯誤訊息）
  assert.match(useCleanse(mk({ toxicity: 3 }), '純潔聖宴').error, /背包裡沒有/);
  assert.match(useCleanse(s, '回春湯').error, /不能這樣使用/);
});
