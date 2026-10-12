// 執行方式：npm test
// 範本版本的比較（src/game/templates.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { describeSpecs, nextVersionName, diffSpecs, compareVersions, snapshotOf, metricsOf } from '../src/game/templates.js';
import { templateSpecs, makeEvaluator } from '../src/game/sensitivity.js';
import { measureHits, rankPlayers } from '../src/game/fairness.js';

const hero = (k = 1) => {
  const c = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  for (const s of Object.keys(c.baseStats)) c.baseStats[s] = Math.round(c.baseStats[s] * k);
  return c;
};

test('版本命名與描述', () => {
  assert.equal(describeSpecs(templateSpecs()), '小怪 ×9・BOSS ×1');
  assert.equal(nextVersionName([]), '範本 v1');
  assert.equal(nextVersionName([{ name: '範本 v1' }, { name: '範本 v3（調過）' }, { name: '亂取的名字' }]), '範本 v4');
  assert.equal(nextVersionName([{ name: 'a' }, { name: 'b' }]), '範本 v3'); // 名稱裡沒有版本號：清單長度 + 1
});

test('數值差異：隻數、攻擊、防禦、血量的變化；新增與拿掉整組；完全相同回傳空陣列；不改原資料', () => {
  const a = templateSpecs();
  assert.deepEqual(diffSpecs(a, templateSpecs()), []);
  const b = templateSpecs();
  b[0].count = 8; b[0].atkPower = 396; b[1].hp = 1800; b[1].defPower = 800;
  const d = diffSpecs(a, b);
  assert.deepEqual(d, [
    '小怪 隻數 9 → 8（－1）',
    '小怪 攻擊 360 → 396（＋36，＋10%）',
    'BOSS 血量 2000 → 1800（－200，－10%）',
  ]);
  assert.equal(a[0].count, 9);
  const added = diffSpecs(a, [...templateSpecs(), { kind: 'elite', count: 2, atkPower: 470, defPower: 400, hp: 1200 }]);
  assert.deepEqual(added, ['新增 菁英 ×2（攻 470・防 400・血 1200）']);
  const removed = diffSpecs(templateSpecs(), [templateSpecs()[0]]);
  assert.deepEqual(removed, ['拿掉 BOSS ×1（攻 600・防 800・血 2000）']);
  // 兩組小怪時用編號配對
  const two = [{ kind: 'mob', count: 2, atkPower: 10, defPower: 5, hp: 50 }, { kind: 'mob', count: 3, atkPower: 20, defPower: 5, hp: 50 }];
  assert.deepEqual(diffSpecs(two, [two[0], { ...two[1], hp: 60 }]), ['小怪 2 血量 50 → 60（＋10，＋20%）']);
});

test('版本比較：同時用現在的玩家重跑兩個版本；差＝後者減前者；只有一邊有的指標不算差', () => {
  const team = [hero(2), hero(1)];
  const specsA = [{ kind: 'mob', count: 3, atkPower: 150, defPower: 60, hp: 400, absDef: 0, atkMod: '', defMod: '' }];
  const specsB = [{ ...specsA[0], hp: 800 }, { kind: 'elite', count: 1, atkPower: 200, defPower: 80, hp: 900, absDef: 0, atkMod: '', defMod: '' }];
  const rank = rankPlayers(measureHits(team, specsA, { runs: 4 }));
  const evaluate = makeEvaluator({ players: team, names: ['甲', '乙'], rank, runs: 12 });
  const r = compareVersions({ a: specsA, b: specsB, evaluate });
  assert.deepEqual(r.diff, ['小怪 血量 400 → 800（＋400，＋100%）', '新增 菁英 ×1（攻 200・防 80・血 900）']);
  const rounds = r.rows.find((x) => x.key === 'rounds');
  assert.ok(Math.abs(rounds.d - (rounds.b - rounds.a)) < 1e-12);
  assert.ok(rounds.b >= rounds.a); // 血量變多 → 回合不會變少
  const elite = r.rows.find((x) => x.key === 'hit_elite');
  if (elite) assert.equal(elite.a, null); // A 沒有菁英：不算差
  assert.equal(r.runs, 12);
  // 固定種子：同樣的兩個版本，結果每次一樣
  assert.deepEqual(compareVersions({ a: specsA, b: specsB, evaluate }).rows, r.rows);
  // 兩邊一樣的版本，所有差都是 0
  assert.ok(compareVersions({ a: specsA, b: specsA, evaluate }).rows.every((x) => x.d === 0));
});

test('存檔當時的成績：只記數字與日期、玩家名單', () => {
  const sum = { runs: 100, win: 0.72, avgRounds: 8, avgRoundsWin: 7, avgDrain: 0.55, avgHpLeft: 0.4, avgPotions: 7.5, avgDamagePerRound: 900, downRate: [], hitPct: {} };
  assert.deepEqual(snapshotOf(sum, ['甲', '乙'], 123), { at: 123, runs: 100, win: 0.72, rounds: 7, drain: 0.55, hpLeft: 0.4, players: ['甲', '乙'] });
  assert.equal(metricsOf(sum).find((m) => m.key === 'rounds').value, 7);
});
