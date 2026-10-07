// 執行方式：npm test
// 自訂骰式（取代機器人 !投骰）：格式與限制與機器人相同
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiceExpr, rollExpr, rollSum, MAX_DICE } from '../src/game/dice.js';

test('骰式解析：大小寫、空白、加減值', () => {
  assert.deepEqual(parseDiceExpr('1d20'), { count: 1, sides: 20, mod: 0, text: '1D20' });
  assert.deepEqual(parseDiceExpr(' 2 D 6 + 3 '), { count: 2, sides: 6, mod: 3, text: '2D6+3' });
  assert.deepEqual(parseDiceExpr('1D20-2'), { count: 1, sides: 20, mod: -2, text: '1D20-2' });
});

test('骰式限制：格式錯誤、0 顆、超過 100 顆', () => {
  assert.ok(parseDiceExpr('abc').error);
  assert.ok(parseDiceExpr('0D6').error);
  assert.ok(parseDiceExpr('2D0').error);
  assert.ok(parseDiceExpr(`${MAX_DICE + 1}D6`).error);
  assert.equal(parseDiceExpr(`${MAX_DICE}D6`).error, undefined);
});

test('擲骰：總和 = 每顆相加 + 加減值，固定亂數可重現', () => {
  const r = rollExpr('3D6+2', () => 0.5); // 每顆 floor(0.5*6)+1 = 4
  assert.deepEqual(r.rolls, [4, 4, 4]);
  assert.equal(r.total, 14);
  assert.equal(rollSum(0, 4), 0);
  assert.ok(rollExpr('x').error);
});
