// 執行方式：npm test
// 戰鬥規則：照機器人 A/B/C 結算；真傷分開記錄、結算時加進招式軌道；藥水；倒地
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAbc, formatAbc, attackDice, defenseDice, clash, generateAbcSplit, newEncounter, addMobs, addBosses,
  playerAttack, monsterAttack, drinkPotion, isDowned, endBattle,
} from '../src/game/combat.js';
import { derivedStats, maxHp } from '../src/game/stats.js';
import { eat } from '../src/game/engine.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
/** 讓每顆 D4 固定擲出 n（Math.floor(r*4)+1 = n） */
const d4 = (n) => () => (n - 1) / 4 + 0.01;

test('A/B/C 字串解析與格式化（照機器人 parse_abc）', () => {
  assert.deepEqual(parseAbc('3A 2B 1C'), { A: 3, B: 2, C: 1 });
  assert.deepEqual(parseAbc('332B381C'), { A: 0, B: 332, C: 381 });
  assert.deepEqual(parseAbc('2A1A'), { A: 3, B: 0, C: 0 });
  assert.deepEqual(parseAbc('沒有數字'), { A: 0, B: 0, C: 0 });
  assert.equal(formatAbc({ A: 0, B: 332, C: 381 }), '332B 381C');
  assert.equal(formatAbc({ A: 0, B: 0, C: 0 }), '0');
});

test('逐軌相減、不足 0、三軌相加（照機器人 calc_damage_str）', () => {
  // 每顆 D4 都擲 2：攻 3A 2B 1C = 6/4/2；防 1A 3B 0C = 2/6/0 → 4 + 0 + 2 = 6
  const r = clash({ A: 3, B: 2, C: 1 }, { A: 1, B: 3, C: 0 }, () => 0.3);
  assert.deepEqual(r.tracks.map((t) => t.damage), [4, 0, 2]);
  assert.equal(r.total, 6);
});

test('面板與試算表一致：吃 3 份滿漢全席後 真傷 141、絕防 135、生命 804', () => {
  const s = fresh();
  for (let i = 0; i < 3; i++) assert.equal(eat(s, '滿漢全席', 'session'), null);
  const p = derivedStats(s);
  assert.equal(p.真實傷害.total, 141);
  assert.equal(p.絕對防禦.total, 135);
  assert.equal(p.靈魂傷害.total, 237);
  assert.equal(maxHp(s), 804);
});

test('招式攻擊骰 = 軌道傷害 + 真傷 + 招式加成，與試算表「招式」一致', () => {
  const s = fresh();
  for (let i = 0; i < 3; i++) eat(s, '滿漢全席', 'session');
  const dice = (name) => attackDice(s, s.moves.find((m) => m.name === name)).dice;
  assert.deepEqual(dice('六手'), { A: 0, B: 0, C: 382 });
  assert.deepEqual(dice('點化'), { A: 0, B: 332, C: 381 });
  assert.deepEqual(dice('歸墟'), { A: 0, B: 0, C: 390 });
});

test('真實傷害與一般傷害分開記錄：面板仍各自獨立', () => {
  const s = fresh();
  const p = derivedStats(s);
  assert.equal(p.真實傷害.total, 129);
  assert.equal(p.靈魂傷害.total, 237);
  assert.equal(attackDice(s, { tracks: ['C'] }).dice.C, 237 + 129);
});

test('防守骰 = 各軌防禦 + 絕對防禦（對稱假設，待確認）', () => {
  const s = fresh();
  const d = defenseDice(s).dice;
  assert.deepEqual(d, { A: 110 + 123, B: 64 + 123, C: 90 + 123 });
});

test('怪物強度分配：總和不變，加上區域補正', () => {
  for (let i = 0; i < 50; i++) {
    const v = generateAbcSplit(30, { A: 2, B: 0, C: 1 }, Math.random);
    assert.equal(v.A + v.B + v.C, 33);
  }
  assert.deepEqual(generateAbcSplit(0, { A: 1, B: 0, C: 0 }), { A: 1, B: 0, C: 0 });
});

