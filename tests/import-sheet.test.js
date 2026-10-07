// 執行方式：npm test
// 試算表角色卡貼上文字 → 網站角色（資料都是假的；真實角色卡不能進 git）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, parseSheet, convertSheet } from '../src/game/importSheet.js';
import { derivedStats } from '../src/game/stats.js';
import { ALL_STATS, RESOURCE_STATS } from '../src/game/rules.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

/** 組一份假的「角色永久狀態」貼上文字。shift = 整張表往右移幾欄、noise = 前面多幾列雜訊（測排版不同） */
function sheet({ name = '測試角色', panel = {}, res = {}, foods = [], learned = [], shift = 0, noise = 0, life = 3 } = {}) {
  const P = { 真實傷害: 10, 物理傷害: 20, 能量傷害: 30, 靈魂傷害: 40, 絕對防禦: 5, 體魄強韌: 6, 抗性免疫: 7, 精神意志: 8, ...panel };
  const R = { 生命: [50, 60], 靈氣: [5, 6], 魔力: [7, 8], 能量: [1, 2], 鬥氣: [3, 4], 算力: [9, 10], ...res };
  const pad = (cells) => [...Array(shift).fill(''), ...cells];
  const rows = [];
  for (let i = 0; i < noise; i++) rows.push(pad(['雜訊', String(i)]));
  rows.push(pad(['', '角色檔案']));
  rows.push(pad(['', '玩家名稱', '某位玩家', '', '生命', '目前', String(R.生命[0]), '最大', String(R.生命[1]), '靈氣', '目前', String(R.靈氣[0]), '最大', String(R.靈氣[1]), '魔力', '目前', String(R.魔力[0]), '最大', String(R.魔力[1])]));
  rows.push(pad(['', '角色名稱', name, '', '能量', '目前', String(R.能量[0]), '最大', String(R.能量[1]), '鬥氣', '目前', String(R.鬥氣[0]), '最大', String(R.鬥氣[1]), '算力', '目前', String(R.算力[0]), '最大', String(R.算力[1])]));
  rows.push(pad(['', '攻擊', '真實傷害', '', String(P.真實傷害), '物理傷害', '', String(P.物理傷害), '能量傷害', '', String(P.能量傷害), '靈魂傷害', '', String(P.靈魂傷害), '胃袋', foods[0] ?? '']));
  rows.push(pad(['', '防禦', '絕對防禦', '', String(P.絕對防禦), '體魄強韌', '', String(P.體魄強韌), '抗性免疫', '', String(P.抗性免疫), '精神意志', '', String(P.精神意志), '胃袋', foods[1] ?? '']));
  rows.push(pad(['', '生活', '熟練', '1', '釣魚', String(life), '狩獵', '2', '採藥', '3', '挖礦', '2', '調劑', '3', '烹飪', '13', '鑄造', '13', '書寫', '14']));
  rows.push(pad(['', '技藝', '運動', '1', '盜賊', '1', '社交', '3', '偵查', '2', '調查', '2', '西幻', '2', '科學', '3', '神秘', '4', '修仙', '1']));
  rows.push(pad(['已學會的技能']));
  rows.push(pad(['', '技能名稱', '位階', '等級', '分類', '屬性', '效果']));
  for (const [n, lv] of learned) { rows.push(pad(['', n, '初階', lv === null ? '' : String(lv), '修仙', '被動', '"被動：效果\n第二行"'.replace(/^"|"$/g, '')])); rows.push(pad([])); }
  rows.push(pad(['', '未習得', '一', '', '', '', '']));
  return rows.map((r) => r.map((c) => (/[\n"\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\n');
}
const parsed = (o) => parseSheet(sheet(o));

test('TSV：引號、引號內的換行與逗號、跳脫的雙引號、CRLF、BOM', () => {
  assert.deepEqual(parseTsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseTsv('﻿a\t"x\ny"\t"他說""好"""\r\nc\td'), [['a', 'x\ny', '他說"好"'], ['c', 'd']]);
  assert.deepEqual(parseTsv('  a  \t b '), [['a', 'b']]);
  assert.deepEqual(parseTsv(''), []);
});

test('解析：名稱、面板、資源（最大與目前）、生活技能、技藝、胃袋、已學技能', () => {
  const p = parsed({ foods: ['滿漢全席', '炒飯'], learned: [['引氣訣', 4], ['清心觀想圖', 5]] });
  assert.equal(p.name, '測試角色');
  assert.equal(p.panel.物理傷害, 20); assert.equal(p.panel.精神意志, 8);
  assert.deepEqual(p.resources.生命, { now: 50, max: 60 });
  assert.equal(p.lifeSkills.釣魚, 3); assert.equal(p.arts.修仙, 1);
  assert.deepEqual(p.foods, ['滿漢全席', '炒飯']);
  assert.deepEqual(p.learned, [{ name: '引氣訣', level: 4 }, { name: '清心觀想圖', level: 5 }]);
  assert.deepEqual(p.warnings, []);
  assert.ok(!JSON.stringify(p).includes('某位玩家')); // 玩家名稱（個資）不讀
});

test('不同排版也讀得到：整張表右移、前面多出雜訊列', () => {
  const a = parsed({ learned: [['引氣訣', 4]] });
  const b = parsed({ learned: [['引氣訣', 4]], shift: 4, noise: 3 });
  assert.deepEqual(b, a);
});

test('「未習得」空位不收；等級空白算 0 級；重複名稱取最高', () => {
  const p = parsed({ learned: [['引氣訣', null], ['清心觀想圖', 3], ['清心觀想圖', 6]] });
  assert.deepEqual(p.learned, [{ name: '引氣訣', level: 0 }, { name: '清心觀想圖', level: 6 }]);
});

test('壞資料：空白、不是角色卡都回傳錯誤，不丟例外', () => {
  for (const t of ['', '   ', 'hello', '角色名稱\t', 'x'.repeat(3_100_000)]) assert.ok(parseSheet(t).error, t.slice(0, 20));
  assert.ok(parseSheet(null).error);
  assert.deepEqual(convertSheet({ error: '壞了' }), { error: '壞了' });
});

test('轉換：技能進 skills（等級 0 也留著），目錄沒有的直接丟掉', () => {
  const { data, report } = convertSheet(parsed({ learned: [['引氣訣', 4], ['鬥氣化虹', 10], ['清心觀想圖', null]] }));
  assert.deepEqual(data.skills, { 引氣訣: 4, 清心觀想圖: 0 });
  assert.deepEqual(report.dropped, ['鬥氣化虹']);
  assert.deepEqual(report.zero, ['清心觀想圖']);
  assert.equal(data.statMode, 'skills');
  assert.ok(!JSON.stringify(data).includes('鬥氣化虹'));
});

test('轉換後網站算出來的面板和試算表完全一樣（差額放進手動調整）', () => {
  const p = parsed({ learned: [['引氣訣', 4], ['煉體築基篇', 7], ['暴徒', 1]], foods: ['滿漢全席', '豪華蓋飯'] });
  const { data } = convertSheet(p);
  const d = derivedStats(data);
  for (const stat of ALL_STATS.filter((s) => !RESOURCE_STATS.includes(s))) assert.equal(d[stat].total, p.panel[stat], stat);
  for (const stat of RESOURCE_STATS) assert.equal(d[stat].total, p.resources[stat].max, stat);
  assert.deepEqual(data.sessionStomach, [{ food: '滿漢全席' }, { food: '豪華蓋飯' }]); // 面板已含食物，所以也放進胃袋
  assert.equal(data.hp, 50); assert.equal(data.resources.靈氣, 5); // 目前值
});

test('目前值不會超過最大值；負的最大值以外的怪值不會讓程式壞掉', () => {
  const { data } = convertSheet(parsed({ res: { 生命: [999, 60], 靈氣: [-3, 6] } }));
  assert.equal(data.hp, 60); assert.equal(data.resources.靈氣, 0);
});

test('啟動類技能：預設未啟動；勾「試算表上已啟動」就設 skillOn，面板一樣對得上', () => {
  const p = parsed({ learned: [['烈陽AB型武裝', 3]], panel: { 物理傷害: 20 }, res: { 算力: [9, 100], 生命: [50, 60] } });
  const off = convertSheet(p);
  assert.deepEqual(off.data.skillOn, {});
  assert.deepEqual(off.report.activation, ['烈陽AB型武裝']);
  const on = convertSheet(p, null, { activated: new Set(['烈陽AB型武裝']) });
  assert.deepEqual(on.data.skillOn, { 烈陽AB型武裝: true });
  for (const r of [off, on]) { const d = derivedStats(r.data); assert.equal(d.物理傷害.total, 20); assert.equal(d.算力.total, 100); assert.equal(d.生命.total, 60); }
  assert.notDeepEqual(on.data.adjust, off.data.adjust); // 啟動了，網站自己算的部分變多，差額就變小
  assert.equal(convertSheet(p, null, { activated: new Set(['引氣訣', '不存在']) }).data.skillOn['引氣訣'], undefined); // 只有啟動類才能啟動
});

test('調整為負的屬性會被標出來（網站算出的比試算表面板還高，常見於試算表漏算技能）', () => {
  const { report, data } = convertSheet(parsed({ learned: [['引氣訣', 10]], panel: { 物理傷害: 0, 能量傷害: 0 } }));
  assert.ok(report.negative.includes('物理傷害'));
  assert.ok(data.adjust.物理傷害 < 0);
});

test('技能庫的招式：有等級才給，不重複', () => {
  const { data } = convertSheet(parsed({ learned: [['暴徒', 1], ['萬物歸一', 0]] }));
  assert.ok(data.moves.some((m) => m.skill === '暴徒'));
  assert.ok(!data.moves.some((m) => m.skill === '萬物歸一'));
  const again = convertSheet(parsed({ learned: [['暴徒', 1]] }), data);
  assert.equal(again.data.moves.filter((m) => m.skill === '暴徒').length, 1);
});

test('合併進既有角色：背包、裝備、金幣保留；技能與手動調整以角色卡為準；不改傳入物件', () => {
  const base = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  const snapshot = JSON.stringify(base);
  const p = parsed({ learned: [['引氣訣', 4]] });
  const { data } = convertSheet(p, base);
  assert.equal(JSON.stringify(base), snapshot);
  assert.equal(data.gold, SAMPLE_CHARACTER.gold);
  assert.deepEqual(data.inventory, SAMPLE_CHARACTER.inventory);
  assert.equal(data.equipment.weapon.id, SAMPLE_CHARACTER.equipment.weapon.id);
  assert.deepEqual(data.skills, { 引氣訣: 4 });
  // 網站上已有裝備時，裝備算在網站這邊，調整值會少掉裝備那一份，面板仍然對得上
  assert.equal(derivedStats(data).真實傷害.total, p.panel.真實傷害);
});

test('新角色的名稱取自角色卡；不帶玩家名稱', () => {
  const { data } = convertSheet(parsed({ name: '甲乙丙' }));
  assert.equal(data.name, '甲乙丙');
  assert.equal(data.player, '');
});

test('試算表面板是小數（玩家改掉進位公式）：網站依規則進位，並在報告標出來', () => {
  const p = parsed({ learned: [['暴徒', 1]], panel: { 物理傷害: 79, 能量傷害: 93.5 } });
  const { data, report } = convertSheet(p);
  assert.deepEqual(report.fractional, ['能量傷害']);
  assert.ok(Math.abs(derivedStats(data).能量傷害.total - 93.5) < 1);
  assert.ok(Number.isInteger(derivedStats(data).能量傷害.total));
  assert.ok(Object.values(data.adjust).every(Number.isInteger));
});
