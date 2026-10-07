// 執行方式：在專案根目錄 npm test
// 伺服器擲骰的亂數：拒絕取樣（沒有偏差）、範圍、與 src/game/dice.js 的接線
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSecureRng, serverRng } from '../src/server-rng.js';
import { rollDie, rollSum, rollExpr } from '../../src/game/dice.js';
import { d20 } from '../../src/game/engine.js';

/** 依序吐出指定的 32 位元亂數，並記錄被抽了幾次 */
function feed(values) {
  let i = 0;
  const fill = (a) => { a[0] = values[i++]; return a; };
  fill.count = () => i;
  return fill;
}

test('拒絕取樣：落在尾巴（會造成偏差）的值被丟掉重抽', () => {
  // 6 面骰：2^32 = 6 × 715827882 + 4，所以 4294967292..4294967295 這 4 個值必須丟掉
  const fill = feed([4294967295, 4294967294, 4294967293, 4294967292, 7]);
  const rng = makeSecureRng(fill);
  assert.equal(rng.int(6), (7 % 6) + 1);
  assert.equal(fill.count(), 5); // 前 4 個都被丟掉
  // 剛好在邊界內的最大值不會被丟掉
  const fill2 = feed([4294967291]);
  assert.equal(makeSecureRng(fill2).int(6), (4294967291 % 6) + 1);
  assert.equal(fill2.count(), 1);
});

test('面數剛好整除 2^32 時完全不會拒絕；每個點數都對得上', () => {
  const fill = feed([0, 1, 2, 3, 4294967295]);
  const rng = makeSecureRng(fill);
  assert.deepEqual([rng.int(4), rng.int(4), rng.int(4), rng.int(4), rng.int(4)], [1, 2, 3, 4, 4]);
  assert.equal(fill.count(), 5);
});

test('不合法的面數會報錯', () => {
  for (const n of [0, -1, 1.5, NaN, '6', 2 ** 32 + 1]) assert.throws(() => serverRng.int(n), RangeError, String(n));
});

test('真實 crypto：D6 的 60000 次分布大致均勻，全部落在 1..6', () => {
  const counts = Array(7).fill(0);
  for (let i = 0; i < 60000; i++) counts[serverRng.int(6)]++;
  assert.equal(counts[0], 0);
  for (let v = 1; v <= 6; v++) assert.ok(Math.abs(counts[v] - 10000) < 600, `點數 ${v} 出現 ${counts[v]} 次`); // 約 6.5 個標準差，不會誤判
  for (const sides of [2, 20, 10000]) for (let i = 0; i < 500; i++) {
    const v = serverRng.int(sides);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= sides);
  }
});

test('小數亂數在 [0, 1) 內', () => {
  for (let i = 0; i < 2000; i++) { const x = serverRng(); assert.ok(x >= 0 && x < 1); }
  const max = makeSecureRng(feed([4294967295, 4294967295]))();
  assert.ok(max < 1);
});

test('接線：rollDie 優先使用 rng.int；沒有 .int 的 rng（Math.random、測試固定值）行為不變', () => {
  const seq = makeSecureRng(feed([0, 1, 2, 3, 4, 5]));
  assert.equal(rollDie(6, seq), 1);
  assert.equal(rollSum(3, 6, seq), 2 + 3 + 4);
  assert.equal(d20(makeSecureRng(feed([19]))), 20);
  assert.equal(rollExpr('2D6+1', makeSecureRng(feed([0, 5]))).total, 1 + 6 + 1);
  assert.equal(rollDie(20, () => 0.5), 11); // 舊的公式
  assert.equal(d20(() => 0.99), 20);
});
