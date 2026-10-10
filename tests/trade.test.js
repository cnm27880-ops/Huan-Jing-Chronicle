// 玩家交易：B 這一端付不付得起（伺服器流程在 worker/test/mail.test.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { addItem, countOf } from '../src/game/engine.js';
import { applyMail } from '../src/game/mail.js';
import { payOffer, shortages, itemsText, takeOffer, refundOffer, splitGold, GOLD_NAME } from '../src/game/trade.js';

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

test('金幣也能交易：付款檢查、只出金幣、寄失敗時還回去', () => {
  const s = player({ 豪華蓋飯: 10 });
  s.gold = 500;
  const o = { want: { 豪華蓋飯: 10 }, wantGold: 300, give: {}, giveGold: 1000 };
  assert.deepEqual(payOffer(s, o), { ok: true });
  assert.deepEqual([countOf(s, '豪華蓋飯'), s.gold], [0, 200]);
  const poor = player({ 豪華蓋飯: 10 });
  poor.gold = 299;
  const r = payOffer(poor, o);
  assert.match(r.error, /金幣 需要 300、只有 299/);
  assert.deepEqual([countOf(poor, '豪華蓋飯'), poor.gold], [10, 299]); // 一樣都沒扣
  // 只出金幣（沒有物品）：A 發單時的押金
  const a = player({});
  a.gold = 1000;
  assert.equal(takeOffer(a, {}, 1000), true);
  assert.equal(a.gold, 0);
  assert.equal(takeOffer(a, {}, 1), false);
  refundOffer(a, {}, 1000);
  assert.equal(a.gold, 1000);
  assert.equal(itemsText({}, 1500), '金幣 1,500');
  assert.equal(itemsText({ 鐵礦: 5 }, 0), '鐵礦 ×5');
});

test('交易的金幣收到：信裡的 gold 加進錢包並寫在通知裡（只有物品的信照舊）', () => {
  const s = player({});
  s.gold = 100;
  const r = applyMail(s, { kind: 'gift', items: {}, gold: 400, fromName: '甲', note: '與 甲 的交易成功' });
  assert.equal(s.gold, 500);
  assert.deepEqual(r.lines, ['金幣 +400']);
  assert.equal(applyMail(s, { kind: 'gift', items: { 鐵礦: 1 }, gold: -5, fromName: '甲' }).lines.length, 1); // 負數、亂寫的不理
  assert.equal(s.gold, 500);
});

test('金幣當成物品格：splitGold 把「金幣」從物品清單拆出來（Map 或物件都行，重複的加總）', () => {
  assert.equal(GOLD_NAME, '金幣');
  assert.deepEqual(splitGold(new Map([['鐵礦', 2], ['金幣', 500]])), { items: { 鐵礦: 2 }, gold: 500 });
  assert.deepEqual(splitGold({ 金幣: 100 }), { items: {}, gold: 100 });
  assert.deepEqual(splitGold({ 豪華蓋飯: 10 }), { items: { 豪華蓋飯: 10 }, gold: 0 });
  assert.deepEqual(splitGold(undefined), { items: {}, gold: 0 });
});