test('怪物強度分配：最集中的一軌不超過 70%（極端型 50%～70%，使用者 2026-10-09）', () => {
  // rng 依序：選類型（0 → 極端）、比例（0.999 → 接近上限）、之後洗牌
  const seq = [0, 0.999, 0.5, 0.5, 0.5];
  let i = 0;
  const v = generateAbcSplit(1000, undefined, () => seq[i++ % seq.length]);
  assert.equal(Math.max(v.A, v.B, v.C), 699);
  i = 0; seq[1] = 0;
  assert.equal(Math.max(...Object.values(generateAbcSplit(1000, undefined, () => seq[i++ % seq.length]))), 500);
  for (let k = 0; k < 300; k++) {
    const w = generateAbcSplit(1000);
    assert.ok(Math.max(w.A, w.B, w.C) <= 700);
  }
});

test('小怪與 BOSS 命名、數量、BOSS 三組攻防', () => {
  const enc = newEncounter();
  addMobs(enc, { count: 2, atkPower: 6, defPower: 6, hp: 20 });
  addBosses(enc, { count: 1, atkPower: 30, defPower: 30, hp: 500 });
  addMobs(enc, { count: 1, atkPower: 6, defPower: 6, hp: 20 });
  assert.deepEqual(enc.monsters.map((m) => m.id), ['小怪1', '小怪2', 'BOSS1', '小怪3']);
  assert.equal(enc.monsters[2].atk.length, 3);
  assert.equal(enc.monsters[2].def.length, 3);
});

test('玩家出招：扣怪物血量，消耗「下次攻擊」藥水加成', () => {
  const s = fresh();
  const enc = newEncounter();
  enc.monsters.push({ id: '小怪1', kind: 'mob', hp: 1000, maxHp: 1000, atk: { A: 0, B: 0, C: 0 }, def: { A: 0, B: 0, C: 100 } });
  s.buffs.atk = 3;
  const r = playerAttack(s, enc, 'm1', '小怪1', 0, d4(2));
  // 六手：C = 237 + 129 + 4 + 藥水 3 = 373 顆，每顆 2 = 746；防 100 顆 = 200；傷害 546
  assert.equal(r.atk.dice.C, 373);
  assert.equal(r.result.total, 546);
  assert.equal(enc.monsters[0].hp, 1000 - 546);
  assert.equal(s.buffs.atk, 0);
});

test('怪物攻擊玩家：扣血，HP 歸零只是倒地不會消失', () => {
  const s = fresh();
  s.hp = 10;
  const enc = newEncounter();
  enc.monsters.push({ id: '小怪1', kind: 'mob', hp: 5, maxHp: 5, atk: { A: 500, B: 0, C: 0 }, def: { A: 0, B: 0, C: 0 } });
  const r = monsterAttack(s, enc, '小怪1', 0, d4(4));
  assert.ok(r.result.total > 10);
  assert.equal(s.hp, 0);
  assert.equal(isDowned(s), true);
  assert.equal(r.newlyDowned, true);
  assert.equal(playerAttack(s, enc, 'm1', '小怪1').error, '你已經倒地，無法出招。');
});

test('BOSS 依模式選用對應攻擊／防禦組', () => {
  const s = fresh();
  s.skills = {}; // 先拿掉暴徒/魔女/終焉武裝，單純測戰鬥算式
  const enc = newEncounter();
  enc.monsters.push({
    id: 'BOSS1', kind: 'boss', hp: 100, maxHp: 100,
    atk: [{ A: 1, B: 0, C: 0 }, { A: 5, B: 0, C: 0 }, { A: 9, B: 0, C: 0 }],
    def: [{ A: 0, B: 0, C: 1 }, { A: 0, B: 0, C: 5 }, { A: 0, B: 0, C: 9 }],
  });
  assert.equal(monsterAttack(s, enc, 'BOSS1', 2, d4(1)).atk.A, 9);
  assert.equal(playerAttack(s, enc, 'm1', 'BOSS1', 1, d4(1)).def.C, 5);
});

