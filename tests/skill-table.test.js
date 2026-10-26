// 執行方式：npm test
// 技能目錄與技能數值（src/game/skillTable.js、stats.js 的 skills 模式）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_TABLE, EXP_TABLE, skillFx, skillParts, needsActivation, inCatalog,
  validateCustomSkill, setCustomSkills, parseFxLine, formatFxLine, getCustomSkillNames, isBuiltinSkill, MAX_CUSTOM_SKILLS,
} from '../src/game/skillTable.js';
import { drawPool } from '../src/game/skillDraw.js';
import { derivedStats } from '../src/game/stats.js';
import { passivesOf } from '../src/game/skills.js';
import { proficiency } from '../src/game/engine.js';
import { blankCharacter } from '../src/game/importBot.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const mk = (skills, extra = {}) => ({ ...blankCharacter('測試'), statMode: 'skills', skills, ...extra });

test('目錄：119 個技能、每個 10 級；啟動類只有 7 個武裝；升級經驗表有四個位階', () => {
  const names = Object.keys(SKILL_TABLE);
  assert.equal(names.length, 119);
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
import { setSkillLevel, upgradeSkill, upgradeSkillTo, upgradePlan, maxAffordableLevel, upgradeCost, markSwapsDone, fodderBooks, toggleKeepBook, combineInsight } from '../src/game/skillTable.js';

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

test('肥料書：抵同階通用書 1 比 1；先用已學會的多餘書，再用沒保留且湊滿 3 本的，最後才用通用書', () => {
  // 八卦掌（初階）已 1 級，要升到 2 級＝付 2 本初階通用書
  const s = mk({ 八卦掌: 1, 周天吐納法: 1 }, { exp: 9999, inventory: { 周天吐納法: 1, 呢喃低語: 3, 初階寶寶: 2, 初階技能書: 5, 劍心訣: 9 } });
  const plan = upgradePlan(s, '八卦掌', 2);
  assert.deepEqual(plan.fodder, { 周天吐納法: 1, 呢喃低語: 1 }); // 已學會的先，再來湊滿 3 本的；初階寶寶只有 2 本排最後（這次用不到）；進階的劍心訣不同階不動
  // 需要更多時，沒湊滿 3 本、沒保留的書最後也會被拿來當肥料（使用者 2026-10-12）
  assert.deepEqual(upgradePlan(s, '八卦掌', 3).fodder, { 周天吐納法: 1, 呢喃低語: 3, 初階寶寶: 1 });
  assert.deepEqual(fodderBooks(s, '初階').map((f) => [f.name, f.rank]), [['周天吐納法', 1], ['呢喃低語', 2], ['初階寶寶', 3]]);
  assert.equal(plan.ok, true);
  assert.equal(upgradeSkillTo(s, '八卦掌', 2).ok, true);
  assert.equal(s.inventory.周天吐納法, undefined);
  assert.equal(s.inventory.呢喃低語, 2);
  assert.equal(s.inventory.初階技能書, 5); // 通用書沒動
  assert.equal(s.inventory.劍心訣, 9);
});

test('肥料書：保留名單的不用；不夠的部分才扣通用書；學新技能時自己的 3 本同名書留給學習', () => {
  const s = mk({ 八卦掌: 1 }, { exp: 9999, inventory: { 呢喃低語: 3, 初階技能書: 5 } });
  toggleKeepBook(s, '呢喃低語');
  assert.deepEqual(fodderBooks(s, '初階'), []);
  assert.deepEqual(upgradePlan(s, '八卦掌', 2).fodder, {});
  assert.equal(upgradePlan(s, '八卦掌', 2).books.初階技能書, 2);
  toggleKeepBook(s, '呢喃低語'); // 取消保留
  const p3 = upgradePlan(s, '八卦掌', 3); // 2 + 3 = 5 本：肥料 3 本、通用 2 本
  assert.deepEqual(p3.fodder, { 呢喃低語: 3 });
  assert.equal(p3.books.初階技能書, 2);
  // 從 0 級學：3 本同名書留給學習，多的 2 本才是肥料
  const t = mk({}, { exp: 9999, inventory: { 八卦掌: 5, 初階技能書: 0 } });
  const p = upgradePlan(t, '八卦掌', 3); // 學習 3 本同名 + 2 級 2 本 + 3 級 3 本 = 通用需求 5，肥料只有多出的 2 本
  assert.deepEqual(p.fodder, { 八卦掌: 2 });
  assert.equal(p.books.八卦掌, 3);
  assert.equal(p.books.初階技能書, 3);
});

test('浮腫之軀（夜見祈）：每個 5 級以上的神秘技能 +5 生命上限，自己 5 級以上也算；其他等級或系別不算', () => {
  assert.ok(inCatalog('浮腫之軀') && SKILL_TABLE.浮腫之軀.personal && SKILL_TABLE.浮腫之軀.school === '神秘');
  const base = derivedStats(mk({})).生命.total;
  const hp = (skills) => derivedStats(mk(skills)).生命.total - base;
  assert.equal(hp({ 浮腫之軀: 4 }), 0); // 自己還沒到 5 級、沒有別的神秘技能
  assert.equal(hp({ 浮腫之軀: 5 }), 5); // 自己 5 級也算
  assert.equal(hp({ 浮腫之軀: 1, 呢喃低語: 5 }), 5); // 呢喃低語是神秘系，5 級
  assert.equal(hp({ 浮腫之軀: 5, 呢喃低語: 10, 八卦掌: 10 }), 10); // 八卦掌是修仙系，不算
  assert.equal(hp({ 呢喃低語: 5 }), 0); // 沒學浮腫之軀就沒有這個被動
  assert.ok(derivedStats(mk({ 浮腫之軀: 5 })).生命.parts.some((p) => p.label === '浮腫之軀' && p.value === 5));
});

test('暗影斗篷（我要把朋友賣掉）：只有文字、不影響任何面板數值', () => {
  assert.ok(inCatalog('暗影斗篷') && SKILL_TABLE.暗影斗篷.personal && SKILL_TABLE.暗影斗篷.school === '西幻');
  assert.ok(SKILL_TABLE.暗影斗篷.fx.every((f) => Object.keys(f).length === 0));
  const before = derivedStats(mk({}));
  const after = derivedStats(mk({ 暗影斗篷: 10 }));
  for (const k of Object.keys(before)) assert.equal(after[k].total, before[k].total);
});

test('老狗識途：每個擁有的技能（含自己）達 5、10 級各觸發一次，依序加 物理→能量→靈魂→體魄→抗性→精神，循環', () => {
  const STATS = ['物理傷害', '能量傷害', '靈魂傷害', '體魄強韌', '抗性免疫', '精神意志'];
  // 只看「老狗識途」這個來源在面板明細裡加了多少（其他技能自己的數值不算）
  const dog = (skills) => { const d = derivedStats(mk(skills)); return STATS.map((k) => d[k].parts.filter((p) => p.label === '老狗識途').reduce((a, p) => a + p.value, 0)); };
  assert.deepEqual(skillFx('老狗識途', 3), { 生命: 3 }); // 目錄只剩每級 +1 生命，屬性由程式算
  assert.deepEqual(skillFx('老狗識途', 10), { 生命: 10, 真實傷害: 1, 絕對防禦: 1 });
  assert.deepEqual(dog({ 老狗識途: 4 }), [0, 0, 0, 0, 0, 0]); // 沒有任何技能到 5 級
  assert.deepEqual(dog({ 老狗識途: 5 }), [1, 0, 0, 0, 0, 0]); // 自己 5 級也算：第 1 次 → 物理
  assert.deepEqual(dog({ 老狗識途: 5, 八卦掌: 10 }), [1, 1, 1, 0, 0, 0]); // 老狗 5（1 次）＋八卦掌 10（2 次）＝ 3 次
  assert.deepEqual(dog({ 老狗識途: 10, 八卦掌: 10, 呢喃低語: 5 }), [1, 1, 1, 1, 1, 0]); // 2 + 2 + 1 = 5 次：前五項各 1
  assert.deepEqual(dog({ 老狗識途: 10, 八卦掌: 5, 呢喃低語: 5, 引氣訣: 5, 周天吐納法: 5 }), [1, 1, 1, 1, 1, 1]); // 2 + 4 = 6 次：六項各 1
  assert.deepEqual(dog({ 老狗識途: 10, 八卦掌: 10, 呢喃低語: 5, 引氣訣: 5, 周天吐納法: 5 }), [2, 1, 1, 1, 1, 1]); // 2 + 2 + 1 + 1 + 1 = 7 次：第 7 次回到物理
  assert.deepEqual(dog({ 呢喃低語: 10 }), [0, 0, 0, 0, 0, 0]); // 沒學老狗識途就沒有這個被動
});

// ---------- GM 新增的專屬技能 ----------
const mySkill = { tier: '進階', kind: '被動', school: '獨特', text: '每級加生命', fx: [{ 生命: 5 }, { 生命: 10 }, { 生命: 10, 真實傷害: 1 }] };

test('屬性加成文字：「生命+5 真實傷害+1」讀成數值、數值轉回文字；看不懂的會說哪一段', () => {
  assert.deepEqual(parseFxLine('生命+5 真實傷害+1，物理傷害-2、魔力3'), { ok: true, fx: { 生命: 5, 真實傷害: 1, 物理傷害: -2, 魔力: 3 } });
  assert.deepEqual(parseFxLine(''), { ok: true, fx: {} });
  assert.deepEqual(parseFxLine('生命+0'), { ok: true, fx: {} });
  assert.deepEqual(parseFxLine('生命+2 生命+3'), { ok: true, fx: { 生命: 5 } }); // 同一屬性寫兩次會相加
  assert.equal(parseFxLine('生命').ok, false);
  assert.match(parseFxLine('亂寫+1').error, /亂寫\+1/);
  assert.equal(parseFxLine('能量傷害+1').fx.能量傷害, 1); // 能量傷害與能量是不同屬性
  assert.equal(formatFxLine({ 生命: 5, 物理傷害: -2 }), '生命+5 物理傷害-2');
  assert.deepEqual(parseFxLine(formatFxLine({ 生命: 5, 物理傷害: -2 })).fx, { 生命: 5, 物理傷害: -2 });
});

test('GM 新增專屬技能的檢查：名稱、位階、類型（沒有啟動類）、系別、文字長度、數值表', () => {
  assert.equal(validateCustomSkill('我的技能', mySkill).ok, true);
  const no = (name, def) => assert.equal(validateCustomSkill(name, def).ok, false);
  no('', mySkill); no('x'.repeat(21), mySkill);
  no('八卦掌', mySkill); no('老狗識途', mySkill); // 內建技能不能蓋掉
  no('新', { ...mySkill, tier: '神級' }); no('新', { ...mySkill, kind: '啟動' }); no('新', { ...mySkill, school: '亂來' });
  no('新', { ...mySkill, text: 'x'.repeat(601) });
  no('新', { ...mySkill, fx: Array.from({ length: 11 }, () => ({})) });
  no('新', { ...mySkill, fx: [{ 亂寫: 1 }] }); no('新', { ...mySkill, fx: [{ 生命: 1.5 }] }); no('新', { ...mySkill, fx: [{ 生命: 10000 }] }); no('新', { ...mySkill, fx: ['生命'] });
  no('新', null);
  const v = validateCustomSkill('  我的技能  ', { ...mySkill, fx: [{ 生命: 5, 物理傷害: 0 }] });
  assert.equal(v.name, '我的技能'); // 前後空白去掉
  assert.equal(v.def.fx.length, 10); // 不足 10 級的補成空的
  assert.deepEqual(v.def.fx[0], { 生命: 5 }); // 0 的丟掉
  assert.ok(v.def.personal && v.def.custom);
  assert.ok(isBuiltinSkill('八卦掌') && !isBuiltinSkill('我的技能'));
});

test('GM 新增專屬技能：放進目錄後面板會算數值、不進抽書池；更新或清空時上一批會被拿掉；內建技能不受影響', () => {
  const before = Object.keys(SKILL_TABLE).length;
  setCustomSkills({ 我的技能: mySkill, 八卦掌: { ...mySkill, tier: '初階' }, 壞技能: { tier: '亂來' } });
  assert.deepEqual(getCustomSkillNames(), ['我的技能']); // 蓋內建的、壞資料的都被丟掉
  assert.equal(SKILL_TABLE.八卦掌.tier, '初階'); assert.equal(SKILL_TABLE.八卦掌.school, '修仙'); // 內建的沒被蓋掉
  assert.ok(inCatalog('我的技能') && Object.keys(SKILL_TABLE).length === before + 1);
  assert.deepEqual(skillFx('我的技能', 3), { 生命: 10, 真實傷害: 1 });
  const hp = (skills) => derivedStats(mk(skills)).生命.total;
  const base = hp({});
  assert.equal(hp({ 我的技能: 2 }) - base, 10); // 2 級累積 +10 生命
  assert.equal(hp({ 我的技能: 0 }) - base, 0);
  assert.ok(!drawPool('進階').includes('我的技能')); // 專屬技能不進抽書池
  setCustomSkills({ 另一個: { ...mySkill, fx: [] } });
  assert.ok(!inCatalog('我的技能') && inCatalog('另一個')); // 換一批：上一批拿掉
  assert.equal(hp({ 我的技能: 2 }) - base, 0); // 目錄沒有就不算（資料還在玩家身上，技能回來又會算）
  setCustomSkills(null);
  assert.equal(Object.keys(SKILL_TABLE).length, before);
  assert.equal(MAX_CUSTOM_SKILLS, 60);
});

test('技能感悟升階：每階 6 合 1；不夠不扣；傳說不能合；學新技能仍不能用感悟', () => {
  const s = { ...mk({}), inventory: { 初階技能感悟: 13, 傳說技能感悟: 9 } };
  const r = combineInsight(s, '初階技能感悟', 2);
  assert.ok(r.ok);
  assert.equal(s.inventory.初階技能感悟, 1);
  assert.equal(s.inventory.進階技能感悟, 2);
  const bad = combineInsight(s, '初階技能感悟', 1);
  assert.equal(bad.ok, false);
  assert.equal(s.inventory.初階技能感悟, 1); // 沒扣
  assert.equal(combineInsight(s, '傳說技能感悟', 1).ok, false);
  assert.equal(combineInsight(s, '初階技能書', 1).ok, false);
  const learn = upgradePlan({ ...mk({}), exp: 99999, spentExp: 99999, inventory: { 初階技能感悟: 5 } }, '周天吐納法', 1);
  assert.deepEqual(learn.fodder, {});
  assert.equal(learn.ok, false);
});

test('技能感悟：同階最優先抵通用書 1 比 1；不同階不動', () => {
  const s = { ...mk({ 周天吐納法: 1 }), exp: 99999, spentExp: 99999, inventory: { 初階技能感悟: 2, 進階技能感悟: 5, 初階技能書: 9, 周天吐納法: 4 } };
  assert.deepEqual(fodderBooks(s, '初階').map((f) => f.name), ['初階技能感悟', '周天吐納法']); // 感悟排最前
  const plan = upgradePlan(s, '周天吐納法', 3); // 2 級 2 本 + 3 級 3 本 = 5 本
  assert.deepEqual(plan.fodder, { 初階技能感悟: 2, 周天吐納法: 3 });
  assert.equal(plan.books['初階技能書'], undefined);
  const learn = upgradePlan({ ...s, skills: {} }, '周天吐納法', 1); // 學新技能：4 本同名書夠，不動感悟
  assert.deepEqual(learn.fodder, {});
  assert.equal(learn.missing['初階技能感悟'], undefined);
});

test('生活技能類技能升級：尋脈探靈手升級時，採藥技能一起增加；沒生效或往下調不動', async () => {
  const { checkSkillGain } = await import('../src/game/skillTable.js');
  const { setCheckAdjust, modifier } = await import('../src/game/engine.js');
  const s = JSON.parse(JSON.stringify((await import('../src/data/sample/fude.js')).SAMPLE_CHARACTER));
  s.statMode = 'skills'; s.skills = {}; s.lifeSkills = { ...s.lifeSkills, 採藥: 10 };
  assert.deepEqual(checkSkillGain(s, '尋脈探靈手', 0, 1), { 採藥: 1 });
  assert.deepEqual(checkSkillGain(s, '尋脈探靈手', 3, 4), { 採藥: 1 });
  assert.deepEqual(checkSkillGain(s, '尋脈探靈手', 0, 10), { 採藥: 4 });
  assert.deepEqual(checkSkillGain(s, '尋脈探靈手', 4, 3), {});
  setSkillLevel(s, '尋脈探靈手', 4);
  assert.equal(s.lifeSkills.採藥, 12);
  setSkillLevel(s, '尋脈探靈手', 2); // 往下調不扣
  assert.equal(s.lifeSkills.採藥, 12);
  const old = JSON.parse(JSON.stringify(s)); delete old.statMode;
  assert.deepEqual(checkSkillGain(old, '尋脈探靈手', 0, 4), {});
  // 備用保險：手動修正加進檢定明細，上下限 ±99，0 = 清掉
  assert.equal(setCheckAdjust(s, '採藥', 3), 3);
  assert.ok(modifier(s, '採藥', 'rest').parts.some((p) => p.label === '手動修正' && p.value === 3));
  assert.equal(setCheckAdjust(s, '採藥', 500), 99);
  assert.equal(setCheckAdjust(s, '採藥', -500), -99);
  assert.equal(setCheckAdjust(s, '採藥', 0), 0);
  assert.equal(s.checkAdjust.採藥, undefined);
  assert.equal(setCheckAdjust(s, '亂寫', 5), 0);
});

test('GM 補算：沒記錄的生活系技能補上差額並記錄；已經算過的不會重複加；一般升級會自動記錄', async () => {
  const { lifeBackfill, applyLifeBackfill, setSkillLevel } = await import('../src/game/skillTable.js');
  const s = mk({ 魔女秘飲: 5, 尋脈探靈手: 4 }); // 修正前學的：沒有 lifeGainDone 記錄
  s.lifeSkills = { ...s.lifeSkills, 調劑: 10, 採藥: 10 };
  const rows = lifeBackfill(s);
  assert.deepEqual(rows.map((x) => x.name).sort(), ['尋脈探靈手', '魔女秘飲']);
  const potion = rows.find((x) => x.name === '魔女秘飲');
  assert.deepEqual(potion.gains, { 調劑: skillFx('魔女秘飲', 5).調劑 });
  const done = applyLifeBackfill(s, ['魔女秘飲']); // 只補勾選的
  assert.deepEqual(Object.keys(done), ['魔女秘飲']);
  assert.equal(s.lifeSkills.調劑, 10 + potion.gains.調劑);
  assert.equal(s.lifeSkills.採藥, 10);
  assert.deepEqual(lifeBackfill(s).map((x) => x.name), ['尋脈探靈手']); // 補過的不再出現
  applyLifeBackfill(s, ['魔女秘飲']);
  assert.equal(s.lifeSkills.調劑, 10 + potion.gains.調劑); // 再補一次也不會重複加
  // 一般升級：自動記錄，之後補算不會再算到
  const t = mk({}); t.lifeSkills = { ...t.lifeSkills, 採藥: 0 };
  setSkillLevel(t, '尋脈探靈手', 4);
  assert.equal(t.lifeSkills.採藥, 2);
  assert.deepEqual(lifeBackfill(t), []);
});
