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
