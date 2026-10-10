// 執行方式：npm test
// 模擬戰的公平性（src/game/fairness.js）、藥水「需要才喝」與血藥假設（simulate.js）、小怪血量固定（tuning.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { countOf } from '../src/game/engine.js';
import { prepPlayer, simulateBattle, summarize, seededRng } from '../src/game/simulate.js';
import { measureHits, rankPlayers, suggestMobHp, capsFor } from '../src/game/fairness.js';
import { scaleSpecs, scaleEncounter } from '../src/game/tuning.js';
import { resourceMax, resourceNow } from '../src/game/resources.js';
import { TOXICITY_MAX } from '../src/game/rules.js';

const hero = (k = 1) => {
  const c = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  for (const s of Object.keys(c.baseStats)) c.baseStats[s] = Math.round(c.baseStats[s] * k);
  return c;
};
const MOBS = [{ kind: 'mob', count: 3, atkPower: 50, defPower: 60, hp: 400 }];

test('量一次出手的傷害：強的玩家排前面，排名的第一名／最後一名正確', () => {
  const hits = measureHits([hero(1.5), hero(1), hero(0.6)], MOBS);
  assert.ok(hits[0].total > hits[1].total && hits[1].total > hits[2].total);
  const rank = rankPlayers(hits);
  assert.equal(rank.strongest, 0);
  assert.equal(rank.weakest, 2);
  assert.deepEqual(capsFor(3, 0, 0.6), [0.6, 1, 1]);
});

test('小怪血量建議：等於最弱玩家一次出手的傷害；他打不穿時改用中位數的一定比例並提醒', () => {
  const s = suggestMobHp([{ perTarget: 300, total: 300 }, { perTarget: 200, total: 200 }, { perTarget: 100, total: 100 }]);
  assert.equal(s.mobHp, 100);
  assert.equal(s.note, '');
  const weak = suggestMobHp([{ perTarget: 300 }, { perTarget: 200 }, { perTarget: 5 }]);
  assert.equal(weak.mobHp, 50); // 中位數 200 × 25%
  assert.match(weak.note, /打不穿/);
  assert.equal(suggestMobHp([]), null);
});

test('玩家複本：血藥備足到毒性 15 喝得滿；只出六成力＝資源六成、毒性先佔 6', () => {
  const p = prepPlayer(hero(), { supply: '回春湯' });
  assert.ok(countOf(p, '回春湯') >= Math.ceil(TOXICITY_MAX / 2));
  const c = prepPlayer(hero(), { cap: 0.6 });
  assert.equal(c.toxicity, 6);
  assert.equal(resourceNow(c, '魔力'), Math.floor(resourceMax(c, '魔力') * 0.6));
  assert.equal(resourceNow(c, '生命'), resourceMax(c, '生命')); // 生命不縮
});

test('藥水需要才喝：打得死的敵人、血量健康時，不會白白喝攻擊／防禦藥水', () => {
  const r = simulateBattle([hero()], [{ kind: 'mob', count: 1, atkPower: 1, defPower: 1, hp: 5 }], { rng: seededRng(3) });
  assert.equal(r.outcome, 'win');
  assert.equal(r.potions, 0);
  assert.equal(r.drain.毒性, 0);
});

test('每位玩家的表現：輸出、打倒、出招都記下來，占比加起來是 1', () => {
  const players = [hero(1.5), hero(0.6)];
  const res = Array.from({ length: 30 }, (_, i) => simulateBattle(players, MOBS, { rng: seededRng(i + 1) }));
  const s = summarize(res, ['強', '弱']);
  assert.equal(s.perPlayer.length, 2);
  assert.ok(Math.abs(s.perPlayer[0].share + s.perPlayer[1].share - 1) < 1e-9);
  assert.ok(s.perPlayer[0].dmg > s.perPlayer[1].dmg);
  assert.ok(s.perPlayer.every((p) => p.actions > 0 && p.drain >= 0 && p.drain <= 1));
  assert.equal(res[0].perPlayer.reduce((a, p) => a + p.kills, 0), 3); // 三隻都被打倒，沒有重複算
});

test('第一名只出六成力：隊伍比較難贏（強敵下勝率不會更高）', () => {
  const players = [hero(1.6), hero(0.7), hero(0.7)];
  const boss = [{ kind: 'boss', count: 1, atkPower: 400, defPower: 120, hp: 3000 }];
  const win = (caps) => summarize(Array.from({ length: 30 }, (_, i) => simulateBattle(players, boss, { rng: seededRng(i + 1), caps })), []).win;
  assert.ok(win([0.4, 1, 1]) <= win([1, 1, 1]));
});

test('縮放：有 BOSS 時小怪血量固定（菁英 2 倍）、BOSS 至少是小怪的 2 倍；沒有 BOSS 時全部照倍率', () => {
  const specs = [{ kind: 'boss', count: 1, hp: 1000, atkPower: 100 }, { kind: 'mob', count: 2, hp: 100, atkPower: 50 }, { kind: 'elite', count: 1, hp: 300, atkPower: 80 }];
  const out = scaleSpecs(specs, 0.01, 1, 200);
  assert.deepEqual(out.map((s) => s.hp), [400, 200, 400]);
  assert.deepEqual(scaleSpecs(specs.slice(1), 2, 1, 200).map((s) => s.hp), [200, 600]); // 沒 BOSS：照 kh
  const enc = { monsters: [{ id: 'BOSS1', kind: 'boss', maxHp: 1000, hp: 1000, atk: [{ A: 4, B: 0, C: 0 }] }, { id: '小怪1', kind: 'mob', maxHp: 100, hp: 100, atk: { A: 1, B: 1, C: 1 } }] };
  assert.deepEqual(scaleEncounter(enc, 3, 1, 150).monsters.map((m) => m.maxHp), [3000, 150]);
});

