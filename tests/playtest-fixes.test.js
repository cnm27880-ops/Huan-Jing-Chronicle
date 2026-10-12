// 執行方式：npm test
// 2026-10-12 正式跑團後的修正：恐怖機甲、機甲駕駛員、我的刀盾、浮腫之軀、奶龍寶庫、生命倒扣、保溫針織袋、黑市團同步、友方 NPC
import test from 'node:test';
import assert from 'node:assert/strict';
import { newEncounter, playerAttack, attackDice, damagePlayer, healPlayer, isDowned, daoDunDice, useSwell, resolveChosenTrack } from '../src/game/combat.js';
import { moveFromCatalog, daoDunLeft } from '../src/game/skills.js';
import { endSession, spitToBag, takeFromBag, foodBags, FOOD_BAG } from '../src/game/engine.js';
import { equip, equipSlots, equipmentEffects } from '../src/game/equipment.js';
import { syncBlackSession, marketToday, specialLeft, specialTrade, SPECIAL_BUY } from '../src/game/market.js';
import { applyMail } from '../src/game/mail.js';
import { validateAlly, addAlly, allyAttack, monsterHitsAlly, removeAlly, insertRandom } from '../src/game/ally.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => {
  const s = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  s.baseStats = { ...s.baseStats, 算力: 200, 物理傷害: 10, 能量傷害: 50, 靈魂傷害: 20, 真實傷害: 0 };
  s.resources = { ...s.resources, 算力: 200 };
  s.equipment = { weapon: null, armor: null, acc1: null, acc2: null }; // 裝備不干擾骰數
  s.buffs = { atk: 0, def: 0 };
  return s;
};
const d4 = (n) => () => (n - 1) / 4 + 0.01;
const dummy = (hp = 100000) => ({ id: '小怪1', kind: 'mob', hp, maxHp: hp, abs: 0, atk: { A: 0, B: 0, C: 0 }, def: { A: 0, B: 0, C: 0 } });
const bind = (s, skill) => { const m = { ...moveFromCatalog(skill), id: 'x' }; s.moves.push(m); return m; };

test('恐怖機甲：三軌都用能量傷害骰（各自對該軌防禦），花 20 算力；響應每級 +3 顆能量骰三軌都吃', () => {
  const s = fresh();
  s.skills = { 恐怖機甲: 2 };
  const m = bind(s, '恐怖機甲');
  assert.deepEqual(m.cost, { 算力: 20 });
  const d = attackDice(s, m).dice;
  assert.equal(d.B, 50 + 6); // 能量 50 + 2 級 × 3
  assert.equal(d.A, d.B); // 物理軌用能量骰
  assert.equal(d.C, d.B); // 靈魂軌也是
  const enc = newEncounter(); enc.monsters.push(dummy());
  const r = playerAttack(s, enc, 'x', '小怪1', 0, d4(1));
  assert.equal(r.error, undefined);
  assert.equal(s.resources.算力, 180);
  assert.deepEqual(r.result.tracks.map((t) => t.atkDice), [56, 56, 56]);
});

test('機甲駕駛員：擇一軌（不是兩軌都打）；可以選物理或能量，沒選就挑攻擊骰多的', () => {
  const s = fresh();
  s.skills = { 機甲駕駛員: 4 };
  const m = bind(s, '機甲駕駛員');
  assert.deepEqual(resolveChosenTrack(s, m).tracks, ['B']); // 能量 50 > 物理 10
  const enc = newEncounter(); enc.monsters.push(dummy());
  const auto = playerAttack(s, enc, 'x', '小怪1', 0, d4(1));
  assert.deepEqual(auto.result.tracks.filter((t) => t.atkDice > 0).map((t) => t.track), ['B']);
  assert.equal(auto.atk.dice.B, 50 + 6); // 4 級：每 2 級 +3
  const pickA = playerAttack(s, enc, 'x', '小怪1', 0, d4(1), { track: 'A' });
  assert.deepEqual(pickA.result.tracks.filter((t) => t.atkDice > 0).map((t) => t.track), ['A']);
  assert.equal(pickA.atk.dice.A, 10 + 6);
  assert.equal(pickA.atk.dice.B, 0);
});

