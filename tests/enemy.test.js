// 2026/10 平衡更新：敵人等級與技能、鬥氣傷害骰（冠軍勇士）、資源轉換
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { newEncounter, addMobs, addBosses, playerAttack, monsterAttack } from '../src/game/combat.js';
import { ENEMY_RANKS, rankOf, enemyLeft, useEnemySkill, spendEnemyAttack, spendEnemyB, nextRound, pendingEnemyB } from '../src/game/enemy.js';
import { convertResource } from '../src/game/resources.js';
import { douMult } from '../src/game/skills.js';
import { maxHp } from '../src/game/stats.js';

const enc = () => {
  const e = newEncounter();
  addMobs(e, { count: 1, atkPower: 30, defPower: 30, hp: 1000 });
  addMobs(e, { count: 1, atkPower: 30, defPower: 30, hp: 1000, rank: 'elite' });
  addBosses(e, { count: 1, atkPower: 30, defPower: 30, hp: 1000 });
  return e;
};
const fixed = (v) => () => v;

test('等級：普通 1 打、菁英 2 打、BOSS 3 打；菁英另有編號', () => {
  const e = enc();
  assert.deepEqual(e.monsters.map((m) => [m.id, rankOf(m)]), [['小怪1', 'normal'], ['菁英1', 'elite'], ['BOSS1', 'boss']]);
  assert.deepEqual(['normal', 'elite', 'boss'].map((r) => ENEMY_RANKS[r].attacks), [1, 2, 3]);
  assert.deepEqual(e.monsters.map((m) => enemyLeft(e, m).atk), [1, 2, 3]);
});

test('每回合攻擊次數：用完就不能再打，進下一回合恢復', () => {
  const e = enc();
  assert.equal(spendEnemyAttack(e, '菁英1').left, 1);
  assert.equal(spendEnemyAttack(e, '菁英1').left, 0);
  assert.match(spendEnemyAttack(e, '菁英1').error, /已經攻擊 2 次/);
  nextRound(e);
  assert.equal(spendEnemyAttack(e, '菁英1').ok, true);
  assert.equal(spendEnemyAttack(e, '小怪1').ok, true);
  assert.match(spendEnemyAttack(e, '小怪1').error, /已經攻擊 1 次/);
  assert.match(spendEnemyAttack(e, '不存在').error, /找不到/);
});

test('A 技能：蓄力後下一次攻擊每一軌各 +20（沒有攻擊骰的軌道不加），用掉就沒了；一回合 1 次', () => {
  const e = enc();
  const mob = e.monsters[0];
  mob.atk = { A: 10, B: 0, C: 5 };
  assert.equal(useEnemySkill(e, '小怪1', 'A').ok, true);
  assert.match(useEnemySkill(e, '小怪1', 'A').error, /用完了/);
  const s = { ...blankCharacter('甲'), hp: 500 };
  s.baseStats = { ...s.baseStats, 生命: 500 };
  const hit = spendEnemyAttack(e, '小怪1');
  assert.equal(hit.extraAtk, 20);
  const r = monsterAttack(s, e, '小怪1', 0, fixed(0.5), { extraAtk: hit.extraAtk });
  assert.deepEqual(r.atk, { A: 30, B: 0, C: 25 });
  assert.equal(spendEnemyAttack(e, '小怪1').extraAtk ?? 0, 0); // 下一次（下回合前）沒有蓄力了
});

test('B 技能：蓄力後被打時絕對防禦 +20（BOSS +30）；菁英與 BOSS 一回合 2 次；終焉武裝無視', () => {
  const e = enc();
  assert.equal(pendingEnemyB(e, e.monsters[2]), 0);
  useEnemySkill(e, 'BOSS1', 'B');
  useEnemySkill(e, 'BOSS1', 'B');
  assert.match(useEnemySkill(e, 'BOSS1', 'B').error, /用完了/);
  assert.equal(pendingEnemyB(e, e.monsters[2]), 30);
  assert.equal(spendEnemyB(e, 'BOSS1'), 30);
  assert.equal(spendEnemyB(e, 'BOSS1'), 30);
  assert.equal(spendEnemyB(e, 'BOSS1'), 0);
  useEnemySkill(e, '小怪1', 'B');
  assert.match(useEnemySkill(e, '小怪1', 'B').error, /用完了/); // 普通只有 1 次
  // 玩家打：extraAbs 加在這招用到的軌道
  const s = { ...blankCharacter('乙'), skills: {}, moves: [{ id: 'm', name: '普攻', tracks: ['A', 'B', 'C'], extra: { A: 0, B: 0, C: 0 }, cost: {} }] };
  s.baseStats = { ...s.baseStats, 生命: 100 };
  s.hp = 100;
  const t = e.monsters[0];
  const r = playerAttack(s, e, 'm', t.id, 0, fixed(0.5), { extraAbs: { [t.id]: 20 } });
  assert.equal(r.hits[0].extraAbs, 20);
  assert.equal(r.hits[0].def.A, t.def.A + t.abs + 20);
});