test('喝藥水：回血、毒性累積、攻防加成、扣背包', () => {
  const s = fresh();
  s.hp = 100;
  const before = s.inventory['回春湯'];
  const r = drinkPotion(s, '回春湯', d4(4) /* 8D10：每顆 floor(0.76*10)+1 = 8 */);
  assert.equal(r.dice, '8D10');
  assert.equal(r.rolled, 64);
  assert.equal(s.hp, 164);
  assert.equal(s.toxicity, 2);
  assert.equal(s.inventory['回春湯'], before - 1);
  drinkPotion(s, '狂暴湯');
  drinkPotion(s, '力量泉');
  assert.equal(s.buffs.atk, 12);
  drinkPotion(s, '玄武湯');
  assert.equal(s.buffs.def, 5);
});

test('回血不超過最大生命；毒性到 15 就不能再喝、也不會超過 15', () => {
  const s = fresh();
  s.hp = maxHp(s) - 1;
  assert.equal(drinkPotion(s, '回春湯', d4(4)).healed, 1);
  s.toxicity = 14; // 14 時：+2 的不能喝，+1 的可以
  assert.match(drinkPotion(s, '回春湯').error, /會超過/);
  assert.equal(s.toxicity, 14);
  const r = drinkPotion(s, '狂暴湯'); // +1
  assert.equal(s.toxicity, 15);
  assert.equal(r.atLimit, true);
  const stock = s.inventory['力量泉'];
  assert.match(drinkPotion(s, '力量泉').error, /會超過/);
  assert.equal(s.inventory['力量泉'], stock); // 被擋下時不消耗藥水
});

test('結束戰鬥：毒性歸零、藥水加成清除、敵人清空', () => {
  const s = fresh();
  drinkPotion(s, '狂暴湯');
  addMobs(s.encounter, { count: 2, atkPower: 5, defPower: 5, hp: 10 });
  const r = endBattle(s);
  assert.equal(r.monsters, 2);
  assert.equal(s.toxicity, 0);
  assert.deepEqual(s.buffs, { atk: 0, def: 0 });
  assert.equal(s.encounter.monsters.length, 0);
});

/** 建立一隻固定數值的小怪，D4 全擲 1 讓結果可預測（每顆 = 1） */
function setup(def, abs) {
  const s = fresh();
  s.skills = {}; // 先拿掉暴徒/魔女/終焉武裝，單純測戰鬥算式
  const enc = newEncounter();
  enc.monsters.push({ id: '小怪1', kind: 'mob', hp: 9999, maxHp: 9999, atk: { A: 0, B: 0, C: 0 }, def, abs });
  return { s, enc };
}
const one = () => 0; // 每顆 D4 = 1

test('一般招式：怪物絕對防禦加在這招用到的每條軌道', () => {
  const { s, enc } = setup({ A: 0, B: 0, C: 100 }, 10);
  s.moves.push({ id: 't1', name: '測試C', tracks: ['C'], mode: 'normal', extra: { A: 0, B: 0, C: 0 } });
  const r = playerAttack(s, enc, 't1', '小怪1', 0, one);
  const c = r.result.tracks.find((t) => t.track === 'C');
  const p = derivedStats(s);
  assert.equal(c.atkDice, p['靈魂傷害'].total + p['真實傷害'].total);
  assert.equal(c.defDice, 110); // C 防 100 + 絕防 10
  assert.equal(r.result.tracks.find((t) => t.track === 'A').defDice, 0); // 沒用到的軌道不加絕防
});

test('終焉武裝：無視絕對防禦（對方絕防視為 0）', () => {
  const { s, enc } = setup({ A: 0, B: 0, C: 100 }, 10);
  s.skills['終焉武裝'] = 5;
  s.moves.push({ id: 't1', name: '測試C', tracks: ['C'], mode: 'normal', extra: { A: 0, B: 0, C: 0 } });
  const r = playerAttack(s, enc, 't1', '小怪1', 0, one);
  assert.equal(r.result.tracks.find((t) => t.track === 'C').defDice, 100);
  assert.equal(r.ignoreAbs, true);
});

