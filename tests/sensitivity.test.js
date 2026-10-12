// 執行方式：npm test
// 模擬戰的「範本調整影響分析」（src/game/sensitivity.js）、輸出分配評分（tuning.js）、怪物每下傷害統計（simulate.js）、百分比傷害與輔助排序（fairness.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { TEMPLATE, templateSpecs, makeEvaluator, variations, analyzeSensitivity, meetsTarget, topImpact } from '../src/game/sensitivity.js';
import { penalty, assess, shareInfo } from '../src/game/tuning.js';
import { simulateBattle, summarize, seededRng } from '../src/game/simulate.js';
import { measureHits, rankPlayers, damagersOf } from '../src/game/fairness.js';
import { moveFromCatalog } from '../src/game/skills.js';

const hero = (k = 1) => {
  const c = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  for (const s of Object.keys(c.baseStats)) c.baseStats[s] = Math.round(c.baseStats[s] * k);
  return c;
};
const TEAM = [2, 1.4, 1, 0.6].map(hero);
const NAMES = ['甲', '乙', '丙', '丁'];

test('輸出分配：最高占比太高、最低占比太低都會扣分並出現在評價；少於 3 人不算', () => {
  const mk = (shares) => ({
    runs: 100, win: 1, lose: 0, timeout: 0, avgRounds: 5, avgDamagePerRound: 400, avgMonsterHp: 1000, avgDrain: 0.5, drainBy: { 毒性: 0.5 },
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

test('量傷害：萬物歸一的「現有生命 5%」不再被 10 億血的假怪物放大成 5000 萬', () => {
  const p = hero(1);
  p.skills = { ...p.skills, 萬物歸一: 3 };
  p.moves = [...p.moves.filter((m) => m.id === 'basic'), moveFromCatalog('萬物歸一', 3)]; // 只剩這一招，模擬才一定會挑它
  const spec = [{ kind: 'mob', count: 3, atkPower: 1, defPower: 0, hp: 1 }];
  const raw = measureHits([p], spec, { runs: 4, refHp: 1e9 })[0]; // 不換算：5% × 10 億 ＝ 5000 萬（修正前的樣子）
  assert.ok(raw.perTarget > 40000000);
  const [h] = measureHits([p], spec, { runs: 4 });
  assert.ok(h.perTarget > 0 && h.perTarget < 100000, `一次出手 ${h.perTarget}`);
  assert.ok(h.total < 300000);
});

test('強弱排序：打不穿的輔助不當「最弱的輸出者」；全部都打不穿就全算', () => {
  const hits = [{ perTarget: 500, total: 500 }, { perTarget: 0, total: 0 }, { perTarget: 100, total: 100 }];
  assert.deepEqual(damagersOf(hits), [0, 2]);
  const r = rankPlayers(hits);
  assert.equal(r.strongest, 0);
  assert.equal(r.weakest, 2);
  assert.deepEqual(r.damagers, [0, 2]);
  assert.deepEqual(damagersOf([{ perTarget: 0 }, { perTarget: 0.5 }]), [0, 1]);
});

test('範本：9 小怪＋1 BOSS，數值是 GM 實戰的敵人；每次回傳新的複本', () => {
  const a = templateSpecs();
  assert.deepEqual(a.map((s) => [s.kind, s.count]), [['mob', 9], ['boss', 1]]);
  assert.equal(a[0].hp, 600); assert.equal(a[0].atkPower, 360); assert.equal(a[0].defPower, 270);
  assert.equal(a[1].hp, 2000); assert.equal(a[1].atkPower, 600); assert.equal(a[1].defPower, 800);
  a[0].count = 1;
  assert.equal(templateSpecs()[0].count, 9);
  assert.equal(TEMPLATE.mob.hp, 600);
});

test('單項微調：每項只動一個地方；BOSS 不調隻數；不改原本的清單；調到沒有怪就略過', () => {
  const base = templateSpecs();
  const vs = variations(base);
  assert.ok(vs.length > 20);
  assert.deepEqual(base, templateSpecs()); // 原資料不變
  // 小怪：加減 1、2 隻；BOSS 沒有隻數的項目
  assert.deepEqual(vs.filter((v) => v.group === '小怪' && v.change.type === 'count').map((v) => v.specs[0].count), [7, 8, 10, 11]);
  assert.equal(vs.filter((v) => v.group === 'BOSS' && v.change.type === 'count').length, 0);
  // 攻擊 ＋10%：360 → 396，其他欄位都不變
  const atk = vs.find((v) => v.group === '小怪' && v.change.type === 'atkPower' && v.change.pct === 0.1);
  assert.equal(atk.specs[0].atkPower, 396);
  assert.equal(atk.specs[0].hp, 600);
  assert.deepEqual(atk.specs[1], base[1]);
  assert.match(atk.label, /攻擊 360 → 396（＋10%，＋36 點）/);
  // 只剩 1 隻怪、沒有 BOSS：減 1 隻會變成沒有怪，略過
  const solo = variations([{ kind: 'mob', count: 1, atkPower: 100, defPower: 50, hp: 100 }]);
  assert.equal(solo.some((v) => v.change.type === 'count' && v.change.delta < 0), false);
  // 同一種等級有兩組：組名加編號
  const two = variations([{ kind: 'mob', count: 2, atkPower: 100, defPower: 50, hp: 100 }, { kind: 'mob', count: 3, atkPower: 80, defPower: 50, hp: 100 }]);
  assert.deepEqual([...new Set(two.map((v) => v.group))], ['小怪 1', '小怪 2']);
  // 防禦可以調到 0，但攻擊與血量至少 1
  const tiny = variations([{ kind: 'mob', count: 1, atkPower: 1, defPower: 1, hp: 1 }, { kind: 'mob', count: 1, atkPower: 1, defPower: 1, hp: 1 }]);
  assert.ok(tiny.every((v) => v.specs.every((s) => s.atkPower >= 1 && s.hp >= 1 && s.defPower >= 0)));
});

test('影響分析：用假的評估驗證差值、達標、排行與「差別不明顯」', async () => {
  // 假的評估：勝率 = 1 − 攻擊總和 / 2000（上限 1）；回合 = 血量總和 / 1000；其餘固定
  const evaluate = (specs) => {
    const atk = specs.reduce((a, s) => a + s.atkPower * s.count, 0);
    const hp = specs.reduce((a, s) => a + s.hp * s.count, 0);
    return { runs: 100, win: Math.max(0, Math.min(1, 1 - atk / 2000)), lose: 0, timeout: 0, avgRounds: hp / 1000, avgRoundsWin: hp / 1000, avgDrain: 0.5, avgHpLeft: 0.5, avgPotions: 1, drainBy: {}, downRate: [] };
  };
  const specs = [{ kind: 'mob', count: 5, atkPower: 100, defPower: 50, hp: 400 }, { kind: 'boss', count: 1, atkPower: 400, defPower: 50, hp: 2000 }];
  const progress = [];
  const out = await analyzeSensitivity({ specs, evaluate, onProgress: (p) => progress.push(p), yieldFn: async () => {} });
  assert.equal(out.rows.length, variations(specs).length);
  assert.equal(progress.at(-1), 1);
  const b = evaluate(specs);
  assert.equal(out.base.win, b.win);
  const plus1 = out.rows.find((r) => r.group === '小怪' && r.change.type === 'count' && r.change.delta === 1);
  assert.ok(Math.abs(plus1.d.win - (-100 / 2000)) < 1e-9); // 多 1 隻小怪（攻擊 100）＝勝率 −5%
  assert.ok(Math.abs(plus1.d.rounds - 0.4) < 1e-9); // 血量 +400 ＝ +0.4 回合
  assert.equal(plus1.noticeable, true);
  assert.equal(out.baseMeets, meetsTarget(b));
  const top = topImpact(out.rows, 3);
  assert.equal(top.length, 3);
  assert.ok(Math.abs(top[0].d.win) >= Math.abs(top[1].d.win) && Math.abs(top[1].d.win) >= Math.abs(top[2].d.win));
  // 血量 ±10% 不影響勝率、只影響回合：回合差 ≥ 0.3 才算有差別
  const hp10 = out.rows.find((r) => r.group === '小怪' && r.change.type === 'hp' && r.change.pct === 0.1);
  assert.equal(hp10.d.win, 0);
  assert.equal(hp10.noticeable, Math.abs(hp10.d.rounds) >= 0.3);
});

test('影響分析：用真的模擬跑一次，固定種子所以每次結果一樣；攻擊提高時怪物每下傷害不會下降', async () => {
  const rank = rankPlayers(measureHits(TEAM, [{ kind: 'mob', count: 3, ...TEMPLATE.mob }], { runs: 4 }));
  const specs = [{ kind: 'mob', count: 3, atkPower: 150, defPower: 60, hp: 400, absDef: 0, atkMod: '', defMod: '' }];
  const go = () => analyzeSensitivity({ specs, evaluate: makeEvaluator({ players: TEAM, names: NAMES, rank, runs: 12 }), yieldFn: async () => {} });
  const a = await go();
  const b = await go();
  assert.deepEqual(a.rows.map((r) => r.d), b.rows.map((r) => r.d));
  const lo = a.rows.find((r) => r.change.type === 'atkPower' && r.change.pct === -0.2);
  const hi = a.rows.find((r) => r.change.type === 'atkPower' && r.change.pct === 0.2);
  assert.ok(hi.summary.hitPct.mob >= lo.summary.hitPct.mob);
  assert.ok(a.base.runs === 12 && a.se > 0);
});
