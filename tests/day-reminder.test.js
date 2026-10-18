// 執行方式：npm test
// 換日提醒：純顯示的提醒清單（時間、惜未央時間獎勵、原價額度、每日材料）
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayReminders } from '../src/game/dayReminder.js';
import { HALL_SELL } from '../src/game/market.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

/** 全部做完的玩家：時間 0、額度用完、材料都領了 */
function done() {
  const s = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  s.time = 0;
  s.inventory = { ...s.inventory, 惜未央: 0 };
  for (const name of Object.keys(HALL_SELL)) s.inventory[name] = 0; // 沒有任何交易大廳收的東西
  s.gear = [];
  s.xiweiTime = 2;
  s.market = { day: s.loginDays, hallUsed: 5, exchanged: 0, session: { open: false, used: 0 } };
  s.dailyDone = { 南夢水: true, 不穩定能量: true, 福瑞毛: true };
  return s;
}

test('換日提醒：全部完成時沒有提醒', () => {
  assert.deepEqual(dayReminders(done()), []);
});

test('換日提醒：時間沒用完會顯示剩餘點數', () => {
  const s = done(); s.time = 3;
  assert.deepEqual(dayReminders(s), ['時間還剩 3 / 10 點沒用']);
});

test('換日提醒：有惜未央且時間獎勵沒領滿', () => {
  const s = done(); s.inventory.惜未央 = 1; s.xiweiTime = 1;
  assert.match(dayReminders(s)[0], /惜未央.*還能領 1 次/);
  s.xiweiTime = 2; assert.deepEqual(dayReminders(s), []); // 領滿就不提醒
  s.xiweiTime = 0; s.inventory.惜未央 = 0; assert.deepEqual(dayReminders(s), []); // 沒有惜未央也不提醒
});

test('換日提醒：原價額度沒用完而且有東西可賣才提醒', () => {
  const s = done(); s.market.hallUsed = 2;
  assert.deepEqual(dayReminders(s), []); // 沒東西可賣
  s.inventory.紅藥水 = 1;
  assert.match(dayReminders(s)[0], /還剩 3 個/);
  s.market.hallUsed = 5; assert.deepEqual(dayReminders(s), []); // 額度用完
  s.market.day = s.loginDays - 1; // 記錄是昨天的＝今天還沒用
  assert.match(dayReminders(s)[0], /還剩 5 個/);
});

test('換日提醒：背包裝備（沒鑲寶石）算可以賣，鑲了寶石不算', () => {
  const s = done(); s.market.hallUsed = 0;
  s.gear = [{ id: 'g1', slot: 'weapon', tier: '進階', gem: { name: '紅寶石' } }];
  assert.deepEqual(dayReminders(s), []);
  s.gear[0].gem = null;
  assert.equal(dayReminders(s).length, 1);
});

test('換日提醒：每日材料還沒領的逐項列出', () => {
  const s = done(); s.dailyDone = { 南夢水: true };
  assert.deepEqual(dayReminders(s), ['今天還沒取的特殊材料：不穩定能量、福瑞毛']);
  s.dailyDone = undefined;
  assert.match(dayReminders(s)[0], /南夢水、不穩定能量、福瑞毛/);
});

test('換日提醒：只讀不改存檔', () => {
  const s = done(); delete s.market; delete s.dailyDone;
  const before = JSON.stringify(s);
  dayReminders(s);
  assert.equal(JSON.stringify(s), before);
});
