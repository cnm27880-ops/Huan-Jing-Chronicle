// 玩家交易：B 這一端付不付得起（伺服器流程在 worker/test/mail.test.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { addItem, countOf } from '../src/game/engine.js';
import { applyMail } from '../src/game/mail.js';
import { payOffer, shortages, itemsText } from '../src/game/trade.js';

const player = (items) => { const s = blankCharacter('乙'); for (const [n, q] of Object.entries(items)) addItem(s, n, q); return s; };
const offer = { want: { 豪華蓋飯: 10, 鐵礦: 2 }, give: { 大師技能書: 10 } };

test('付得起：扣掉指定的東西，多的留著', () => {
  const s = player({ 豪華蓋飯: 12, 鐵礦: 2 });
  assert.deepEqual(payOffer(s, offer), { ok: true });
  assert.equal(countOf(s, '豪華蓋飯'), 2);
  assert.equal(countOf(s, '鐵礦'), 0);
});

test('付不起（任何一樣不夠）：什麼都不扣，說明差多少', () => {
  const s = player({ 豪華蓋飯: 9, 鐵礦: 5 });
  const r = payOffer(s, offer);
  assert.match(r.error, /豪華蓋飯 需要 10、只有 9/);
  assert.deepEqual(r.lacks, [{ name: '豪華蓋飯', need: 10, have: 9 }]);
  assert.equal(countOf(s, '豪華蓋飯'), 9); // 沒扣
  assert.equal(countOf(s, '鐵礦'), 5);
  assert.equal(shortages(player({}), offer.want).length, 2);
});

test('紀念品不能拿來交易（就算有也算付不起）', () => {
  const s = player({ 豪華蓋飯: 10 });
  s.keepsakes = { 豪華蓋飯: { desc: 'x' } };
  assert.equal(payOffer(s, { want: { 豪華蓋飯: 1 } }).ok, undefined);
});

test('交易結果的信：用伺服器寫的 note 當標題，東西進背包；沒有 note 照舊', () => {
  const s = player({});
  const r = applyMail(s, { kind: 'gift', items: { 大師技能書: 10 }, fromName: '甲', note: '與 甲 的交易成功' });
  assert.equal(r.title, '與 甲 的交易成功');
  assert.equal(countOf(s, '大師技能書'), 10);
  assert.equal(applyMail(s, { kind: 'gift', items: { 鐵礦: 1 }, fromName: '甲' }).title, '甲 送給你東西');
  assert.equal(itemsText({ 豪華蓋飯: 10, 鐵礦: 5 }), '豪華蓋飯 ×10、鐵礦 ×5');
});
