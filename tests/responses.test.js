// 執行方式：npm test
// 響應：腦機協議／殘缺筆記等「消耗資源加骰」、龍（能量傷害累積）、賽博駭客（靈魂未破防反擊）
import test from 'node:test';
import assert from 'node:assert/strict';
import { newEncounter, playerAttack, monsterAttack, attackDice, endBattle, monsterAbs } from '../src/game/combat.js';
import { moveFromCatalog, attackResponses, moveExtra } from '../src/game/skills.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
const d4 = (n) => () => (n - 1) / 4 + 0.01;
const dummy = (hp, def = { A: 0, B: 0, C: 0 }, atk = { A: 0, B: 0, C: 0 }) => ({ id: '小怪1', kind: 'mob', hp, maxHp: hp, abs: 0, atk, def });
const soulMove = () => ({ id: 'soul', name: '靈魂測試', school: '神秘', tracks: ['C'], extra: { C: 0 }, cost: {} });

test('攻擊響應：靈魂招式 + 腦機協議／殘缺筆記，各花資源、各加 1 顆骰；沒學的不會被扣', () => {
  const s = fresh();
  s.skills = { 腦機協議: 1, 殘缺筆記: 1 };
  s.moves.push(soulMove());
  s.hp = 100; s.resources.算力 = 10;
  const base = attackDice(s, s.moves.at(-1)).dice.C;
  const enc = newEncounter(); enc.monsters.push(dummy(100000));
  const r = playerAttack(s, enc, 'soul', '小怪1', 0, d4(1));
  assert.equal(r.atk.dice.C, base + 2);
  assert.deepEqual([r.cost.算力, r.cost.生命], [3, 2]);
  assert.equal(s.resources.算力, 7);
  assert.equal(s.hp, 98);
  // 沒學這些技能：不扣、不加
  const t = fresh(); t.skills = {}; t.moves.push(soulMove()); t.hp = 100;
  const enc2 = newEncounter(); enc2.monsters.push(dummy(100000));
  const r2 = playerAttack(t, enc2, 'soul', '小怪1', 0, d4(1));
  assert.equal(r2.atk.dice.C, attackDice(t, t.moves.at(-1)).dice.C);
  assert.equal(t.hp, 100);
});

test('攻擊響應：可以關掉；付不起的略過（不擋出招）；招式軌道不符不觸發', () => {
  const s = fresh();
  s.skills = { 腦機協議: 1, 殘缺筆記: 1 };
  s.moves.push(soulMove());
  s.hp = 100; s.resources.算力 = 2; // 付不起腦機協議的 3 算力
  const enc = newEncounter(); enc.monsters.push(dummy(100000));
  const r = playerAttack(s, enc, 'soul', '小怪1', 0, d4(1), { respOff: ['殘缺筆記'] });
  assert.equal(r.atk.dice.C, attackDice(s, s.moves.at(-1)).dice.C);
  assert.equal(s.resources.算力, 2);
  assert.equal(s.hp, 100);
  assert.ok(r.notes.some((x) => x.includes('腦機協議') && x.includes('略過')));
  // 物理招式不會觸發靈魂響應
  assert.deepEqual(attackResponses(s, { tracks: ['A'], kind: 'attack' }), []);
});

test('攻擊響應：魔能潮汐限西幻招式（+2 骰、3 魔力）；真龍九變圖免費 +4 骰', () => {
  const s = fresh();
  s.skills = { 魔能潮汐: 1, 真龍九變圖: 1 };
  const west = { id: 'w', name: '西幻測試', school: '西幻', tracks: ['A', 'B'], extra: { A: 0, B: 0, C: 0 }, cost: {} };
  const mystic = { ...west, id: 'y', school: '神秘' };
  s.moves.push(west, mystic);
  s.resources.魔力 = 50;
  const enc = newEncounter(); enc.monsters.push(dummy(100000));
  const r = playerAttack(s, enc, 'w', '小怪1', 0, d4(1));
  assert.equal(r.respDice.B, 2);
  assert.equal(r.respDice.A, 4);
  assert.equal(r.cost.魔力, 3);
  const enc2 = newEncounter(); enc2.monsters.push(dummy(100000));
  const r2 = playerAttack(s, enc2, 'y', '小怪1', 0, d4(1));
  assert.equal(r2.respDice.B, 0);
});

test('技能招式本身的消耗不再含「2 生命 + 3 算力」', () => {
  assert.deepEqual(moveFromCatalog('吞天噬血陣').cost, { 靈氣: 30 });
});

test('龍：造成能量傷害後，能量傷害 +3／級累積，下一次出招才吃到，戰鬥結束消失', () => {
  const s = fresh();
  s.skills = { 龍: 2 };
  const b = { id: 'b', name: '能量測試', school: '西幻', tracks: ['B'], extra: { A: 0, B: 0, C: 0 }, cost: {} };
  s.moves.push(b);
  const before = attackDice(s, b).dice.B;
  const enc = newEncounter(); enc.monsters.push(dummy(10_000_000));
  const r = playerAttack(s, enc, 'b', '小怪1', 0, d4(4));
  assert.equal(r.atk.dice.B, before); // 這一下還沒加
  assert.equal(s.buffs.dragon, 6);
  const r2 = playerAttack(s, enc, 'b', '小怪1', 0, d4(4));
  assert.equal(r2.atk.dice.B, before + 6);
  assert.equal(s.buffs.dragon, 12);
  // 沒打出傷害就不累積（怪物防禦極高）
  const t = fresh(); t.skills = { 龍: 1 }; t.moves.push(b);
  const enc2 = newEncounter(); enc2.monsters.push(dummy(1000, { A: 0, B: 99999, C: 0 }));
  playerAttack(t, enc2, 'b', '小怪1', 0, d4(1));
  assert.equal(t.buffs.dragon ?? 0, 0);
  endBattle(s);
  assert.equal(s.buffs.dragon ?? 0, 0);
});