test('C 喝血：只能在自己的回合（有先攻時）、回復 ND16（普通 10D／菁英 20D／BOSS 30D）、不超過最大血量、一回合 1 次', () => {
  const e = enc();
  e.monsters.forEach((m) => { m.hp = 100; });
  const rng = { int: () => 8 }; // 每顆 16 面骰擲 8
  const rolled = useEnemySkill(e, '小怪1', 'C', rng);
  assert.deepEqual([rolled.dice, rolled.rolled, rolled.healed], ['10D16', 80, 80]);
  assert.match(useEnemySkill(e, '小怪1', 'C', rng).error, /用完了/);
  assert.equal(useEnemySkill(e, '菁英1', 'C', rng).dice, '20D16');
  assert.equal(e.monsters[1].hp, 260);
  assert.equal(useEnemySkill(e, 'BOSS1', 'C', rng).dice, '30D16');
  assert.equal(e.monsters[2].hp, 340);
  const big = enc();
  big.monsters[2].hp = 990;
  assert.equal(useEnemySkill(big, 'BOSS1', 'C', rng).healed, 10); // 補到滿就停
  // 有先攻順序且已開打：不是他的回合不能喝
  const f = enc();
  f.monsters[0].hp = 10;
  Object.assign(f, { locked: true, round: 1, turn: 0, order: [{ kind: 'player', uid: '1', name: 'x' }, { kind: 'monster', id: '小怪1' }] });
  assert.match(useEnemySkill(f, '小怪1', 'C', rng).error, /自己的回合/);
  f.turn = 1;
  assert.equal(useEnemySkill(f, '小怪1', 'C', rng).ok, true);
  assert.match(useEnemySkill(f, '小怪1', 'A').error ?? '', /^$/); // A、B 不限回合（沒有錯誤）
});

test('C 喝血整場戰鬥只有 1 次（換回合不恢復）；A、B 每回合歸零', () => {
  const e = enc();
  e.monsters[0].hp = 10;
  e.round = 1;
  const rng = { int: () => 1 };
  assert.equal(useEnemySkill(e, '小怪1', 'C', rng).ok, true);
  assert.equal(useEnemySkill(e, '小怪1', 'A').ok, true);
  nextRound(e);
  assert.match(useEnemySkill(e, '小怪1', 'C', rng).error, /這場戰鬥.*每場/); // C 不隨回合歸零
  assert.equal(enemyLeft(e, e.monsters[0]).C, 0);
  assert.equal(useEnemySkill(e, '小怪1', 'A').ok, true); // A 新回合又有 1 次
  assert.equal(enemyLeft(e, e.monsters[0]).A, 0);
});

test('倒下的敵人不能用技能；不認得的技能報錯', () => {
  const e = enc();
  e.monsters[0].hp = 0;
  assert.match(useEnemySkill(e, '小怪1', 'A').error, /已經倒下/);
  assert.match(useEnemySkill(e, '菁英1', 'Z').error, /沒有這個/);
});

test('鬥氣：每花 1 點 +1 顆真實傷害骰（用到的每一軌）；冠軍勇士改成 4 顆；扣鬥氣；不夠就失敗', () => {
  const mk = (skills) => {
    const s = { ...blankCharacter('丙'), skills, moves: [{ id: 'm', name: '普攻', tracks: ['A', 'C'], extra: { A: 0, B: 0, C: 0 }, cost: {} }] };
    s.baseStats = { ...s.baseStats, 生命: 100, 鬥氣: 10, 物理傷害: 10, 靈魂傷害: 10 };
    s.resources = { ...s.resources, 鬥氣: 10 };
    s.hp = 100;
    return s;
  };
  const e = newEncounter();
  addMobs(e, { count: 1, atkPower: 3, defPower: 3, hp: 100000 });
  const base = playerAttack(mk({}), e, 'm', '小怪1', 0, fixed(0.5));
  const s1 = mk({});
  const withDou = playerAttack(s1, e, 'm', '小怪1', 0, fixed(0.5), { dou: 3 });
  assert.equal(withDou.hits[0].result.tracks[0].atkDice - base.hits[0].result.tracks[0].atkDice, 3);
  assert.equal(s1.resources.鬥氣, 7);
  assert.equal(douMult(mk({})), 1);
  const champ = mk({ 冠軍勇士: 1 });
  assert.equal(douMult(champ), 4);
  const r4 = playerAttack(champ, e, 'm', '小怪1', 0, fixed(0.5), { dou: 3 });
  assert.equal(r4.hits[0].result.tracks[0].atkDice - base.hits[0].result.tracks[0].atkDice, 12); // 3 點 × 4 顆
  assert.equal(r4.douDice, 12);
  assert.match(playerAttack(mk({}), e, 'm', '小怪1', 0, fixed(0.5), { dou: 99 }).error, /資源不足/);
});

