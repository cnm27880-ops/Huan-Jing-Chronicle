// 執行方式：npm test
// 模擬戰（src/game/simulate.js）與隊友藥水（combat.js 的 giveHealPotion）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { giveHealPotion } from '../src/game/combat.js';
import { addItem } from '../src/game/engine.js';
import { maxHp } from '../src/game/stats.js';
import { setResource } from '../src/game/resources.js';
import { pickMove, castsAffordable, simulateBattle, runSimulations, prepPlayer } from '../src/game/simulate.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const hero = () => clone(SAMPLE_CHARACTER);
/** 固定種子的亂數（mulberry32），讓模擬結果每次都一樣 */
function seeded(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WEAK = [{ kind: 'mob', count: 2, atkPower: 5, defPower: 5, hp: 50 }];
const DEADLY = [{ kind: 'boss', count: 1, atkPower: 200000, defPower: 200000, hp: 9_000_000 }];

test('隊友藥水：倒地的人被拉起來，回復量照藥水、毒性算被救的人、毒性滿了不能餵', () => {
  const giver = hero(); const target = hero();
  addItem(giver, '紅藥水', 2);
  target.hp = 0; target.toxicity = 0;
  const r = giveHealPotion(giver, target, '紅藥水', () => 0.5);
  assert.equal(r.error, undefined);
  assert.ok(r.revived && target.hp > 0);
  assert.equal(target.toxicity, 2); // 被救的人 +2
  assert.equal(giver.toxicity, 0); // 餵的人沒有毒性
  assert.equal(giver.inventory['紅藥水'], 1);
  target.toxicity = 14;
  assert.match(giveHealPotion(giver, target, '紅藥水').error, /不能餵/);
  assert.equal(giver.inventory['紅藥水'], 1); // 失敗不扣藥水
  assert.match(giveHealPotion(giver, target, '黃藥水').error, /不是回復藥水/);
});

test('選招式：續航最長的先用；資源不夠就換下一個；全部放不出來用普攻', () => {
  const s = prepPlayer(hero());
  const moves = s.moves.filter((m) => m.id !== 'basic' && m.kind !== 'heal' && m.kind !== 'shield');
  const picked = pickMove(s);
  const casts = (m) => castsAffordable(s, m);
  assert.equal(casts(picked), Math.max(...moves.map(casts))); // 沒有別的招式比它續航更長
  for (const r of ['靈氣', '魔力', '算力', '能量', '鬥氣']) setResource(s, r, 0);
  assert.equal(pickMove(s).id, 'basic');
  assert.equal(castsAffordable(s, pickMove(s)), 0); // 示範角色是魔女：連普攻都要多花 30 魔力，付不起
});

test('魔女魔力用光：放棄行動回復魔力，下一回合又能出手', () => {
  const witch = hero();
  const res = simulateBattle([witch], [{ kind: 'mob', count: 1, atkPower: 1, defPower: 1, hp: 3_000_000 }], { rng: seeded(5), maxRounds: 40 });
  assert.ok(res.damage > 0); // 沒有卡死在「付不起」
});

test('模擬一場：弱敵會贏、超強 BOSS 會輸；玩家原本的存檔不被改動', () => {
  const before = JSON.stringify(hero());
  const players = [hero(), hero()];
  const win = simulateBattle(players, WEAK, { rng: seeded(1) });
  assert.equal(win.outcome, 'win');
  assert.ok(win.damage === win.monsterHp && win.rounds >= 1);
  const lose = simulateBattle(players, DEADLY, { rng: seeded(2), maxRounds: 30 });
  assert.equal(lose.outcome, 'lose');
  assert.equal(lose.downs.length, 2);
  assert.ok(lose.downs.every((d) => d >= 1));
  assert.equal(JSON.stringify(players[0]), before);
});

test('有藥水的隊友會在對方倒地時餵藥（需要 BOSS 打不死人又打得倒人）', () => {
  const medic = hero(); addItem(medic, '生命泉', 5);
  const results = Array.from({ length: 40 }, (_, i) => simulateBattle([medic, hero()], [{ kind: 'boss', count: 1, atkPower: 3000, defPower: 50, hp: 500 }], { rng: seeded(100 + i), maxRounds: 15 }));
  assert.ok(results.some((r) => r.potions > 0), '應該至少有一場用到藥水');
});

test('整理結果：勝率加起來是 1、回合分布總數 = 場數、固定種子可重現', () => {
  const run = () => runSimulations([hero()], [{ kind: 'mob', count: 3, atkPower: 400, defPower: 200, hp: 4000 }], { runs: 60, names: ['福德'], rng: seeded(7) });
  const a = run();
  assert.equal(a.runs, 60);
  assert.ok(Math.abs(a.win + a.lose + a.timeout - 1) < 1e-9);
  assert.equal(a.roundHist.reduce((x, r) => x + r.win + r.lose + r.timeout, 0), 60);
  assert.equal(a.hpHist.reduce((x, y) => x + y, 0), Math.round(a.win * 60));
  assert.equal(a.downRate[0].name, '福德');
  assert.deepEqual(run(), a);
});