test('我的刀盾：防具防禦 1/5 → 同屬性傷害骰（只加在用到的軌道）；一次跑團 2／4／6／8 次，結束本次跑團恢復', () => {
  const s = fresh();
  s.skills = { 我的刀盾: 3 };
  s.equipment.armor = { id: 99, tier: '傳說', slot: 'armor', effects: [{ stat: '抗性免疫', value: 24 }, { stat: '絕對防禦', value: 10 }] };
  assert.deepEqual(daoDunDice(s), { A: 0, B: 4, C: 0, T: 2 });
  s.moves.push({ id: 'e', name: '能量測試', tracks: ['B'], extra: { B: 0 }, cost: {} });
  const base = attackDice(s, s.moves.at(-1)).dice.B;
  const enc = newEncounter(); enc.monsters.push(dummy());
  assert.equal(daoDunLeft(s), 4); // 3 級＝4 次
  const r = playerAttack(s, enc, 'e', '小怪1', 0, d4(1), { daoDun: true });
  assert.equal(r.atk.dice.B, base + 4 + 2);
  assert.equal(daoDunLeft(s), 3);
  const plain = playerAttack(s, enc, 'e', '小怪1', 0, d4(1));
  assert.equal(plain.atk.dice.B, base); // 沒勾就不用
  s.daoDunUsed = 4;
  const out = playerAttack(s, enc, 'e', '小怪1', 0, d4(1), { daoDun: true });
  assert.equal(out.atk.dice.B, base); // 次數用完：略過
  assert.ok(out.notes.some((n) => /用完/.test(n)));
  endSession(s);
  assert.equal(daoDunLeft(s), 4);
});

test('浮腫之軀主動：花 X 生命得 2X 治療點；X 上限 3／6／9／12；不能付到倒地；隊友收到固定點數治療（倒地的回到正數才站起來）', () => {
  const s = fresh();
  s.skills = { 浮腫之軀: 3 };
  s.hp = 20;
  assert.match(useSwell(s, 7).error, /1～6/);
  const r = useSwell(s, 6);
  assert.deepEqual([r.x, r.points, s.hp], [6, 12, 14]);
  s.hp = 3;
  assert.match(useSwell(s, 3).error, /資源不足/);
  const mate = fresh();
  mate.hp = -5;
  const got = applyMail(mate, { kind: 'support', support: 'points', amount: 4, skill: '浮腫之軀', fromName: '夜見祈' });
  assert.equal(mate.hp, -1);
  assert.equal(isDowned(mate), true);
  assert.match(got.lines[0], /仍然倒地/);
  applyMail(mate, { kind: 'support', support: 'points', amount: 8, skill: '浮腫之軀', fromName: '夜見祈' });
  assert.equal(mate.hp, 7);
  assert.equal(isDowned(mate), false);
});

test('生命倒扣：受傷可以變負數，回血從負數往上加', () => {
  const s = fresh();
  s.hp = 10;
  damagePlayer(s, 25);
  assert.equal(s.hp, -15);
  healPlayer(s, 10);
  assert.equal(s.hp, -5);
  assert.equal(isDowned(s), true);
});

test('奶龍寶庫：1／5／9 級各多一個初階武器欄、10 級多一個進階飾品欄；額外欄只放該等級；等級掉了不算數值', () => {
  const s = fresh();
  s.skills = { 奶龍寶庫: 5 };
  assert.deepEqual(equipSlots(s), ['weapon', 'armor', 'acc1', 'acc2', 'weapon2', 'weapon3']);
  s.gear = [
    { id: 1, tier: '初階', slot: 'weapon', effects: [{ stat: '物理傷害', value: 3 }] },
    { id: 2, tier: '大師', slot: 'weapon', effects: [{ stat: '物理傷害', value: 9 }] },
  ];
  assert.match(equip(s, 2, 'weapon2'), /只能放初階武器/);
  assert.equal(equip(s, 1, 'weapon2'), null);
  assert.equal(equipmentEffects(s).物理傷害, 3);
  assert.match(equip(s, 2, 'weapon4'), /沒有這個裝備欄/);
  s.skills.奶龍寶庫 = 0;
  assert.equal(equipmentEffects(s).物理傷害, undefined); // 欄位沒了：不算
  s.skills.奶龍寶庫 = 10;
  assert.ok(equipSlots(s).includes('acc3'));
});

