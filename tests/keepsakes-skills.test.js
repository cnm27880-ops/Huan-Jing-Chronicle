// 紀念品目錄、技能表自動產生的招式、徽章（表情符號名稱、手動標記已做過）
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { KEEPSAKES, syncKeepsakes } from '../src/game/keepsakes.js';
import { gather, craft, addItem, countOf, modifier, useKeepsake, sessionCheck } from '../src/game/engine.js';
import { craftSpecial } from '../src/game/special.js';
import { generatedAttack, bindableSkills, moveFromCatalog, moveExtra } from '../src/game/skills.js';
import { badgeStatus, craftBadge, markBadgeOwned, renameBadge, syncBadgeMade } from '../src/game/badges.js';

const mk = (extra = {}) => ({ ...blankCharacter('測試'), statMode: 'skills', ...extra });
const hi = () => 0.99; // d20 擲 20
const lo = () => 0;    // d20 擲 1

test('紀念品：13 種都有目錄；背包有同名物品時效果自動補上', () => {
  assert.equal(Object.keys(KEEPSAKES).length, 13);
  const s = mk({ inventory: { 臉哥的創意點子: 2, 隨便物品: 1 } });
  assert.deepEqual(syncKeepsakes(s), ['臉哥的創意點子']);
  assert.equal(s.keepsakes.臉哥的創意點子.bonus, 5);
  const t = mk();
  addItem(t, '門門的採藥心得', 3); // 放進背包也會補上
  assert.equal(t.keepsakes.門門的採藥心得.scope[0], '採藥');
});

test('紀念品：非配方的困難鑄造 +5 且產出雙倍；其他難度與特殊配方不適用', () => {
  const s = mk({ inventory: { 奧利哈鋼: 12, 臉哥的創意點子: 3 } });
  syncKeepsakes(s);
  s.lifeSkills.鑄造 = 0;
  const hard = craft(s, '鑄造', '困難', 1, ['臉哥的創意點子'], hi);
  assert.equal(hard.rolls[0].parts.some((p) => p.label === '臉哥的創意點子' && p.value === 5), true);
  assert.equal(hard.rolls[0].used.length, 1);
  assert.equal(Object.values(hard.loot).reduce((a, b) => a + b, 0), 2); // 鑄造一次本來 1 個 → 雙倍 2 個
  assert.equal(countOf(s, '臉哥的創意點子'), 2);
  // 換難度：不消耗、不加值
  s.inventory.秘銀礦 = 6;
  const normal = craft(s, '鑄造', '普通', 1, ['臉哥的創意點子'], hi);
  assert.equal(normal.rolls[0].used.length, 0);
  assert.equal(countOf(s, '臉哥的創意點子'), 2);
  assert.equal(modifier(s, '鑄造', 'rest', ['臉哥的創意點子'], { kind: 'special' }).parts.length, 2); // 技能＋熟練，沒有紀念品
});

test('紀念品：微光只讓史詩製作產出雙倍（沒有加值）；技能不符不能用', () => {
  const s = mk({ inventory: { 傳說肉: 6, 微光的不定型擴容陣列: 1 } });
  syncKeepsakes(s);
  s.lifeSkills.烹飪 = 10; // 史詩 DC 25，擲 20 + 10 + 熟練 才過
  const r = craft(s, '烹飪', '史詩', 1, ['微光的不定型擴容陣列'], hi);
  assert.equal(r.rolls[0].doubled, true);
  assert.equal(Object.values(r.loot).reduce((a, b) => a + b, 0), 4); // 烹飪一次 2 個 → 4 個
  assert.equal(r.rolls[0].parts.length, 2); // 沒有紀念品加值
});

test('紀念品：採集用的（繃繃狗 +5 挖礦、掉毛喵 +3 釣魚）只對自己的技能有效', () => {
  const s = mk({ time: 10, inventory: { 掉毛喵的私人釣點: 1, 繃繃狗的爪爪: 1 } });
  syncKeepsakes(s);
  const g = gather(s, '釣魚', 1, ['掉毛喵的私人釣點', '繃繃狗的爪爪'], lo);
  assert.deepEqual(g.rolls[0].used, ['掉毛喵的私人釣點']);
  assert.equal(g.rolls[0].parts.find((p) => p.label === '掉毛喵的私人釣點').value, 3);
  assert.equal(countOf(s, '繃繃狗的爪爪'), 1);
});

test('紀念品：旅行青蛙的禮物給三種材料、加爾姆的專屬時間 +5 時間；張亮不能直接使用', () => {
  const s = mk({ time: 2, inventory: { 旅行青蛙的禮物: 1, 加爾姆的專屬時間: 1, 張亮的驚人發現: 1 } });
  syncKeepsakes(s);
  assert.equal(useKeepsake(s, '旅行青蛙的禮物').ok, true);
  assert.deepEqual([countOf(s, '永恆草'), countOf(s, '傳說肉'), countOf(s, '隕星石')], [10, 10, 10]);
  assert.equal(useKeepsake(s, '旅行青蛙的禮物').ok, false); // 用完了
  useKeepsake(s, '加爾姆的專屬時間');
  assert.equal(s.time, 7);
  assert.equal(useKeepsake(s, '張亮的驚人發現').ok, false);
  assert.equal(countOf(s, '張亮的驚人發現'), 1);
  assert.equal(craftSpecial(s, '不存在的配方', 1, ['張亮的驚人發現']).rolls.length, 0);
});

