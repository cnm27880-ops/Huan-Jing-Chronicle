// 執行方式：npm test
// 暗影斗篷：進入隱身（花 1 鬥氣、立刻聚集）、遭遇戰回合開始聚集（最多 3 次）、現身爆發、隱身中不能用其他攻擊
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { enterStealth, advanceShadow, gainPerRound, isHidden, gatheredOf, STEALTH_ROUNDS } from '../src/game/shadowCloak.js';
import { playerAttack, newEncounter, addMobs, attackDice } from '../src/game/combat.js';
import { moveFromCatalog } from '../src/game/skills.js';
import { derivedStats } from '../src/game/stats.js';

const mk = (level = 10) => {
  const s = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  s.skills = { ...s.skills, 暗影斗篷: level };
  s.resources = { ...s.resources, 鬥氣: 5 };
  s.buffs = { atk: 0, def: 0 };
  s.moves.push({ ...moveFromCatalog('暗影斗篷'), id: 'shadow', name: '現身' });
  return s;
};
const arena = () => { const enc = newEncounter(); addMobs(enc, { count: 1, atkPower: 10, defPower: 10, hp: 1000 }); return enc; };

test('每次聚集 = 2 + 等級÷2（10 級 7，1 級 2，2 級 3）', () => {
  assert.equal(gainPerRound(mk(10)), 7);
  assert.equal(gainPerRound(mk(1)), 2);
  assert.equal(gainPerRound(mk(2)), 3);
});

test('進入隱身：花 1 鬥氣、立刻聚集；已在隱身或沒鬥氣不能再進', () => {
  const s = mk();
  const before = s.resources.鬥氣;
  const r = enterStealth(s, 2);
  assert.equal(r.ok, true);
  assert.equal(s.resources.鬥氣, before - 1);
  assert.equal(gatheredOf(s), 7);
  assert.ok(isHidden(s));
  assert.ok(enterStealth(s, 2).error);
  const poor = mk(); poor.resources.鬥氣 = 0;
  assert.ok(enterStealth(poor, 1).error);
  const none = mk(0); assert.ok(enterStealth(none, 1).error);
});

test('回合開始聚集：每個新回合一次、最多 3 次，第 4 回合隱身結束但點數保留；同一回合不重複', () => {
  const s = mk();
  enterStealth(s, 1);
  assert.equal(advanceShadow(s, 1), null);
  const a = advanceShadow(s, 2);
  assert.deepEqual(a.gains, [{ round: 2, gain: 7 }]);
  assert.equal(gatheredOf(s), 14);
  assert.equal(advanceShadow(s, 2), null);
  advanceShadow(s, 3); advanceShadow(s, 4);
  assert.equal(gatheredOf(s), 7 * (1 + STEALTH_ROUNDS));
  assert.ok(isHidden(s));
  const end = advanceShadow(s, 5);
  assert.equal(end.ended, true);
  assert.equal(isHidden(s), false);
  assert.equal(gatheredOf(s), 28);
});

test('一次跳好幾個回合也照算；回合數倒退＝新戰鬥，清掉', () => {
  const s = mk();
  enterStealth(s, 1);
  const r = advanceShadow(s, 9); // 跳 8 回合：只聚集 3 次，然後結束
  assert.equal(r.gains.length, 3);
  assert.equal(r.ended, true);
  assert.equal(gatheredOf(s), 28);
  const s2 = mk(); enterStealth(s2, 5);
  assert.equal(advanceShadow(s2, 1).cleared, true);
  assert.equal(s2.buffs.shadow, undefined);
});

test('隱身中不能用其他攻擊；現身爆發把聚集的點數加在能量軌，打完隱身解除、點數歸零', () => {
  const s = mk();
  const enc = arena();
  enterStealth(s, 1); advanceShadow(s, 2);
  const blocked = playerAttack(s, enc, 'basic', enc.monsters[0].id, 0, () => 0.5);
  assert.ok(blocked.error && /隱身/.test(blocked.error));
  const move = s.moves.find((m) => m.id === 'shadow');
  const d = attackDice(s, move);
  assert.ok(d.parts.B.some((p) => p.label === '暗影斗篷' && p.value === 14));
  assert.equal(d.dice.B, derivedStats(s).能量傷害.total + derivedStats(s).真實傷害.total + 14);
  const r = playerAttack(s, enc, 'shadow', enc.monsters[0].id, 0, () => 0.5);
  assert.ok(!r.error, r.error);
  assert.equal(r.burst, 14);
  assert.equal(r.reveal, true);
  assert.equal(isHidden(s), false);
  assert.equal(gatheredOf(s), 0);
  assert.ok(!playerAttack(s, enc, 'basic', enc.monsters[0].id, 0, () => 0.5).error); // 現身後可以用別的招式
});

test('不是暗影斗篷的招式，明細不會多出暗影斗篷', () => {
  const s = mk(); enterStealth(s, 1);
  const basic = s.moves.find((m) => m.id === 'basic');
  assert.ok(!attackDice(s, basic).parts.B.some((p) => p.label === '暗影斗篷'));
});
