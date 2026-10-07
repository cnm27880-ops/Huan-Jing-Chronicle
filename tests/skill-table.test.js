// 執行方式：npm test
// 技能目錄與技能數值（src/game/skillTable.js、stats.js 的 skills 模式）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_TABLE, EXP_TABLE, skillFx, skillParts, needsActivation, inCatalog } from '../src/game/skillTable.js';
import { derivedStats } from '../src/game/stats.js';
import { passivesOf } from '../src/game/skills.js';
import { proficiency } from '../src/game/engine.js';
import { blankCharacter } from '../src/game/importBot.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const mk = (skills, extra = {}) => ({ ...blankCharacter('測試'), statMode: 'skills', skills, ...extra });

test('目錄：117 個技能、每個 10 級；啟動類只有 7 個武裝；升級經驗表有四個位階', () => {
  const names = Object.keys(SKILL_TABLE);
  assert.equal(names.length, 117);
  assert.ok(names.every((n) => SKILL_TABLE[n].fx.length === 10));
  assert.deepEqual(names.filter(needsActivation).sort(), ['天罰B型武裝', '幽影A型武裝', '海妖AC型武裝', '烈陽AB型武裝', '終焉武裝', '虛空BC型武裝', '霓幻C型武裝']);
  assert.deepEqual(Object.keys(EXP_TABLE), ['初階', '進階', '大師', '傳說']);
  assert.deepEqual(EXP_TABLE.初階.slice(0, 3), [30, 60, 100]);
  assert.ok(inCatalog('山脈愚者') && inCatalog('老狗識途') && !inCatalog('鬥氣化虹'));
});

test('技能數值是累積值：引氣訣 1／4／10 級（取自試算表「後台_技能計算」）', () => {
  assert.deepEqual(skillFx('引氣訣', 1), { 能量傷害: 1, 靈氣: 1 });
  assert.deepEqual(skillFx('引氣訣', 4), { 物理傷害: 1, 能量傷害: 1, 靈氣: 4 });
  assert.deepEqual(skillFx('引氣訣', 10), { 物理傷害: 2, 能量傷害: 2, 靈氣: 10, 真實傷害: 1, 絕對防禦: 1 });
  assert.deepEqual(skillFx('引氣訣', 0), {}); // 0 級沒有效果
  assert.deepEqual(skillFx('引氣訣', 99), skillFx('引氣訣', 10)); // 超過上限當 10
  assert.deepEqual(skillFx('不存在的技能', 5), {});
});

test('skills 模式：數值 = 基礎 + 技能 + 手動調整 + 裝備 + 食物，每一項都有明細', () => {
  const s = mk({ 引氣訣: 4, 煉體築基篇: 7 }, { adjust: { 物理傷害: 10, 生命: -5 }, baseStats: { ...blankCharacter('x').baseStats, 物理傷害: 3 } });
  const d = derivedStats(s);
  assert.equal(d.物理傷害.total, 3 + 1 + 2 + 10); // 基礎 + 引氣訣 + 煉體築基篇 + 手動
  assert.deepEqual(d.物理傷害.parts.map((p) => p.label), ['基礎', '引氣訣', '煉體築基篇', '手動調整']);
  assert.equal(d.靈氣.total, 4);
  assert.equal(d.生命.parts.find((p) => p.label === '手動調整').value, -5);
});

test('0 級的技能沒有加成；技能等級變高數值跟著變', () => {
  const s = mk({ 引氣訣: 0 });
  assert.equal(derivedStats(s).靈氣.total, 0);
  s.skills.引氣訣 = 10;
  assert.equal(derivedStats(s).靈氣.total, 10);
});

test('舊存檔（沒有 statMode）完全不受影響：技能與手動調整都不重複計算', () => {
  const legacy = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  const before = JSON.stringify(derivedStats(legacy));
  legacy.adjust = { 物理傷害: 999 };
  legacy.skills = { ...legacy.skills, 引氣訣: 10 };
  assert.equal(JSON.stringify(derivedStats(legacy)), before);
});

test('啟動類技能（武裝）：沒啟動沒有數值；啟動後有數值並扣算力上限', () => {
  const s = mk({ 烈陽AB型武裝: 1 }, { baseStats: { ...blankCharacter('x').baseStats, 算力: 50 } });
  assert.equal(derivedStats(s).生命.total, 0);
  assert.equal(derivedStats(s).算力.total, 50);
  s.skillOn = { 烈陽AB型武裝: true };
  const d = derivedStats(s);
  assert.equal(d.生命.total, 2); assert.equal(d.物理傷害.total, 1); assert.equal(d.抗性免疫.total, 1);
  assert.equal(d.算力.total, 50 - 30);
  assert.ok(d.算力.parts.some((p) => p.label === '烈陽AB型武裝（啟動）' && p.value === -30));
});

test('算力上限不能被扣成負數（扣到 0 為止）；多個武裝依序扣', () => {
  const s = mk({ 烈陽AB型武裝: 1, 終焉武裝: 1 }, { skillOn: { 烈陽AB型武裝: true, 終焉武裝: true }, baseStats: { ...blankCharacter('x').baseStats, 算力: 40 } });
  const d = derivedStats(s);
  assert.equal(d.算力.total, 0); // 40 − 30（烈陽）→ 10，終焉要扣 60 只能扣到 0
  assert.deepEqual(d.算力.parts.filter((p) => p.value < 0).map((p) => p.value), [-30, -10]);
  const none = mk({ 烈陽AB型武裝: 1 }, { skillOn: { 烈陽AB型武裝: true } }); // 算力本來就是 0：不扣
  assert.equal(derivedStats(none).算力.total, 0);
  assert.ok(!derivedStats(none).算力.parts.some((p) => p.value < 0));
});