test('怪物攻擊分配：平均分散＝被打次數相差不超過 1；受傷占生命比例有記錄、評價會點名承受特別多的人', async () => {
  const players = [hero(), hero(), hero(), hero()];
  const boss = [{ kind: 'boss', count: 1, atkPower: 80, defPower: 80, hp: 30000 }]; // 打很久，BOSS 每回合 3 下
  const spread = simulateBattle(players, boss, { rng: seededRng(5), focus: 'spread', maxRounds: 8 });
  const hits = spread.perPlayer.map((p) => p.hit);
  assert.ok(Math.max(...hits) - Math.min(...hits) <= 1, `被打次數 ${hits}`);
  assert.ok(spread.perPlayer.every((p) => p.takenPct >= 0));
  const rnd = Array.from({ length: 30 }, (_, i) => simulateBattle(players, boss, { rng: seededRng(i + 1), focus: 'random', maxRounds: 8 }));
  const spreadRuns = Array.from({ length: 30 }, (_, i) => simulateBattle(players, boss, { rng: seededRng(i + 1), focus: 'spread', maxRounds: 8 }));
  const gap = (runs) => runs.reduce((a, r) => a + (Math.max(...r.perPlayer.map((p) => p.hit)) - Math.min(...r.perPlayer.map((p) => p.hit))), 0) / runs.length;
  assert.ok(gap(spreadRuns) < gap(rnd)); // 分散的差距比隨機小
  const { assess } = await import('../src/game/tuning.js');
  const base = { runs: 10, win: 1, lose: 0, timeout: 0, avgRounds: 2.5, avgRoundsWin: 2.5, avgDamagePerRound: 400, avgMonsterHp: 1000, avgDrain: 0.5, drainBy: {}, downRate: [] };
  const conc = assess({ ...base, perPlayer: [{ name: '甲', takenPct: 0.9 }, { name: '乙', takenPct: 0.1 }, { name: '丙', takenPct: 0.1 }] });
  assert.equal(conc.items.find((i) => i.key === 'spread').status, 'high');
  assert.match(conc.advice.join(' '), /甲 受的傷是全隊平均的/);
  const even = assess({ ...base, perPlayer: [{ name: '甲', takenPct: 0.3 }, { name: '乙', takenPct: 0.3 }] });
  assert.equal(even.items.find((i) => i.key === 'spread').status, 'ok');
});

test('集火第一名：怪物先打最強的人，他倒了才打下一個；記下第一次倒地的回合', async () => {
  const players = [hero(0.7), hero(1.6), hero(1)]; // 第 2 位最強、第 3 位次之
  const boss = [{ kind: 'boss', count: 1, atkPower: 500, defPower: 80, hp: 40000 }];
  const rank = rankPlayers(measureHits(players, boss));
  assert.deepEqual(rank.order, [1, 2, 0]);
  const r = simulateBattle(players, boss, { rng: seededRng(9), focus: 'strongest', focusOrder: rank.order, maxRounds: 4 });
  assert.ok(r.perPlayer[1].hit > 0 && r.perPlayer[1].hit >= r.perPlayer[2].hit && r.perPlayer[2].hit >= r.perPlayer[0].hit);
  if (r.perPlayer[1].firstDown) assert.ok(r.perPlayer[1].firstDown >= 1 && r.perPlayer[1].firstDown <= 4);
  const { assess, penalty } = await import('../src/game/tuning.js');
  const base = { runs: 10, win: 1, lose: 0, timeout: 0, avgRounds: 2.5, avgRoundsWin: 2.5, avgDamagePerRound: 400, avgMonsterHp: 1000, avgDrain: 0.5, drainBy: {}, downRate: [{ name: '甲', rate: 0.1 }, { name: '乙', rate: 1 }] };
  const perPlayer = [{ name: '甲', takenPct: 0.1, downRound: 0, downRate: 0.1, share: 0.3 }, { name: '乙', takenPct: 0.6, downRound: 1, downRate: 1, share: 0.1 }];
  const focused = { ...base, focus: 'strongest', rank: { strongest: 1, weakest: 0 }, perPlayer };
  assert.equal(assess(focused).items.find((i) => i.key === 'topSurvive').status, 'low'); // 第 1 回合就倒
  assert.match(assess(focused).advice.join(' '), /集火 乙/);
  assert.equal(assess({ ...focused, perPlayer: [perPlayer[0], { ...perPlayer[1], downRound: 2.6 }] }).items.find((i) => i.key === 'topSurvive').status, 'ok');
  assert.ok(penalty(focused) > 0); // 倒太早要扣分
  assert.equal(penalty({ ...focused, perPlayer: [perPlayer[0], { ...perPlayer[1], downRound: 2.6 }] }), 0); // 第一名一定倒地，但撐得夠久：不算「太兇」
});