test('萬物歸一：A+B+C+真傷 一次對 A+B+C+絕防', () => {
  const { s, enc } = setup({ A: 10, B: 20, C: 30 }, 5);
  s.moves.push({ id: 'all', name: '萬物歸一', tracks: ['A', 'B', 'C'], mode: 'all', extra: { A: 0, B: 0, C: 0 } });
  const r = playerAttack(s, enc, 'all', '小怪1', 0, one);
  const p = derivedStats(s);
  const atk = p['物理傷害'].total + p['能量傷害'].total + p['靈魂傷害'].total + p['真實傷害'].total;
  assert.equal(r.result.tracks.length, 1);
  assert.equal(r.result.tracks[0].atkDice, atk); // 真傷只算一次
  assert.equal(r.result.tracks[0].defDice, 65); // 10+20+30+5
  assert.equal(r.result.total, atk - 65); // 每顆 D4 = 1
});

test('大羅真仙：選定傷害 + 真傷 只打絕對防禦；加終焉武裝 = 沒有防禦', () => {
  const { s, enc } = setup({ A: 999, B: 999, C: 999 }, 30);
  s.moves.push({ id: 'abs', name: '大羅真仙', tracks: ['C'], mode: 'abs', extra: { A: 0, B: 0, C: 0 } });
  const p = derivedStats(s);
  const atk = p['靈魂傷害'].total + p['真實傷害'].total;
  let r = playerAttack(s, enc, 'abs', '小怪1', 0, one);
  assert.equal(r.result.tracks[0].atkDice, atk);
  assert.equal(r.result.tracks[0].defDice, 30); // 完全不看 A/B/C 防禦
  s.skills['終焉武裝'] = 5;
  r = playerAttack(s, enc, 'abs', '小怪1', 0, one);
  assert.equal(r.result.tracks[0].defDice, 0);
  assert.equal(r.result.total, atk);
});

test('沒有的藥水、不是藥水的東西會回錯誤', () => {
  const s = fresh();
  assert.match(drinkPotion(s, '紅藥水').error, /背包裡沒有/);
  assert.match(drinkPotion(s, '鐵礦石').error, /不是藥水/);
});

// ================= 資源、魔女、暴徒、%技能 =================
import { useSupport, damagePlayer } from '../src/game/combat.js';
import { resourceNow, resourceMax, actionCost, witchRest, shortfall } from '../src/game/resources.js';
import { moveFromCatalog, passivesOf } from '../src/game/skills.js';

const dummy = (hp = 1000, def = { A: 0, B: 0, C: 0 }) => ({ id: '小怪1', kind: 'mob', hp, maxHp: hp, atk: { A: 0, B: 0, C: 0 }, def, abs: 0 });
const bare = () => { const s = fresh(); s.skills = {}; return s; };

test('資源：出招會扣招式的消耗（六手 = 2生命+3靈氣+3算力），魔女再加 30 魔力', () => {
  const s = fresh();
  const enc = newEncounter(); enc.monsters.push(dummy());
  const before = { hp: s.hp, 靈氣: resourceNow(s, '靈氣'), 算力: resourceNow(s, '算力'), 魔力: resourceNow(s, '魔力') };
  const r = playerAttack(s, enc, 'm1', '小怪1', 0, d4(1));
  assert.equal(r.error, undefined);
  assert.equal(s.hp, before.hp - 2);
  assert.equal(resourceNow(s, '靈氣'), before.靈氣 - 3);
  assert.equal(resourceNow(s, '算力'), before.算力 - 3);
  assert.equal(resourceNow(s, '魔力'), before.魔力 - 30); // 魔女的負向被動
});

test('資源不足就不能出招，而且什麼都不會被扣', () => {
  const s = fresh();
  s.resources.算力 = 2; // 六手要 3 算力
  const enc = newEncounter(); enc.monsters.push(dummy());
  const hp = s.hp;
  const r = playerAttack(s, enc, 'm1', '小怪1', 0, d4(1));
  assert.match(r.error, /資源不足.*算力/);
  assert.equal(s.hp, hp);
  assert.equal(resourceNow(s, '魔力'), resourceMax(s, '魔力'));
});

