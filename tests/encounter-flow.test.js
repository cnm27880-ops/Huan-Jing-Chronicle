// 執行方式：npm test
// 房間模式的出招流程（encounterCard.js 的做法）：把伺服器的遭遇戰複製進 state.encounter，
// 用骰點帶（diceTape）真正執行，算出每隻怪物少了多少生命，再換回原本的遭遇戰。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { newEncounter, addMobs, playerAttack } from '../src/game/combat.js';
import { planDice, applyDice } from '../src/state/diceTape.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

test('用伺服器的怪物出招：本機的 state.encounter 不被弄髒，傷害 = 前後生命差', () => {
  const state = clone(SAMPLE_CHARACTER);
  const local = state.encounter;
  const serverEnc = newEncounter();
  addMobs(serverEnc, { count: 2, atkPower: 10, defPower: 3, hp: 5000 }, () => 0.5);
  const move = state.moves.find((m) => m.kind !== 'heal' && m.kind !== 'shield');

  const saved = state.encounter;
  state.encounter = structuredClone(serverEnc);
  const run = (st, rng) => playerAttack(st, st.encounter, move.id, '小怪1', 0, rng);
  const before = new Map(state.encounter.monsters.map((m) => [m.id, m.hp]));
  const plan = planDice(state, run);
  const values = plan.pools.flatMap(([sides, count]) => Array(count).fill(Math.min(sides, 2)));
  const r = applyDice(state, run, values, plan.pools);
  const hits = r.hits.map((x) => ({ id: x.target.id, dmg: before.get(x.target.id) - x.target.hp })).filter((x) => x.dmg > 0);
  state.encounter = saved;

  assert.ok(!r.error, r.error);
  assert.ok(hits.length >= 1 && hits[0].dmg > 0);
  assert.equal(state.encounter, local); // 換回原本那份
  assert.deepEqual(state.encounter.monsters, []); // 本機遭遇戰沒有被怪物弄髒
  assert.equal(serverEnc.monsters[0].hp, 5000); // 伺服器那份只在複本上算，不直接被改
});
