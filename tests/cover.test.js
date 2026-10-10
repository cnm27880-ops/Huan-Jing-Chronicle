// 替隊友擋攻擊：每位玩家每回合 1 次，回合數變了就恢復
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverLeft, spendCover, COVER_PER_ROUND } from '../src/game/cover.js';

test('每位玩家每回合擋 1 次，各算各的', () => {
  const enc = { round: 1 };
  assert.equal(COVER_PER_ROUND, 1);
  assert.equal(coverLeft(enc, 'a'), 1);
  assert.equal(spendCover(enc, 'a').ok, true);
  assert.equal(coverLeft(enc, 'a'), 0);
  assert.match(spendCover(enc, 'a').error, /已經替隊友擋過/);
  assert.equal(coverLeft(enc, 'b'), 1); // 別人不受影響
  assert.equal(spendCover(enc, 'b').ok, true);
});

test('新的一回合就恢復；沒有 round 的舊遭遇戰也能用', () => {
  const enc = { round: 2 };
  spendCover(enc, 'a');
  enc.round = 3;
  assert.equal(coverLeft(enc, 'a'), 1);
  assert.equal(spendCover(enc, 'a').ok, true);
  const old = {};
  assert.equal(spendCover(old, 'a').ok, true);
  assert.equal(coverLeft(old, 'a'), 0);
});