test('魔女：魔力不到 30 就無法行動；放棄行動可回復 30 魔力（不超過上限）', () => {
  const s = fresh();
  s.resources.魔力 = 29;
  const enc = newEncounter(); enc.monsters.push(dummy());
  assert.match(playerAttack(s, enc, 'm1', '小怪1').error, /魔力/);
  assert.equal(witchRest(s).gained, 30);
  assert.equal(s.resources.魔力, 59);
  s.resources.魔力 = resourceMax(s, '魔力') - 10;
  assert.equal(witchRest(s).gained, 10); // 只補到上限
  assert.match(witchRest(bare()).error, /沒有/);
});

test('以生命付費不能把自己付到倒地', () => {
  const s = bare();
  s.hp = 2;
  assert.match(shortfall(s, { 生命: 2 }), /生命/);
  s.hp = 3;
  assert.equal(shortfall(s, { 生命: 2 }), null);
});

test('暴徒：物理面板照留，能量與靈魂各加 ROUNDUP(物理÷2)，但不能用物理攻擊', () => {
  const s = fresh();
  const p = derivedStats(s);
  assert.equal(p.物理傷害.total, 160);
  assert.equal(p.能量傷害.total, 190); // 試算表面板 190
  assert.equal(p.靈魂傷害.total, 237); // 試算表面板 225 + 飾品 12
  s.equipment.weapon = { id: 99, tier: '傳說', slot: 'weapon', effects: [{ stat: '物理傷害', value: 1 }] };
  assert.equal(derivedStats(s).物理傷害.total, 161);
  assert.equal(derivedStats(s).能量傷害.total, 190 + 1); // ROUNDUP(161/2)=81，比 80 多 1
  const a = attackDice(s, { tracks: ['A'], extra: {} });
  assert.equal(a.dice.A, 0);
  assert.equal(passivesOf(bare()).brute, false);
  assert.equal(derivedStats(bare()).靈魂傷害.total, 145 + 12);
});

test('萬物歸一：破防後額外扣目標現有生命 5%（無條件捨去）', () => {
  const s = fresh();
  const enc = newEncounter(); enc.monsters.push(dummy(100000));
  const r = playerAttack(s, enc, 's_萬物歸一', '小怪1', 0, d4(2));
  assert.equal(r.error, undefined);
  const afterMain = 100000 - r.result.total;
  const bonus = Math.floor((afterMain * 5) / 100);
  assert.equal(r.hits[0].bonus, bonus);
  assert.equal(enc.monsters[0].hp, afterMain - bonus);
  // 沒破防就沒有額外傷害
  const enc2 = newEncounter(); enc2.monsters.push(dummy(100000, { A: 99999, B: 99999, C: 99999 }));
  const r2 = playerAttack(s, enc2, 's_萬物歸一', '小怪1', 0, d4(1));
  assert.equal(r2.result.total, 0);
  assert.equal(r2.hits[0].bonus, undefined);
});

test('域外魔祖：修仙招式、花 30 靈氣，直接扣目標現有生命 10%', () => {
  const s = fresh();
  s.moves.push({ id: 'x', name: '修仙測試', school: '修仙', tracks: ['C'], extra: { C: 0 }, cost: {} });
  const enc = newEncounter(); enc.monsters.push(dummy(100000));
  const qi = s.resources.靈氣;
  const r = playerAttack(s, enc, 'x', '小怪1', 0, d4(2), { yuwai: true });
  assert.equal(s.resources.靈氣, qi - 30);
  const afterMain = 100000 - r.result.total;
  assert.equal(r.hits[0].yuwai, Math.floor(afterMain / 10));
  // 非修仙招式不適用，也不會被收 30 靈氣
  const enc2 = newEncounter(); enc2.monsters.push(dummy(100000));
  const qi2 = s.resources.靈氣;
  playerAttack(s, enc2, 'm1', '小怪1', 0, d4(2), { yuwai: true });
  assert.equal(s.resources.靈氣, qi2 - 3);
});

