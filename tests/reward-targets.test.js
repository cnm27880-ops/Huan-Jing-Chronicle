// 發放獎勵面板：誰在名單裡（暫代 GM 的人自己也要在）
import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardTargets } from '../src/ui/rewardSheet.js';

const members = [{ uid: 'g', name: '正GM', online: true }, { uid: 'a', name: '甲', online: true }, { uid: 'b', name: '乙', online: false }];
const room = (over = {}) => ({ members, vitals: { a: { name: '福德' } }, me: { uid: 'a' }, gm: { uids: ['g'], override: null }, ...over });

test('一般情況：名單不含 GM', () => {
  assert.deepEqual(rewardTargets(room({ me: { uid: 'g' } })).map((p) => p.uid), ['a', 'b']);
});

test('暫代 GM：自己也在名單裡，原本的 GM 變成一般玩家', () => {
  const r = rewardTargets(room({ gm: { uids: ['a'], override: 'a' } }));
  assert.deepEqual(r.map((p) => p.uid), ['g', 'a', 'b']);
  assert.equal(r.find((p) => p.uid === 'a').label, '福德（甲）');
});

test('別人暫代 GM 時，我（不是暫代者）不會把暫代者列進去', () => {
  assert.deepEqual(rewardTargets(room({ me: { uid: 'g' }, gm: { uids: ['a'], override: 'a' } })).map((p) => p.uid), ['g', 'b']);
});