test('技能綁定：學過的主動技能（含技能表產生的）都能選', () => {
  const s = mk({ skills: { 八卦掌: 5, 爆裂火球: 9, 蕩魔雷音: 4, 呼吸法: 3, 吞天噬血陣: 5, 暴徒: 1, 暗影斗篷: 2 } });
  const names = bindableSkills(s);
  for (const n of ['八卦掌', '爆裂火球', '蕩魔雷音', '吞天噬血陣', '暴徒']) assert.equal(names.includes(n), true, n);
  assert.equal(names.includes('呼吸法'), false); // 純被動
  assert.equal(names.includes('暗影斗篷'), false); // 非傷害技能
  const fire = generatedAttack('爆裂火球');
  assert.deepEqual([fire.tracks, fire.cost, fire.targets], [['B'], { 魔力: 3 }, 1]);
  assert.deepEqual(fire.extraAt(9), { B: 7 }); // 響應 1、3、5、7、9 級 → 3、4、5、6、7 個
  assert.deepEqual(generatedAttack('蕩魔雷音').cost, { 靈氣: 3 });
  assert.equal(generatedAttack('蕩魔雷音').targets, 3);
  const mv = moveFromCatalog('爆裂火球');
  assert.equal(mv.cost.魔力, 3);
  assert.equal(moveExtra(s, mv).B, 7);
  assert.equal(moveFromCatalog('吞天噬血陣').cost.靈氣, 30); // 手寫目錄優先
});

test('徽章：機器人存檔的徽章名稱前面有表情符號也認得，不會再做一次', () => {
  const s = mk({ inventory: { '🎣【垂釣諸天太虛客】神級釣魚': 1, '❄️【寒江問道一蓑翁】500次釣魚': 1, '🍲我自己改的名字500次烹飪': 1, '【某某】500次鑄造': 1 } });
  s.counters.釣魚 = 692;
  s.godReached = { 釣魚: true };
  assert.equal(badgeStatus(s, '釣魚').every((b) => b.made), true);
  assert.equal(craftBadge(s, '釣魚', '神級').ok, false);
  assert.equal(craftBadge(s, '釣魚', '500次').ok, false);
  // 玩家自己改過稱號的：【稱號】＋「500次烹飪」
  s.inventory['🍲【改過的稱號】500次烹飪'] = 1;
  delete s.inventory['🍲我自己改的名字500次烹飪'];
  assert.equal(badgeStatus(s, '烹飪')[1].made, true);
  assert.equal(badgeStatus(s, '鑄造')[1].made, true);
  syncBadgeMade(s);
  delete s.inventory['🍲【改過的稱號】500次烹飪'];
  assert.equal(badgeStatus(s, '烹飪')[1].made, true); // 永久記住
  // 改名時帶表情符號的原物品一起搬，不會變兩個
  assert.equal(renameBadge(s, '釣魚', '500次', '老漁夫').ok, true);
  assert.equal(s.inventory['❄️【寒江問道一蓑翁】500次釣魚'], undefined);
  assert.equal(s.inventory.老漁夫, 1);
});

test('徽章：試算表自己加過等級、背包沒有物品 → 「我已經做過了」只記起來，不加等級', () => {
  const s = mk({ lifeSkills: { ...blankCharacter('x').lifeSkills, 書寫: 14 } });
  s.counters.書寫 = 501;
  assert.equal(badgeStatus(s, '書寫')[1].made, false);
  assert.equal(markBadgeOwned(s, '書寫', '500次').ok, true);
  assert.equal(s.lifeSkills.書寫, 14); // 沒加
  assert.equal(countOf(s, '【妙筆生花奪造化】500次書寫'), 0); // 沒放物品
  assert.equal(craftBadge(s, '書寫', '500次').ok, false);
  assert.equal(markBadgeOwned(s, '書寫', '500次').ok, false); // 重複標記
  assert.equal(markBadgeOwned(s, '書寫', '神級').ok, true); // 沒達標也能標記
  assert.equal(s.lifeSkills.書寫, 14);
});

test('紀念品：張亮的驚人發現＝跑團檢定優勢骰（兩顆 D20 取高）', () => {
  const s = mk({ inventory: { 張亮的驚人發現: 1 } });
  syncKeepsakes(s);
  assert.equal(s.keepsakes.張亮的驚人發現.advantage, true);
  const seqRng = (...v) => { let i = 0; return () => v[i++]; };
  const adv = sessionCheck(s, '運動', seqRng(0.0, 0.95), true); // 擲出 1 與 20
  assert.deepEqual(adv.rolls, [1, 20]);
  assert.equal(adv.roll, 20);
  assert.equal(adv.total, 20 + adv.mod);
  const normal = sessionCheck(s, '運動', seqRng(0.0), false);
  assert.equal(normal.rolls, undefined);
});
