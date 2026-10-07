// 執行方式：npm test
// 骰點帶（src/state/diceTape.js）：讓真正的規則函式（藥水、鑑定、出招、承受攻擊）直接吃伺服器擲出的骰點
import test from 'node:test';
import assert from 'node:assert/strict';
import { planDice, applyDice, replayRng, TapeError } from '../src/state/diceTape.js';
import { drinkPotion, playerAttack, monsterAttack, addMobs, addBosses } from '../src/game/combat.js';
import { identify } from '../src/game/equipment.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => {
  const s = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  addMobs(s.encounter, { count: 2, atkPower: 12, defPower: 9, hp: 500 });
  addBosses(s.encounter, { count: 1, atkPower: 30, defPower: 20, hp: 2000 });
  return s;
};

/** 模擬伺服器：依規劃的組別擲出每一顆（這裡用可預期的假點數） */
const serverValues = (pools) => pools.flatMap(([sides, count]) => Array.from({ length: count }, (_, i) => ((i * 7 + sides) % sides) + 1));

/** 對照組：同樣的點數，直接餵給規則函式（等於以前本機擲骰、只是點數固定） */
function direct(state, run, values) {
  let i = 0;
  const rng = () => { throw new Error('float'); };
  rng.int = () => values[i++];
  const copy = structuredClone(state);
  return { r: run(copy, rng), state: copy };
}

const cases = {
  藥水回血: (st, rng) => drinkPotion(st, '回春湯', rng),
  鑑定通用裝備: (st, rng) => identify(st, '傳說防具', 3, rng),
  出招單體: (st, rng) => playerAttack(st, st.encounter, 'm1', '小怪1', 0, rng),
  出招多目標: (st, rng) => playerAttack(st, st.encounter, st.moves.find((m) => m.name === '吞天噬血陣').id, '小怪1', 0, rng),
  出招單池: (st, rng) => playerAttack(st, st.encounter, 's_萬物歸一', 'BOSS1', 1, rng),
  出招大招: (st, rng) => playerAttack(st, st.encounter, 'm3', 'BOSS1', 1, rng),
  承受攻擊: (st, rng) => monsterAttack(st, st.encounter, 'BOSS1', 2, rng),
};

for (const [name, run] of Object.entries(cases)) {
  test(`骰點帶：${name}，結果與用同樣點數直接執行完全相同`, () => {
    const state = fresh();
    state.hp = 100;
    const plan = planDice(state, run);
    assert.ok(!plan.unsupported);
    const expected = direct(state, run, serverValues(plan.pools));
    const real = structuredClone(state);
    const r = applyDice(real, run, serverValues(plan.pools), plan.pools);
    assert.deepEqual(r, expected.r);
    assert.deepEqual(real, expected.state);
    assert.ok(plan.total > 0 && !r.error, `${name} 一定要真的擲到骰子`);
  });
}

test('試跑只動複本：規劃完真正的狀態一點都沒變', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  planDice(state, cases.出招單體);
  planDice(state, cases.藥水回血);
  assert.equal(JSON.stringify(state), before);
});

test('規劃：連續相同面數會壓成一組；沒有骰子（資源不足、背包沒有）時總數為 0', () => {
  const s = fresh();
  const p = planDice(s, cases.藥水回血);
  assert.deepEqual(p.pools, [[10, 8]]);
  assert.equal(p.total, 8);
  s.inventory.回春湯 = 0;
  assert.equal(planDice(s, cases.藥水回血).total, 0);
  const lowRes = fresh();
  lowRes.resources.靈氣 = 0;
  assert.equal(planDice(lowRes, cases.出招大招).total, 0);
});

test('用到非骰子的隨機（rng()）：標記為不支援，由呼叫端退回本機', () => {
  const p = planDice({}, (st, rng) => rng());
  assert.equal(p.unsupported, true);
});

test('點數對不上時整個失敗，而且真正的狀態完全不動（不會出現扣了資源卻沒結果的半成品）', () => {
  const state = fresh();
  const plan = planDice(state, cases.出招單體);
  const before = JSON.stringify(state);
  const values = serverValues(plan.pools);
  for (const bad of [values.slice(1), [...values, 1], values.map((v, i) => (i === 0 ? 0 : v)), values.map((v, i) => (i === 0 ? 99 : v)), values.map((v, i) => (i === 0 ? 1.5 : v))]) {
    assert.throws(() => applyDice(state, cases.出招單體, bad, plan.pools), TapeError);
    assert.equal(JSON.stringify(state), before);
  }
  // 規劃時的面數和執行時對不上（例如狀態在等待期間被改了）
  assert.throws(() => applyDice(state, cases.出招單體, values, [[6, plan.total]]), TapeError);
  assert.equal(JSON.stringify(state), before);
});

test('成功後狀態是「原地」更新：畫面上拿著的 state 物件還是同一個', () => {
  const state = fresh();
  state.hp = 100;
  const ref = state;
  const plan = planDice(state, cases.藥水回血);
  applyDice(state, cases.藥水回血, serverValues(plan.pools), plan.pools);
  assert.equal(state, ref);
  assert.ok(state.hp > 100);
  assert.equal(state.inventory.回春湯, SAMPLE_CHARACTER.inventory.回春湯 - 1);
});

test('replayRng：每顆都檢查面數與範圍', () => {
  const rng = replayRng([3, 9], [[4, 1], [10, 1]]);
  assert.equal(rng.int(4), 3);
  assert.equal(rng.int(10), 9);
  assert.ok(rng.done());
  assert.throws(() => replayRng([5], [[4, 1]]).int(4), TapeError);
  assert.throws(() => replayRng([3], [[4, 1]]).int(6), TapeError);
  assert.throws(() => replayRng([], [[4, 1]]).int(4), TapeError);
});
