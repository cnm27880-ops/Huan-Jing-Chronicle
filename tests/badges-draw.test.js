// 徽章、抽取技能書、學習門檻
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { badgeStatus, craftBadge, renameBadge, badgeName } from '../src/game/badges.js';
import { drawBooks, chooseDraw, drawPool, hasPendingDraw } from '../src/game/skillDraw.js';
import { upgradePlan, upgradeSkillTo } from '../src/game/skillTable.js';
import { gather, craft } from '../src/game/engine.js';
import { SKILL_TABLE } from '../src/data/skills.js';

const mk = (extra = {}) => ({ ...blankCharacter('測試'), statMode: 'skills', ...extra });
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('徽章：500 次達標才能做，做了技能 +1、徽章進背包、不能重複', () => {
  const s = mk({ counters: { ...blankCharacter('x').counters, 釣魚: 499 }, lifeSkills: { ...blankCharacter('x').lifeSkills, 釣魚: 17 } });
  assert.equal(craftBadge(s, '釣魚', '500次').ok, false);
  s.counters.釣魚 = 500;
  const r = craftBadge(s, '釣魚', '500次');
  assert.equal(r.ok, true);
  assert.equal(s.lifeSkills.釣魚, 18);
  assert.equal(s.inventory[badgeName('釣魚', '500次')], 1);
  assert.equal(craftBadge(s, '釣魚', '500次').ok, false);
  assert.equal(s.lifeSkills.釣魚, 18);
});

test('徽章：背包已有徽章物品（機器人匯入）視為做過，不重複加等級', () => {
  const s = mk({ inventory: { '【寒江問道一蓑翁】500次釣魚': 1 } });
  s.counters.釣魚 = 692;
  assert.equal(badgeStatus(s, '釣魚').find((b) => b.kind === '500次').made, true);
  assert.equal(craftBadge(s, '釣魚', '500次').ok, false);
});

test('徽章：採集擲出神級、製作出神級才算達到神級', () => {
  const s = mk({ time: 10 });
  gather(s, '釣魚', 1, [], () => 0.999); // d20 = 20，加值 0 → 總分 20，不是神級
  assert.equal(Boolean(s.godReached?.釣魚), false);
  s.lifeSkills.釣魚 = 40; // 加值夠高 → 神級
  gather(s, '釣魚', 1, [], () => 0.999);
  assert.equal(s.godReached.釣魚, true);
  const c = mk({ inventory: { 傳說技能書: 6 }, lifeSkills: { ...blankCharacter('x').lifeSkills, 書寫: 60 } });
  craft(c, '書寫', '神級', 1, [], () => 0.999);
  assert.equal(c.godReached.書寫, true);
});

test('抽取：扣書、每本 3 個不重複選項、選了拿同名書；沒選完不能再抽', () => {
  const s = mk({ inventory: { 進階技能書: 5 } });
  assert.equal(drawBooks(s, '進階', 6).ok, false);
  assert.equal(drawBooks(s, '進階', 2).ok, true);
  assert.equal(s.inventory.進階技能書, 3);
  assert.equal(s.pendingDraws.length, 2);
  assert.ok(s.pendingDraws.every((d) => new Set(d.options).size === 3 && d.options.every((n) => SKILL_TABLE[n].tier === '進階')));
  assert.equal(drawBooks(s, '進階', 1).ok, false);
  const pick = s.pendingDraws[0].options[1];
  assert.equal(chooseDraw(s, 0, pick).ok, true);
  assert.equal(s.inventory[pick], 1);
  assert.equal(chooseDraw(s, 5, pick).ok, false);
  assert.equal(chooseDraw(s, 0, '不存在').ok, false);
  chooseDraw(s, 0, s.pendingDraws[0].options[0]);
  assert.equal(hasPendingDraw(s), false);
});

test('抽取：技能池不含個人專屬技能', () => {
  assert.ok(!drawPool('初階').includes('奶龍寶庫'));
  assert.ok(drawPool('傳說').length > 3);
});

test('學習門檻：進階要累計花費 3000、大師 13000、傳說 33000；初階不用；升級不看門檻', () => {
  const adv = Object.keys(SKILL_TABLE).find((n) => SKILL_TABLE[n].tier === '進階');
  const s = mk({ exp: 99999, spentExp: 2999, inventory: { [adv]: 3 } });
  const p = upgradePlan(s, adv, 1);
  assert.equal(p.ok, false);
  assert.equal(p.missing['累計花費經驗門檻'], 1);
  assert.equal(upgradeSkillTo(s, adv, 1).ok, false);
  s.spentExp = 3000;
  assert.equal(upgradeSkillTo(s, adv, 1).ok, true);
  const master = Object.keys(SKILL_TABLE).find((n) => SKILL_TABLE[n].tier === '大師');
  assert.equal(upgradePlan(mk({ exp: 99999, spentExp: 12999 }), master, 1).gate.need, 13000);
  const first = Object.keys(SKILL_TABLE).find((n) => SKILL_TABLE[n].tier === '初階');
  assert.equal(upgradePlan(mk({ exp: 99999 }), first, 1).missing['累計花費經驗門檻'], undefined);
  // 已學會之後升級不看門檻
  const lv1 = mk({ exp: 99999, spentExp: 0, skills: { [adv]: 1 }, inventory: { 進階技能書: 2 } });
  assert.equal(upgradeSkillTo(lv1, adv, 2).ok, true);
});

test('徽章改名：製作時可自訂、之後可改，背包裡的徽章跟著改名；不能和別的東西同名', () => {
  const s = mk({ inventory: { 鐵礦石: 3 } });
  s.counters.釣魚 = 500;
  assert.equal(craftBadge(s, '釣魚', '500次', '鐵礦石').ok, false); // 撞名
  assert.equal(craftBadge(s, '釣魚', '500次', '   ').ok, false);
  assert.equal(craftBadge(s, '釣魚', '500次', 'x'.repeat(21)).ok, false);
  assert.equal(s.lifeSkills.釣魚, 0);
  assert.equal(craftBadge(s, '釣魚', '500次', '我的釣魚章').ok, true);
  assert.equal(s.inventory['我的釣魚章'], 1);
  assert.equal(s.lifeSkills.釣魚, 1);
  assert.equal(badgeStatus(s, '釣魚')[1].made, true);
  assert.equal(renameBadge(s, '釣魚', '500次', '鐵礦石').ok, false);
  assert.equal(renameBadge(s, '釣魚', '500次', '釣神之章').ok, true);
  assert.equal(s.inventory['釣神之章'], 1);
  assert.equal(s.inventory['我的釣魚章'], undefined);
  assert.equal(s.lifeSkills.釣魚, 1); // 改名不再加等級
});

test('徽章改名：機器人匯入的預設名徽章也能改，且不會被當成沒做過', () => {
  const s = mk({ inventory: { '【寒江問道一蓑翁】500次釣魚': 1 } });
  s.counters.釣魚 = 692;
  assert.equal(renameBadge(s, '釣魚', '500次', '老漁夫').ok, true);
  assert.equal(s.inventory['老漁夫'], 1);
  assert.equal(s.inventory['【寒江問道一蓑翁】500次釣魚'], undefined);
  assert.equal(badgeStatus(s, '釣魚')[1].made, true);
  assert.equal(craftBadge(s, '釣魚', '500次').ok, false);
});