test('吞天噬血陣：打 3 個目標，回復「目標扣除生命」的一半，上限為最大生命 30%', () => {
  const s = fresh();
  s.hp = 5; // 招式要付 2 生命
  const enc = newEncounter();
  enc.monsters.push(dummy(10000), { ...dummy(10000), id: '小怪2' }, { ...dummy(10000), id: '小怪3' }, { ...dummy(10000), id: '小怪4' });
  const m = s.moves.find((x) => x.name === '吞天噬血陣');
  assert.equal(m.targets, 3);
  const r = playerAttack(s, enc, m.id, '小怪1', 0, d4(2));
  assert.equal(r.hits.length, 3);
  assert.equal(enc.monsters[3].hp, 10000); // 第 4 隻不受影響
  const lost = r.hits.reduce((a, h) => a + h.lost, 0);
  const cap = Math.floor((maxHp(s) * 30) / 100);
  assert.equal(r.healed, Math.min(Math.floor(lost / 2), cap));
  // 上限：目標血量夠多時，回復不會超過 30% 最大生命
  assert.ok(r.healed <= cap);
});

test('手動選目標：只打選到的（依點選順序），最多到招式的目標數；選太多、選到倒下的都拒絕且不扣資源', () => {
  const s = fresh();
  s.hp = 5;
  const enc = newEncounter();
  enc.monsters.push(dummy(10000), { ...dummy(10000), id: '小怪2' }, { ...dummy(10000), id: '小怪3' }, { ...dummy(10000), id: '小怪4' }, { ...dummy(0), id: '小怪5' });
  const m = s.moves.find((x) => x.name === '吞天噬血陣'); // 3 個目標
  const qi = s.resources.靈氣;
  assert.equal(playerAttack(s, enc, m.id, null, 0, d4(2), { targetIds: ['小怪1', '小怪2', '小怪3', '小怪4'] }).error, '吞天噬血陣最多打 3 個目標。');
  assert.equal(playerAttack(s, enc, m.id, null, 0, d4(2), { targetIds: ['小怪1', '小怪5'] }).error, '選到的目標已經倒下了。');
  assert.equal(playerAttack(s, enc, m.id, null, 0, d4(2), { targetIds: [] }).error, '先選目標。');
  assert.equal(s.resources.靈氣, qi);
  const r = playerAttack(s, enc, m.id, null, 0, d4(2), { targetIds: ['小怪4', '小怪2'] });
  assert.deepEqual(r.hits.map((h) => h.target.id), ['小怪4', '小怪2']); // 選比較少：只打選到的，不自動補
  assert.equal(enc.monsters[0].hp, 10000);
  assert.equal(enc.monsters[2].hp, 10000);
  assert.ok(enc.monsters[3].hp < 10000);
});

test('手動選目標：每隻 BOSS 用自己的防禦模式', () => {
  const s = fresh();
  s.skills = {};
  s.moves.push({ id: 'aoe', name: '群攻', tracks: ['C'], extra: { C: 0 }, cost: {}, targets: 2 });
  const boss = (id) => ({
    id, kind: 'boss', hp: 100, maxHp: 100, abs: 0,
    atk: [{ A: 0, B: 0, C: 0 }, { A: 0, B: 0, C: 0 }, { A: 0, B: 0, C: 0 }],
    def: [{ A: 0, B: 0, C: 1 }, { A: 0, B: 0, C: 5 }, { A: 0, B: 0, C: 9 }],
  });
  const enc = newEncounter();
  enc.monsters.push(boss('BOSS1'), boss('BOSS2'));
  const r = playerAttack(s, enc, 'aoe', null, 0, d4(1), { targetIds: ['BOSS1', 'BOSS2'], modes: { BOSS1: 2, BOSS2: 1 } });
  assert.deepEqual(r.hits.map((h) => h.def.C), [9, 5]);
});

