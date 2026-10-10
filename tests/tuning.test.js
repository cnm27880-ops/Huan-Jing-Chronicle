// 模擬戰的評價、策略與自動調整（GM 目標：2～3 回合、每場耗約一半資源）
import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, penalty, autoTune, scaleEncounter, TARGET, PLANS } from '../src/game/tuning.js';
import { simulateBattle, summarize } from '../src/game/simulate.js';
import { blankCharacter } from '../src/game/importBot.js';
import { moveFromCatalog } from '../src/game/skills.js';

const sum = (o = {}) => ({
  runs: 200, win: 1, lose: 0, timeout: 0, avgRounds: 2.5, avgDamagePerRound: 400, avgMonsterHp: 1000, avgDrain: 0.5,
  drainBy: { 魔力: 0.5, 毒性: 0.5 }, downRate: [{ name: 'a', rate: 0.1 }], ...o,
});

test('評價：2～3 回合、每場耗約一半、勝率夠高 → 全部達標', () => {
  const a = assess(sum());
  assert.equal(a.ok, true);
  assert.equal(penalty(sum()), 0);
  assert.match(a.advice[0], /符合目標/);
  assert.match(a.items.find((i) => i.key === 'drain').text, /2 場約耗 100%/);
});

test('評價：回合太長／太短都會給血量建議，數字依每回合傷害計算', () => {
  const slow = assess(sum({ avgRounds: 5, avgDamagePerRound: 400, avgMonsterHp: 2000 }));
  assert.equal(slow.items[0].status, 'high');
  assert.match(slow.advice.join(' '), /800～1,200/);
  const fast = assess(sum({ avgRounds: 1, avgDamagePerRound: 1000, avgMonsterHp: 1000 }));
  assert.equal(fast.items[0].status, 'low');
  assert.match(fast.advice.join(' '), /實際更高/);
});

test('評價：資源消耗太低／太高、勝率太低各有對應的建議', () => {
  assert.equal(assess(sum({ avgDrain: 0.1 })).items[1].status, 'low');
  assert.match(assess(sum({ avgDrain: 0.1 })).advice.join(' '), /攻擊強度/);
  assert.equal(assess(sum({ avgDrain: 0.9 })).items[1].status, 'high');
  const lose = assess(sum({ win: 0.5, lose: 0.5 }));
  assert.equal(lose.items[2].status, 'low');
  assert.match(lose.advice.join(' '), /降低/);
  assert.ok(penalty(sum({ avgRounds: 6, avgDrain: 0.1, win: 0.5 })) > 3);
});

test('自動調整：找到讓回合數與資源消耗都達標的血量與攻擊倍率', async () => {
  // 假的評估：回合數 = 血量 / 400；消耗 = 攻擊強度 / 200（上限 1）；勝率永遠 100%
  const evaluate = (specs) => sum({ avgRounds: specs[0].hp / 400, avgDrain: Math.min(1, specs[0].atkPower / 200), win: 1 });
  const out = await autoTune({ specs: [{ kind: 'boss', count: 1, hp: 4000, atkPower: 20 }], evaluate, yieldFn: async () => {} });
  assert.equal(out.penalty, 0);
  assert.ok(out.specs[0].hp >= TARGET.roundsMin * 400 && out.specs[0].hp <= TARGET.roundsMax * 400);
  assert.ok(Math.abs(out.specs[0].atkPower / 200 - TARGET.drain) <= TARGET.drainTol);
  assert.equal(out.specs.length, 1);
});

test('模擬戰：回報每場的資源與毒性消耗；沒有用途的資源不算進去', () => {
  const s = { ...blankCharacter('甲'), skills: { 爆裂火球: 5 } };
  s.baseStats = { ...s.baseStats, 生命: 500, 魔力: 100, 鬥氣: 50, 能量: 40 };
  s.moves.push({ ...moveFromCatalog('爆裂火球'), id: 'fb' });
  const r = simulateBattle([s], [{ kind: 'mob', count: 1, atkPower: 10, defPower: 10, hp: 100000 }], { maxRounds: 3 });
  assert.ok(r.drain.魔力 > 0 && r.drain.魔力 <= 1);
  assert.equal('能量' in r.drain, false); // 沒有任何招式會花能量（模擬也不做能量轉換）
  assert.ok('鬥氣' in r.drain); // 鬥氣有基礎用法（攻擊加骰），一律算
  assert.ok('毒性' in r.drain);
  const summary = summarize([r, r]);
  assert.ok(Math.abs(summary.avgDrain - r.drainAvg) < 1e-9);
  assert.equal(summary.avgMonsterHp, 100000);
});