test('賽博駭客：靈魂傷害未破防 → 攻擊方扣精神意志顆 D4；破防或沒有靈魂攻擊不觸發；一回合 1 次', () => {
  const s = fresh();
  s.skills = { 賽博駭客: 1 };
  const enc = newEncounter(); enc.round = 1;
  const m = dummy(1000, { A: 0, B: 0, C: 0 }, { A: 0, B: 0, C: 5 }); enc.monsters.push(m);
  // 玩家精神意志很高、怪物只有 5 顆 → 擲出怪物 1、玩家 4：未破防
  const rng = (() => { let i = 0; return () => ((i++ < 5 ? 1 : 4) - 1) / 4 + 0.01; })();
  const r = monsterAttack(s, enc, '小怪1', 0, rng);
  assert.ok(r.reflect && !r.reflect.skipped);
  assert.ok(r.reflect.dice > 0);
  assert.equal(m.hp, 1000 - r.reflect.lost);
  // 同一回合第二次：只提醒、不再扣
  const hp2 = m.hp;
  const r2 = monsterAttack(s, enc, '小怪1', 0, rng);
  assert.equal(r2.reflect?.skipped, true);
  assert.equal(m.hp, hp2);
  // 下一回合又能觸發
  enc.round = 2;
  assert.ok(monsterAttack(s, enc, '小怪1', 0, rng).reflect?.lost >= 0);
  // 沒學 / 沒有靈魂攻擊：不觸發
  const t = fresh(); t.skills = {};
  const enc3 = newEncounter(); enc3.monsters.push(dummy(1000, {}, { A: 0, B: 0, C: 5 }));
  assert.equal(monsterAttack(t, enc3, '小怪1', 0, d4(1)).reflect, null);
  const enc4 = newEncounter(); enc4.monsters.push(dummy(1000, {}, { A: 5, B: 0, C: 0 }));
  assert.equal(monsterAttack(s, enc4, '小怪1', 0, d4(1)).reflect, null);
});

test('幽暗魔火陣：多目標 +2／4／6 骰，只打單一目標改成 +4／8／12；至尊術士每級 2 → 單一每級 3（不再 5）', () => {
  const s = fresh();
  s.skills = { 幽暗魔火陣: 5, 至尊術士: 3 };
  const fire = moveFromCatalog('幽暗魔火陣');
  assert.equal(moveExtra(s, fire).B, 4);
  assert.equal(moveExtra(s, { ...fire, single: true }).B, 8);
  const sup = moveFromCatalog('至尊術士');
  assert.equal(moveExtra(s, sup).B, 6);
  assert.equal(moveExtra(s, { ...sup, single: true }).B, 9);
  // 出招：選 1 個目標 vs 2 個目標
  s.moves.push(fire); s.resources.魔力 = 100;
  const enc = newEncounter(); enc.monsters.push(dummy(1e6), { ...dummy(1e6), id: '小怪2' });
  const one = playerAttack(s, enc, fire.id, '小怪1', 0, d4(1), { targetIds: ['小怪1'] });
  const two = playerAttack(s, enc, fire.id, '小怪1', 0, d4(1), { targetIds: ['小怪1', '小怪2'] });
  assert.equal(one.atk.dice.B - two.atk.dice.B, 4);
});

test('漆黑血刃：神秘招式花 16 生命，1／5／9 級 +4／6／8，加在招式用到的每一軌；大魔導師 5 魔力／顆加能量骰；泰坦永久減絕防', () => {
  const s = fresh();
  s.skills = { 漆黑血刃: 5, 大魔導師: 1, 泰坦: 5 };
  s.hp = 200; s.resources.魔力 = 100;
  const mv = { id: 'bm', name: '雙軌', school: '神秘', tracks: ['B', 'C'], extra: { A: 0, B: 0, C: 0 }, cost: {} };
  s.moves.push(mv);
  const enc = newEncounter(); enc.monsters.push({ ...dummy(1e7), abs: 20 });
  const r = playerAttack(s, enc, 'bm', '小怪1', 0, d4(1), { mage: 20 });
  assert.deepEqual([r.respDice.B, r.respDice.C], [6 + 12, 6]); // 大魔導師上限 12
  assert.equal(r.cost.生命, 16);
  assert.equal(r.cost.魔力, 60);
  // 泰坦：物理傷害後絕防 −15；沒有物理就不扣
  const phys = { id: 'ph', name: '物理', school: '西幻', tracks: ['A'], extra: { A: 0, B: 0, C: 0 }, cost: {} };
  s.moves.push(phys);
  assert.equal(monsterAbs(enc.monsters[0]), 20);
  playerAttack(s, enc, 'ph', '小怪1', 0, d4(4));
  assert.equal(monsterAbs(enc.monsters[0]), 5);
  playerAttack(s, enc, 'ph', '小怪1', 0, d4(4)); // 不疊加
  assert.equal(monsterAbs(enc.monsters[0]), 5);
});