test('不可名狀：神秘招式造成傷害，回復損失生命的一半，上限 = 最大生命 × 5% × 等級', () => {
  const s = bare();
  s.skills = { 不可名狀: 2 };
  s.hp = 1;
  s.moves.push({ id: 'y', name: '神秘測試', school: '神秘', tracks: ['C'], extra: { C: 0 }, cost: {} });
  const enc = newEncounter(); enc.monsters.push(dummy(100000));
  const r = playerAttack(s, enc, 'y', '小怪1', 0, d4(2));
  const cap = Math.floor((maxHp(s) * 10) / 100);
  assert.equal(r.healed, Math.min(Math.floor(r.hits[0].lost / 2), cap));
  assert.ok(r.healed > 0);
  // 非神秘招式不觸發
  s.moves.push({ id: 'z', name: '西幻測試', school: '西幻', tracks: ['C'], extra: { C: 0 }, cost: {} });
  const hp = s.hp;
  assert.equal(playerAttack(s, enc, 'z', '小怪1', 0, d4(2)).healed, 0);
  assert.equal(s.hp, hp);
});

test('納米醫療蜂：花算力，回復最大生命 10/20/30%；目標數隨等級 2→3→4', () => {
  const s = bare();
  s.skills = { 納米醫療蜂: 1 };
  s.moves.push(moveFromCatalog('納米醫療蜂'));
  s.hp = 100;
  s.resources.算力 = 30;
  const r = useSupport(s, 's_納米醫療蜂', 1); // 16 算力、20%
  assert.equal(r.amount, Math.floor(maxHp(s) * 0.2));
  assert.equal(r.healed, Math.min(r.amount, maxHp(s) - 100));
  assert.equal(s.resources.算力, 14);
  assert.equal(r.targets, 2);
  s.resources.算力 = 30;
  s.skills.納米醫療蜂 = 5; assert.equal(useSupport(s, 's_納米醫療蜂', 0).targets, 3);
  s.resources.算力 = 30; s.skills.納米醫療蜂 = 9; assert.equal(useSupport(s, 's_納米醫療蜂', 0).targets, 4);
  s.resources.算力 = 7;
  assert.match(useSupport(s, 's_納米醫療蜂', 0).error, /資源不足/); // 要 8
});

test('生生造化印：護盾 = 最大生命 10/15/25%，先扣護盾；護盾破了抗性加成消失', () => {
  const s = bare();
  s.skills = { 生生造化印: 4 };
  s.moves.push(moveFromCatalog('生生造化印'));
  const r = useSupport(s, 's_生生造化印', 2); // 30 靈氣、25%
  assert.equal(r.amount, Math.floor(maxHp(s) * 0.25));
  assert.equal(r.res, 6); // 4 級 → +6 抗性免疫
  assert.equal(derivedStats(s).抗性免疫.total, 64 + 6);
  const hp = s.hp;
  const d = damagePlayer(s, 10);
  assert.deepEqual(d, { toShield: 10, toHp: 0 });
  assert.equal(s.hp, hp);
  damagePlayer(s, r.amount); // 打破護盾，多的才扣血
  assert.equal(s.hp, hp - 10);
  assert.equal(derivedStats(s).抗性免疫.total, 64); // 加成消失
});

test('暴徒主動招式：B、C 各 +1／級（物理骰轉成 B+C），不用 A 軌', () => {
  const s = fresh();
  const m = s.moves.find((x) => x.name === '暴徒');
  assert.deepEqual(m.tracks, ['B', 'C']);
  const a = attackDice(s, m);
  const p = derivedStats(s);
  assert.equal(a.dice.A, 0);
  assert.equal(a.dice.B, p.能量傷害.total + p.真實傷害.total + 1);
  assert.equal(a.dice.C, p.靈魂傷害.total + p.真實傷害.total + 1);
  s.skills.暴徒 = 3;
  assert.equal(attackDice(s, m).dice.B, p.能量傷害.total + p.真實傷害.total + 3);
});
