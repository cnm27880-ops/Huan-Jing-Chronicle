// 執行方式：npm test
// 交易：交易大廳（每日原價 5 個）、黑市（擲骰溢價／壓價、勞動抵債、代金券換金幣）、特殊黑市（黑市團、50 個）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hallQuote, hallTrade, hallLeft, blackBuy, blackSell, exchangeVouchers, exchangeLeft,
  setBlackSession, specialTrade, specialLeft, gearPriceName, marketToday,
} from '../src/game/market.js';
import { newDay } from '../src/game/engine.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
/** 依序擲出指定點數的假亂數：[點數, 面數] */
const rolls = (...pairs) => {
  let i = 0;
  return () => { const [v, sides] = pairs[Math.min(i++, pairs.length - 1)]; return (v - 1) / sides + 0.0001; };
};

test('交易大廳：每天原價 5 個（買＋賣合計），超過的用黑心價', () => {
  const s = fresh();
  assert.deepEqual(hallQuote(s, 'buy', '綠草藥', 7), { item: '綠草藥', qty: 7, normal: 5, black: 2, unit: [10, 18], total: 5 * 10 + 2 * 18 });
  const gold = s.gold;
  const r = hallTrade(s, 'buy', '綠草藥', 3);
  assert.equal(r.total, 30);
  assert.equal(s.gold, gold - 30);
  assert.equal(hallLeft(s), 2);
  s.inventory.紅藥水 = 4;
  const sell = hallTrade(s, 'sell', '紅藥水', 4); // 2 個原價 40、2 個黑心 32
  assert.equal(sell.total, 2 * 40 + 2 * 32);
  assert.equal(hallLeft(s), 0);
  assert.equal(s.inventory.紅藥水 ?? 0, 0);
  newDay(s);
  assert.equal(hallLeft(s), 5); // 換日重置
});

test('交易大廳：金幣不足或物品不足就不能交易，也不扣次數', () => {
  const s = fresh();
  s.gold = 10;
  assert.match(hallTrade(s, 'buy', '殘缺技能書', 1).error, /金幣不足/);
  assert.match(hallTrade(s, 'sell', '炒飯', 1).error, /不足/);
  assert.match(hallTrade(s, 'buy', '傳說肉', 1).error, /不收/);
  assert.equal(hallLeft(s), 5);
});

test('已鑑定裝備照等級的通用價賣（初階＝低階），鑲了寶石的不能賣', () => {
  const s = fresh();
  s.gear.push({ id: 900, tier: '初階', slot: 'weapon', effects: [{ stat: '物理傷害', value: 2 }] });
  s.gear.push({ id: 901, tier: '進階', slot: 'armor', effects: [{ stat: '體魄強韌', value: 5 }], gem: { stat: '生命', value: 30 } });
  assert.equal(gearPriceName(s.gear.at(-2)), '低階武器');
  const r = hallTrade(s, 'sell', '低階武器', 1, [900]);
  assert.equal(r.total, 120);
  assert.ok(!s.gear.some((g) => g.id === 900));
  assert.match(hallTrade(s, 'sell', '進階防具', 1, [901]).error, /寶石/);
});

test('黑市買：1D10+2 成溢價（3 → ×1.3、12 → ×2.2）', () => {
  const s = fresh();
  const gold = s.gold;
  const lo = blackBuy(s, '綠草藥', 10, rolls([1, 10])); // 結果 3
  assert.equal(lo.roll, 3);
  assert.equal(lo.total, 130);
  const hi = blackBuy(s, '日華蓮', 2, rolls([10, 10])); // 結果 12
  assert.equal(hi.total, 660);
  assert.equal(s.gold, gold - 130 - 660);
});

test('黑市買：付不出錢就勞動抵債，1 時間＝200 金幣，時間可以變負，換日先還', () => {
  const s = fresh();
  s.gold = 100;
  s.time = 1;
  const r = blackBuy(s, '奧利哈鋼', 4, rolls([10, 10])); // 150×4×2.2 = 1320，欠 1220 → 7 時間
  assert.equal(r.total, 1320);
  assert.equal(r.labor, 7);
  assert.equal(s.gold, 0);
  assert.equal(s.time, -6);
  newDay(s);
  assert.equal(s.time, 4);
});

test('黑市賣：2D4+2 成壓價，得到代金券；代金券每天最多換 1500 金幣', () => {
  const s = fresh();
  s.inventory.玄武湯 = 3;
  const v = s.inventory.代金券;
  const r = blackSell(s, '玄武湯', 3, rolls([1, 4], [2, 4])); // 1+2+2 = 5 → ×0.5
  assert.equal(r.roll, 5);
  assert.equal(r.total, 750);
  assert.equal(s.inventory.代金券, v + 750);
  const gold = s.gold;
  assert.deepEqual(exchangeVouchers(s, 1000), { n: 1000 });
  assert.match(exchangeVouchers(s, 600).error, /最多再換 500/);
  assert.equal(exchangeLeft(s), 500);
  assert.equal(s.gold, gold + 1000);
});

test('特殊黑市：只在黑市團、代金券固定價、每團買＋賣合計 50 個', () => {
  const s = fresh();
  assert.match(specialTrade(s, 'buy', '永恆草', 1).error, /黑市團/);
  setBlackSession(s, true);
  const v = s.inventory.代金券;
  assert.equal(specialTrade(s, 'buy', '進階技能書', 2).total, 10000);
  assert.equal(s.inventory.代金券, v - 10000);
  s.inventory.生命泉 = 49;
  assert.match(specialTrade(s, 'sell', '生命泉', 49).error, /最多再交易 48/);
  assert.equal(specialTrade(s, 'sell', '生命泉', 48).total, 144000);
  assert.equal(specialLeft(s), 0);
  setBlackSession(s, true); // 下一次開團歸零
  assert.equal(specialLeft(s), 50);
  assert.equal(marketToday(s).session.open, true);
});