test('福瑞保溫針織袋：有幾個就幾格；胃袋吐進袋子、放回胃袋；結束本次跑團時非熟練料理消耗、熟練料理留著', () => {
  const s = fresh();
  s.inventory = { ...s.inventory, [FOOD_BAG]: 2 };
  s.sessionStomach = [{ food: '碳烤肉排' }, { food: '滿漢全席' }, { food: '拉麵' }];
  assert.equal(spitToBag(s, 0), null);
  assert.equal(spitToBag(s, 0), null); // 滿漢全席
  assert.match(spitToBag(s, 0), /裝滿/);
  assert.deepEqual(foodBags(s).map((x) => x.food), ['碳烤肉排', '滿漢全席']);
  assert.deepEqual(s.sessionStomach.map((x) => x.food), ['拉麵']);
  assert.equal(takeFromBag(s, 0), null);
  assert.deepEqual(s.sessionStomach.map((x) => x.food), ['拉麵', '碳烤肉排']);
  assert.equal(spitToBag(s, 1), null);
  const gone = endSession(s);
  assert.deepEqual(gone, ['滿漢全席']);
  assert.deepEqual(foodBags(s).map((x) => x.food), ['碳烤肉排']);
  assert.deepEqual(s.sessionStomach, []);
  const none = fresh(); none.inventory = {}; none.sessionStomach = [{ food: '拉麵' }];
  assert.match(spitToBag(none, 0), /沒有/);
});

test('黑市團：跟著房間（GM 開關）同步；新的一團交易數歸零，同一團重新連線不歸零；關團就不能交易', () => {
  const s = fresh();
  s.inventory = { ...s.inventory, 代金券: 1_000_000 };
  syncBlackSession(s, { open: true, id: 3 });
  assert.equal(marketToday(s).session.open, true);
  assert.equal(specialTrade(s, 'buy', Object.keys(SPECIAL_BUY)[0], 2).error, undefined);
  assert.equal(specialLeft(s), 48);
  syncBlackSession(s, { open: true, id: 3 });
  assert.equal(specialLeft(s), 48); // 同一團
  syncBlackSession(s, { open: false, id: 3 });
  assert.match(specialTrade(s, 'buy', Object.keys(SPECIAL_BUY)[0], 1).error, /黑市團/);
  syncBlackSession(s, { open: true, id: 4 });
  assert.equal(specialLeft(s), 50); // 新的一團
});

test('友方 NPC：檢查輸入、攻擊怪物（用掉 B 蓄力）、被怪物打（倒扣）、移除時先攻順序跟著調整', () => {
  assert.match(validateAlly({ name: '', hp: 10 }).error, /名稱/);
  assert.match(validateAlly({ name: 'x', hp: 0 }).error, /血量/);
  assert.match(validateAlly({ name: 'x', hp: 5, support: { kind: 'heal', pct: 0 } }).error, /輔助/);
  const v = validateAlly({ name: '傭兵', hp: 50, atk: '20A', def: '5A 5B 5C', abs: 2, support: { kind: 'heal', pct: 10 } });
  assert.deepEqual([v.ally.atk, v.ally.def, v.ally.support], [{ A: 20, B: 0, C: 0 }, { A: 5, B: 5, C: 5 }, { kind: 'heal', pct: 10 }]);
  const enc = newEncounter();
  enc.monsters.push({ ...dummy(100), def: { A: 4, B: 0, C: 0 }, abs: 1, atk: { A: 0, B: 30, C: 0 } });
  const a = addAlly(enc, v.ally);
  assert.equal(a.id, '友軍1');
  const hit = allyAttack(enc, a.id, '小怪1', 0, d4(4));
  assert.equal(hit.result.tracks[0].atkDice, 20);
  assert.equal(hit.def.A, 4 + 1); // 絕防加在有攻擊骰的軌道
  assert.equal(hit.result.total, 80 - 20);
  assert.equal(enc.monsters[0].hp, 40);
  const back = monsterHitsAlly(enc, '小怪1', a.id, 0, d4(4));
  assert.equal(back.result.total, 120 - 28); // 30B×4 − (5+2)×4
  assert.equal(a.hp, 50 - 92);
  assert.equal(back.newlyDowned, true);
  assert.match(allyAttack(enc, a.id, '小怪1').error, /倒地/);
  enc.order = [{ kind: 'player', uid: '1', name: 'p' }, { kind: 'ally', id: a.id, name: a.name }, { kind: 'monster', id: '小怪1' }];
  Object.assign(enc, { locked: true, turn: 2 });
  removeAlly(enc, a.id);
  assert.deepEqual([enc.order.length, enc.turn, enc.order[enc.turn].id], [2, 1, '小怪1']);
  // 插進隨機位置：插在輪到的位置之前，輪到的人不變
  const rng = () => 0; rng.int = () => 1;
  insertRandom(enc, { kind: 'monster', id: '小怪9' }, rng);
  assert.deepEqual([enc.order[0].id, enc.order[enc.turn].id], ['小怪9', '小怪1']);
});