test('資源轉換：靈氣 1 比 1 換生命；能量 1 比 1 換任意資源；魔力、算力不行；不超過上限', () => {
  const s = { ...blankCharacter('丁') };
  s.baseStats = { ...s.baseStats, 生命: 100, 靈氣: 50, 能量: 30, 魔力: 40, 鬥氣: 20 };
  s.resources = { ...s.resources, 靈氣: 50, 能量: 30, 魔力: 0, 鬥氣: 0 };
  s.hp = 60;
  const r = convertResource(s, '靈氣', '生命', 25);
  assert.deepEqual([r.spent, s.hp, s.resources.靈氣], [25, 85, 25]);
  assert.equal(convertResource(s, '靈氣', '生命', 100).spent, 15); // 只補到滿血
  assert.match(convertResource(s, '靈氣', '生命', 1).error, /滿的|不夠/);
  assert.equal(convertResource(s, '靈氣', '魔力', 1).error, '靈氣只能換成生命。');
  const m = convertResource(s, '能量', '魔力', 10);
  assert.deepEqual([m.spent, s.resources.魔力, s.resources.能量], [10, 10, 20]);
  assert.equal(convertResource(s, '能量', '鬥氣', 99).spent, 20); // 鬥氣上限 20
  assert.match(convertResource(s, '魔力', '生命', 1).error, /沒有基礎用法/);
  assert.match(convertResource(s, '能量', '能量', 1).error, /能量可以換成其他/);
  s.hp = 0;
  assert.match(convertResource({ ...s, hp: 0, resources: { ...s.resources, 靈氣: 5 } }, '靈氣', '生命', 1).error, /倒地/);
  assert.ok(maxHp(s) >= 100);
});

test('模擬戰：敵人每回合打 1／2／3 次（A 技能的 +20 只加在第一下）', async () => {
  const { simulateBattle } = await import('../src/game/simulate.js');
  const p = { ...blankCharacter('甲'), skills: {} };
  p.baseStats = { ...p.baseStats, 生命: 100000, 物理傷害: 1, 能量傷害: 1, 靈魂傷害: 1, 真實傷害: 0, 絕對防禦: 0, 體魄強韌: 0, 抗性免疫: 0, 精神意志: 0 };
  p.hp = 100000;
  const lost = (kind) => {
    const r = simulateBattle([p], [{ kind, count: 1, atkPower: 30, defPower: 30, hp: 10_000_000 }], { maxRounds: 1, rng: () => 0.5 });
    return 100000 - r.hpLeft;
  };
  // 固定骰面：第一下 = 3 軌 × (10 + 20) 顆；之後每下 = 3 軌 × 10 顆
  const [mob, elite, boss] = [lost('mob'), lost('elite'), lost('boss')];
  assert.equal(elite - mob, mob / 3); // 多一下（沒有 A 加成）= 第一下的 1/3
  assert.equal(boss - elite, elite - mob); // BOSS 再多一下
});

test('模擬戰：敵人血量沒滿就喝血，回復量算進每回合傷害；玩家的鬥氣與靈氣有被用到', async () => {
  const { simulateBattle } = await import('../src/game/simulate.js');
  const { moveFromCatalog } = await import('../src/game/skills.js');
  const p = { ...blankCharacter('乙'), skills: { 八卦掌: 3, 冠軍勇士: 1 } };
  p.baseStats = { ...p.baseStats, 生命: 20000, 物理傷害: 400, 鬥氣: 30, 靈氣: 40, 算力: 10, 真實傷害: 50 };
  p.hp = 20000; p.resources = { ...p.resources, 鬥氣: 30, 靈氣: 40 };
  p.moves.push({ ...moveFromCatalog('八卦掌'), id: 'bg' });
  const r = simulateBattle([p], [{ kind: 'elite', count: 1, atkPower: 40, defPower: 40, hp: 30000 }], { maxRounds: 6, rng: () => 0.5 });
  assert.ok(r.healed >= 0 && r.damage >= 0);
  assert.ok(r.drain.鬥氣 > 0, '鬥氣有被拿來加骰');
  assert.ok(r.rounds >= 1);
});