test('終焉武裝的「無視絕對防禦」要啟動才有（skills 模式）；舊存檔照舊', () => {
  assert.equal(passivesOf(mk({ 終焉武裝: 3 })).ignoreAbs, false);
  assert.equal(passivesOf(mk({ 終焉武裝: 3 }, { skillOn: { 終焉武裝: true } })).ignoreAbs, true);
  assert.equal(passivesOf({ skills: { 終焉武裝: 3 } }).ignoreAbs, true); // 舊存檔
});

test('技能提供的熟練會加進熟練（skills 模式）', () => {
  const withProf = Object.entries(SKILL_TABLE).find(([, t]) => t.fx.some((f) => f.熟練));
  if (!withProf) return; // 目錄裡沒有熟練技能就略過
  const [name, t] = withProf;
  const lv = t.fx.findIndex((f) => f.熟練) + 1;
  const s = mk({ [name]: lv });
  assert.ok(proficiency(s, 'rest').total > proficiency(mk({}), 'rest').total);
});

test('skillParts 只在 skills 模式有內容', () => {
  assert.deepEqual(skillParts({ skills: { 引氣訣: 4 } }), {});
  assert.ok(skillParts(mk({ 引氣訣: 4 })).靈氣);
});

// ---------- 愚者對調與技能升級 ----------
import { setSkillLevel, upgradeSkill, upgradeSkillTo, upgradePlan, maxAffordableLevel, upgradeCost, markSwapsDone } from '../src/game/skillTable.js';

test('愚者：升到 1 級先加屬性再對調，差額記進手動調整，同一級不重複', () => {
  const s = mk({}, { baseStats: { ...blankCharacter('x').baseStats, 體魄強韌: 10, 物理傷害: 30 } });
  const swaps = setSkillLevel(s, '山脈愚者', 1);
  assert.equal(swaps.length, 1);
  // 1 級：體魄強韌 10+4=14、物理 30 → 對調後 體魄 30、物理 14
  const d = derivedStats(s);
  assert.equal(d.體魄強韌.total, 30);
  assert.equal(d.物理傷害.total, 14);
  assert.deepEqual(s.swapDone.山脈愚者, [1]);
  assert.equal(setSkillLevel(s, '山脈愚者', 1).length, 0);
  setSkillLevel(s, '山脈愚者', 0); // 往下調不撤銷
  assert.equal(derivedStats(s).體魄強韌.total, 30 - 4);
});

test('愚者：一次跳到 10 級會依序對調 1、5、10 三次', () => {
  const s = mk({});
  assert.equal(setSkillLevel(s, '太陽愚者', 10).length, 3);
  assert.deepEqual(s.swapDone.太陽愚者, [1, 5, 10]);
  assert.equal(s.skills.太陽愚者, 10);
});

test('已學會的愚者匯入時標記已對調；舊存檔不對調', () => {
  const s = mk({ 夢境愚者: 6 });
  markSwapsDone(s, '夢境愚者', 6);
  assert.deepEqual(s.swapDone.夢境愚者, [1, 5]);
  const old = { ...blankCharacter('舊'), skills: {} };
  assert.equal(setSkillLevel(old, '山脈愚者', 10).length, 0);
});

test('升級：付單次經驗與技能書、記 spentExp；材料不足或滿級不動', () => {
  const s = mk({}, { exp: 100, spentExp: 5, inventory: { 八卦掌: 3, 初階技能書: 2 } });
  assert.equal(upgradeCost(s, '八卦掌'), 30);
  const a = upgradeSkill(s, '八卦掌'); // 0→1 付 30 經驗 + 3 本同名書
  assert.equal(a.ok, true);
  assert.equal(s.inventory.八卦掌, undefined);
  const b = upgradeSkill(s, '八卦掌'); // 1→2 付 60 經驗 + 2 本初階書
  assert.equal(b.ok, true);
  assert.equal(s.inventory.初階技能書, undefined);
  assert.equal(s.exp, 10);
  assert.equal(s.spentExp, 95);
  const r = upgradeSkill(s, '八卦掌');
  assert.equal(r.ok, false);
  assert.equal(s.skills.八卦掌, 2);
  const max = mk({ 八卦掌: 10 }, { exp: 9999 });
  assert.equal(upgradeSkill(max, '八卦掌').ok, false);
});

test('一次升到滿級：總共 3 + 2~10 = 57 本書，經驗 = 各級費用加總；不夠就一樣都不扣', () => {
  const plan = upgradePlan(mk({}, { exp: 0 }), '八卦掌', 10);
  assert.equal(plan.books.八卦掌, 3);
  assert.equal(plan.books.初階技能書, 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10);
  assert.equal(plan.exp, 30 + 60 + 100 + 150 + 210 + 280 + 360 + 450 + 550 + 660);
  assert.equal(plan.ok, false);
  const poor = mk({}, { exp: 99999, inventory: { 八卦掌: 3, 初階技能書: 53 } }); // 少 1 本
  assert.equal(upgradeSkillTo(poor, '八卦掌', 10).ok, false);
  assert.equal(poor.exp, 99999);
  assert.equal(poor.inventory.初階技能書, 53);
  assert.equal(maxAffordableLevel(poor, '八卦掌'), 9);
  poor.inventory.初階技能書 = 54;
  assert.equal(upgradeSkillTo(poor, '八卦掌', 10).level, 10);
  assert.equal(poor.skills.八卦掌, 10);
});
