// 執行方式：npm test
// 模擬戰的「自動配置敵人」（src/game/design.js）、輸出分配評分（tuning.js）、怪物每下傷害統計（simulate.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { TEMPLATE, DEF_GRID, damageCurve, rankFromCurve, makeEvaluator, buildSpecs, designEncounter } from '../src/game/design.js';
import { penalty, assess, shareInfo } from '../src/game/tuning.js';
import { simulateBattle, summarize, seededRng } from '../src/game/simulate.js';

const hero = (k = 1) => {
  const c = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  for (const s of Object.keys(c.baseStats)) c.baseStats[s] = Math.round(c.baseStats[s] * k);
  return c;
};
const TEAM = [2, 1.4, 1, 0.6].map(hero);
const NAMES = ['甲', '乙', '丙', '丁'];

test('傷害曲線：防禦越高，每位玩家一次出手的傷害越低；排名第一的是最強的人', () => {
  const curve = damageCurve(TEAM, { runs: 4, grid: [0, 300, 900] });
  assert.ok(curve[0].strong > curve[1].strong && curve[1].strong > curve[2].strong);
  assert.ok(curve[0].weak <= curve[0].med && curve[0].med <= curve[0].strong);
  assert.equal(rankFromCurve(curve).strongest, 0);
  assert.equal(rankFromCurve(curve).weakest, 3);
});

test('配置轉成敵人：有 BOSS 時 BOSS 血量由旋鈕決定且不低於小怪的 2 倍；沒有 BOSS 時旋鈕縮放小怪與菁英；攻擊照倍率', () => {
  const c = { nMob: 5, nElite: 2, boss: true, defMob: 100, defElite: 200, defBoss: 400, mobHp: 500, eliteHp: 1000, bossBase: 1000 };
  const specs = buildSpecs(c, 3, 0.5);
  assert.deepEqual(specs.map((s) => [s.kind, s.count]), [['mob', 5], ['elite', 2], ['boss', 1]]);
  assert.equal(specs[0].hp, 500);
  assert.equal(specs[2].hp, 3000);
  assert.equal(specs[0].atkPower, Math.round(TEMPLATE.mob.atkPower * 0.5));
  assert.equal(specs[2].defPower, 400);
  assert.equal(buildSpecs(c, 0.1, 1)[2].hp, 1000); // BOSS 不比小怪（500）的 2 倍低
  const noBoss = buildSpecs({ ...c, boss: false }, 2, 1);
  assert.equal(noBoss.some((s) => s.kind === 'boss'), false);
  assert.equal(noBoss[0].hp, 1000); // 沒有 BOSS：旋鈕 2 倍
  assert.equal(noBoss[1].hp, 2000);
});

test('自動配置：BOSS 固定 1 隻、防禦取自候選值、方案依分數排序且隻數不同', async () => {
  const curve = damageCurve(TEAM, { runs: 4 });
  const rank = rankFromCurve(curve);
  const evaluate = makeEvaluator({ players: TEAM, names: NAMES, rank, runs: 8 });
  const out = await designEncounter({ players: TEAM, names: NAMES, boss: true, evaluate, curve, candidates: 6, yieldFn: async () => {} });
  assert.ok(out.results.length >= 1);
  for (const r of out.results) {
    assert.equal(r.specs.filter((s) => s.kind === 'boss').reduce((a, s) => a + s.count, 0), 1);
    for (const s of r.specs) assert.ok(DEF_GRID.includes(s.defPower) && s.hp >= 1 && s.atkPower >= 1 && s.count >= 1);
  }
  for (let i = 1; i < out.results.length; i++) assert.ok(out.results[i].penalty >= out.results[i - 1].penalty - 1e-9);
  const keys = out.results.map((r) => `${r.structure.nMob}-${r.structure.nElite}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('自動配置：沒有 BOSS 時不會放 BOSS，至少 2 隻怪；同樣輸入結果一樣（固定種子）', async () => {
  const curve = damageCurve(TEAM, { runs: 4 });
  const rank = rankFromCurve(curve);
  const go = () => designEncounter({ players: TEAM, names: NAMES, boss: false, evaluate: makeEvaluator({ players: TEAM, names: NAMES, rank, runs: 8 }), curve, candidates: 4, yieldFn: async () => {} });
  const a = await go();
  const b = await go();
  for (const r of a.results) {
    assert.equal(r.specs.some((s) => s.kind === 'boss'), false);
    assert.ok(r.specs.reduce((n, s) => n + s.count, 0) >= 2);
  }
  assert.deepEqual(a.results.map((r) => r.specs), b.results.map((r) => r.specs));
});

test('自動配置：所有玩家都打不出傷害（資料沒填）時直接回報原因', async () => {
  const blank = { ...hero(1), skills: {}, moves: [], baseStats: Object.fromEntries(Object.keys(hero(1).baseStats).map((k) => [k, 0])) };
  const out = await designEncounter({ players: [blank], boss: true, evaluate: () => ({}), curve: [{ def: 0, hits: [{ perTarget: 0 }], weak: 0, med: 0, strong: 0 }], candidates: 2 });
  assert.equal(out.results.length, 0);
  assert.match(out.notes[0], /打不出傷害/);
});

test('輸出分配：最高占比太高、最低占比太低都會扣分並出現在評價；少於 3 人不算', () => {
  const mk = (shares) => ({
    runs: 100, win: 1, lose: 0, timeout: 0, avgRounds: 2.5, avgDamagePerRound: 400, avgMonsterHp: 1000, avgDrain: 0.5, drainBy: { 毒性: 0.5 },
    downRate: shares.map((_, i) => ({ name: `p${i}`, rate: 0.1 })),
    perPlayer: shares.map((share, i) => ({ name: `p${i}`, share, kills: 1, taken: 0, takenPct: 0.1, drain: 0.3, downRound: 0, downRate: 0.1, hit: 2 })),
    rank: { strongest: 0, weakest: shares.length - 1, order: shares.map((_, i) => i) },
  });
  const even = mk([0.25, 0.25, 0.25, 0.25]);
  const lopsided = mk([0.7, 0.2, 0.08, 0.02]);
  assert.equal(penalty(even), 0);
  assert.ok(penalty(lopsided) > 2);
  assert.equal(assess(even).items.find((i) => i.key === 'share').status, 'ok');
  const bad = assess(lopsided);
  assert.notEqual(bad.items.find((i) => i.key === 'share').status, 'ok');
  assert.match(bad.advice.join(' '), /自動配置敵人/);
  assert.equal(shareInfo(mk([0.9, 0.1])), null);
  // 最弱的人整場沒打倒任何東西也扣分
  const noKill = mk([0.25, 0.25, 0.25, 0.25]);
  noKill.perPlayer[3].kills = 0;
  assert.ok(penalty(noKill) > 0);
});

test('模擬戰：統計各等級怪物每一下打掉玩家多少比例的生命', () => {
  const specs = [{ kind: 'mob', count: 3, atkPower: 400, defPower: 10, hp: 100000 }, { kind: 'boss', count: 1, atkPower: 400, defPower: 10, hp: 100000 }];
  const r = simulateBattle([hero(1), hero(1), hero(1)], specs, { rng: seededRng(5), maxRounds: 2, supply: null });
  assert.ok(r.hitKinds.mob.n > 0 && r.hitKinds.boss.n > 0);
  const sum = summarize([r, r]);
  assert.ok(sum.hitPct.mob > 0 && sum.hitPct.mob <= 1 && sum.hitPct.boss > 0 && sum.hitPct.boss <= 1);
  assert.equal(sum.hitPct.elite, null); // 沒有菁英
});