test('扣分：幾乎每場都有人倒地、回合數顯示 3.0（內部 3.04）都不算超標', () => {
  const base = { runs: 200, win: 1, lose: 0, timeout: 0, avgRounds: 2.5, avgDamagePerRound: 400, avgMonsterHp: 1000, avgDrain: 0.5, drainBy: {}, downRate: [{ name: 'a', rate: 0.1 }] };
  assert.equal(penalty(base), 0);
  assert.ok(penalty({ ...base, downRate: [{ name: 'a', rate: 0.95 }] }) > 1);
  assert.equal(penalty({ ...base, avgRounds: 3.04 }), 0);
  assert.equal(assess({ ...base, avgRounds: 3.04 }).items[0].status, 'ok');
  assert.equal(assess({ ...base, avgRounds: 3.06 }).items[0].status, 'high');
});

test('保守版／激進版：都落在總目標內，各自偏向一邊；同一組數字對兩邊的罰分不同', () => {
  for (const p of Object.values(PLANS)) {
    assert.ok(p.roundsMin >= TARGET.roundsMin && p.roundsMax <= TARGET.roundsMax);
    assert.ok(p.drain - p.drainTol >= TARGET.drain - TARGET.drainTol - 1e-9 && p.drain + p.drainTol <= TARGET.drain + TARGET.drainTol + 1e-9); // 小數誤差
    assert.ok(p.winMin >= TARGET.winMin && p.downMax <= TARGET.downMax);
  }
  const slow = sum({ avgRounds: 2.9, avgDrain: 0.45, win: 0.97 }); // 偏輕鬆
  assert.equal(penalty(slow, PLANS.conservative), 0);
  assert.ok(penalty(slow, PLANS.aggressive) > 0);
  const tight = sum({ avgRounds: 2.1, avgDrain: 0.55, win: 0.92, downRate: [{ name: 'a', rate: 0.5 }] }); // 偏緊繃
  assert.equal(penalty(tight, PLANS.aggressive), 0);
  assert.ok(penalty(tight, PLANS.conservative) > 0);
  assert.equal(penalty(slow), 0); // 沒指定方案：照原本的總目標
});

test('自動調整：兩個方案找到的血量不同（保守回合長、激進回合短）', async () => {
  const evaluate = (specs) => sum({ avgRounds: specs[0].hp / 400, avgDrain: Math.min(1, specs[0].atkPower / 200), win: 1 });
  const run = (target) => autoTune({ specs: [{ kind: 'boss', count: 1, hp: 4000, atkPower: 20 }], evaluate, target, yieldFn: async () => {} });
  const [c, a] = [await run(PLANS.conservative), await run(PLANS.aggressive)];
  assert.equal(c.penalty, 0);
  assert.equal(a.penalty, 0);
  assert.ok(c.specs[0].hp > a.specs[0].hp);
  assert.ok(c.specs[0].atkPower < a.specs[0].atkPower);
});

test('scaleEncounter：固定敵人的血量與攻擊骰數按倍率縮放，不改原資料，有骰的軌道至少 1 顆', () => {
  const enc = { monsters: [
    { id: '小怪1', kind: 'mob', maxHp: 100, hp: 40, atk: { A: 10, B: 0, C: 1 } },
    { id: 'BOSS', kind: 'boss', maxHp: 1000, hp: 1000, atk: [{ A: 4, B: 4, C: 0 }, { A: 8, B: 0, C: 0 }, { A: 20, B: 20, C: 20 }] },
  ] };
  const out = scaleEncounter(enc, 2, 0.5);
  assert.deepEqual(out.monsters[0].atk, { A: 5, B: 0, C: 1 }); // C 只有 1 顆，縮小後仍保留 1
  assert.equal(out.monsters[0].maxHp, 200);
  assert.equal(out.monsters[0].hp, 200); // 生命補滿
  assert.deepEqual(out.monsters[1].atk[2], { A: 10, B: 10, C: 10 });
  assert.equal(enc.monsters[0].maxHp, 100); // 原資料不變
  assert.equal(enc.monsters[0].hp, 40);
});
