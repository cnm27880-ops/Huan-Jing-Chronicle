// 執行方式：npm test
// 確認網頁的判定結果與機器人完全一致
import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherTier, FOOD_EQUIV, FOODS } from '../src/game/rules.js';
import { tickRestStomach, proficiency, modifier, eat, gather, craft, eatOrQueue, eatPreset, addPreset, presetLabel, clearQueue, overwriteLoss, fixItemAliases, newDay, dayCap, nextUnlock } from '../src/game/engine.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
// 讓 d20 固定擲出 n：Math.floor(r*20)+1 = n
const fixed = (n) => () => (n - 1) / 20;

test('採集評級邊界與機器人相同', () => {
  const cases = [[9, '簡單'], [10, '普通'], [17, '普通'], [18, '困難'], [24, '困難'], [25, '史詩'], [39, '史詩'], [40, '神級']];
  for (const [total, tier] of cases) assert.equal(gatherTier(total).tier, tier, `總分 ${total}`);
});

test('熟練 = 1 + 三份碳烤肉排 = 10', () => {
  const s = fresh();
  for (let i = 0; i < 3; i++) assert.equal(eat(s, '碳烤肉排', 'rest'), null);
  assert.equal(proficiency(s, 'rest').total, 10);
  assert.equal(eat(s, '碳烤肉排', 'rest'), '胃袋已滿，最多 3 份。');
});

test('修整與跑團胃袋各自獨立', () => {
  const s = fresh();
  eat(s, '傳奇盛宴', 'session');
  assert.equal(proficiency(s, 'rest').total, 1);
  assert.equal(proficiency(s, 'session').total, 5);
});

test('非生活技能不加熟練', () => {
  const s = fresh();
  eat(s, '傳奇盛宴', 'session');
  assert.equal(modifier(s, '神秘', 'session').total, 4);
  assert.equal(modifier(s, '釣魚', 'session').total, 17 + 5);
});

test('修整食物 10 次檢定後消失，且只算修整', () => {
  const s = fresh();
  eat(s, '拉麵', 'rest');
  gather(s, '採藥', 9, [], fixed(10));
  assert.equal(s.restStomach[0].left, 1);
  s.time = 10;
  gather(s, '採藥', 1, [], fixed(10));
  assert.equal(s.restStomach.length, 0);
});

test('紀念品用一個少一個，可與食物疊加', () => {
  const s = fresh();
  eat(s, '大肉棒', 'rest');
  const before = s.inventory['繃繃狗的爪爪'];
  const r = gather(s, '挖礦', 1, ['繃繃狗的爪爪', '兄弟好相助'], fixed(1));
  // 挖礦 2 + 熟練(1+2) + 爪爪 5 + 兄弟 3 = 13
  assert.equal(r.rolls[0].mod, 13);
  assert.equal(s.inventory['繃繃狗的爪爪'], before - 1);
});

test('採集時間用完就停止，製作不消耗時間', () => {
  const s = fresh();
  s.time = 2;
  assert.equal(gather(s, '採藥', 5, [], fixed(10)).rolls.length, 2);
  assert.equal(s.time, 0);
  const r = craft(s, '書寫', '普通', 1, [], fixed(20));
  assert.equal(r.rolls.length, 1);
  assert.equal(s.time, 0);
});

test('修整胃袋滿了會排隊，食物用完自動補上，連做 30 次熟練不中斷', () => {
  const s = fresh();
  s.inventory['碳烤肉排'] = 6;
  for (let i = 0; i < 6; i++) assert.equal(eatOrQueue(s, '碳烤肉排'), null);
  assert.equal(s.restStomach.length, 3);
  assert.equal(s.restQueue.length, 3);
  assert.equal(s.inventory['碳烤肉排'] ?? 0, 0);
  s.time = 10;
  const r = gather(s, '採藥', 10, [], fixed(10));
  assert.equal(r.rolls.length, 10);
  // 前 10 次吃完第一輪，補上第二輪
  assert.equal(s.restQueue.length, 0);
  assert.equal(s.restStomach.length, 3);
  assert.equal(proficiency(s, 'rest').total, 10);
});

test('菜單：吃 N 組，全有或全無，順序固定', () => {
  const s = fresh();
  s.inventory['傳奇盛宴'] = 2;
  s.inventory['碳烤肉排'] = 4;
  assert.equal(addPreset(s, ['傳奇盛宴', '碳烤肉排', '碳烤肉排']), null);
  assert.equal(addPreset(s, ['傳奇盛宴', '碳烤肉排', '碳烤肉排']), '已經有一樣的菜單了。');
  assert.match(eatPreset(s, s.foodPresets[0], 3, 'rest'), /不夠/);
  assert.equal(s.inventory['傳奇盛宴'], 2); // 失敗不動背包
  assert.equal(eatPreset(s, s.foodPresets[0], 2, 'rest'), null);
  assert.deepEqual(s.restStomach.map((x) => x.food), ['傳奇盛宴', '碳烤肉排', '碳烤肉排']);
  assert.deepEqual(s.restQueue, ['傳奇盛宴', '碳烤肉排', '碳烤肉排']);
  assert.equal(presetLabel(s.foodPresets[0]), '傳奇盛宴 ×1＋碳烤肉排 ×2');
});

test('跑團胃袋沒有佇列，菜單放不下就拒絕；佇列可退回背包', () => {
  const s = fresh();
  s.inventory['拉麵'] = 6;
  assert.match(eatPreset(s, ['拉麵', '拉麵', '拉麵'], 2, 'session'), /吃不下/);
  assert.equal(s.inventory['拉麵'], 6);
  for (let i = 0; i < 5; i++) eatOrQueue(s, '拉麵');
  assert.equal(clearQueue(s), 2);
  assert.equal(s.inventory['拉麵'], 3);
});

test('覆蓋：先吃兩份惜未央加時間，再用三份肉排蓋掉', () => {
  const s = fresh();
  s.inventory['惜未央'] = 2;
  s.inventory['碳烤肉排'] = 3;
  s.time = 5;
  eatPreset(s, ['惜未央', '惜未央'], 1, 'rest');
  assert.equal(s.time, 7);
  const meat = ['碳烤肉排', '碳烤肉排', '碳烤肉排'];
  assert.deepEqual(overwriteLoss(s, meat, 'rest').map((x) => x.food), ['惜未央', '惜未央']);
  assert.equal(eatPreset(s, meat, 1, 'rest', { overwrite: true }), null);
  assert.deepEqual(s.restStomach.map((x) => x.food), meat);
  assert.equal(proficiency(s, 'rest').total, 10);
  assert.equal(s.inventory['惜未央'] ?? 0, 0); // 被蓋掉的不退回
});

test('覆蓋：背包不夠就不蓋掉任何東西', () => {
  const s = fresh();
  s.inventory['惜未央'] = 2;
  delete s.inventory['碳烤肉排'];
  eatPreset(s, ['惜未央', '惜未央'], 1, 'rest');
  assert.match(eatPreset(s, ['碳烤肉排', '碳烤肉排', '碳烤肉排'], 1, 'rest', { overwrite: true }), /不夠/);
  assert.equal(s.restStomach.length, 2);
});

test('背包裡打錯字的「代金卷」併進「代金券」', () => {
  const s = fresh();
  s.inventory['代金券'] = 5;
  s.inventory['代金卷'] = 20;
  s.sortOrder.push('代金卷');
  assert.equal(fixItemAliases(s), true);
  assert.equal(s.inventory['代金券'], 25);
  assert.equal(s.inventory['代金卷'], undefined);
  assert.ok(!s.sortOrder.includes('代金卷'));
  assert.equal(fixItemAliases(s), false); // 再跑一次沒有變動
});

// ---------- 「新的一天」每週開放上限（台灣時間 UTC+8） ----------
const tw = (t) => Date.parse(`${t}+08:00`);

test('每週上限：10/19 22:59:59 還是 64，23:00:00 起 71', () => {
  assert.equal(dayCap(tw('2026-10-18T12:00:00')), 64);
  assert.equal(dayCap(tw('2026-10-19T22:59:59')), 64);
  assert.equal(dayCap(tw('2026-10-19T23:00:00')), 71);
});

test('每週上限：每 7 天 +7（10/26 23:00 → 78，11/2 23:00 → 85）', () => {
  assert.equal(dayCap(tw('2026-10-26T22:59:59')), 71);
  assert.equal(dayCap(tw('2026-10-26T23:00:00')), 78);
  assert.equal(dayCap(tw('2026-11-02T23:00:00')), 85);
});

test('下一個解鎖時間點與解鎖後的上限', () => {
  const a = nextUnlock(tw('2026-10-18T12:00:00'));
  assert.equal(a.at, tw('2026-10-19T23:00:00'));
  assert.equal(a.cap, 71);
  const b = nextUnlock(tw('2026-10-19T23:00:00'));
  assert.equal(b.at, tw('2026-10-26T23:00:00'));
  assert.equal(b.cap, 78);
});

test('新的一天：到上限就擋下（不動任何數值），邊界後才能換', () => {
  const s = fresh();
  s.loginDays = 64;
  s.time = 3;
  const r = newDay(s, tw('2026-10-19T22:59:59'));
  assert.equal(r.ok, false);
  assert.equal(r.cap, 64);
  assert.equal(r.next.cap, 71);
  assert.equal(s.loginDays, 64);
  assert.equal(s.time, 3);
  assert.equal(newDay(s, tw('2026-10-19T23:00:00')).ok, true);
  assert.equal(s.loginDays, 65);
  assert.equal(s.time, 10);
});

test('新的一天：已超過上限的玩家不扣回，只是不能再換日', () => {
  const s = fresh();
  s.loginDays = 70;
  const r = newDay(s, tw('2026-10-18T12:00:00'));
  assert.equal(r.ok, false);
  assert.equal(s.loginDays, 70);
  s.loginDays = 77;
  assert.equal(newDay(s, tw('2026-10-26T22:59:59')).ok, false);
  assert.equal(newDay(s, tw('2026-10-26T23:00:00')).ok, true);
  assert.equal(s.loginDays, 78);
});

test('菜單：料理不夠時用效果相同的補，原本的先吃', () => {
  const s = fresh();
  s.inventory['傳奇盛宴'] = 1;
  s.inventory['小確幸套餐'] = 2;
  s.inventory['碳烤肉排'] = 2;
  s.foodPresets = [['傳奇盛宴', '碳烤肉排']];
  const subs = [];
  assert.equal(eatPreset(s, s.foodPresets[0], 2, 'rest', { subs }), null);
  assert.equal(s.inventory['傳奇盛宴'] ?? 0, 0);
  assert.equal(s.inventory['小確幸套餐'], 1); // 只補了一份
  assert.deepEqual(subs, ['傳奇盛宴 → 小確幸套餐 ×1']);
  s.inventory['大肉棒'] = 0;
  s.inventory['祕製桃花酒'] = 0;
  assert.match(eatPreset(s, ['大肉棒'], 1, 'rest'), /不夠/); // 沒有可代替的就照舊報錯
});

test('食物互通：同一組的效果必須完全一樣', () => {
  for (const g of FOOD_EQUIV) {
    const [a, ...rest] = g.map((f) => FOODS[f]);
    assert.ok(a, '互通清單裡有不是食物的名稱');
    rest.forEach((b) => assert.deepEqual({ ...b, effect: 0 }, { ...a, effect: 0 }));
  }
});

test('菜單吃多組：一組是一個單位，上一組用完才輪到下一組', () => {
  const s = fresh();
  s.restStomach = []; s.restQueue = []; delete s.restQueueGroups;
  s.inventory['大肉棒'] = 10;
  assert.equal(eatPreset(s, ['大肉棒', '大肉棒'], 5, 'rest'), null);
  assert.deepEqual(s.restStomach.map((x) => x.food), ['大肉棒', '大肉棒']); // 第三格不會被第 2 組的第一根填滿
  assert.equal(s.restQueue.length, 8);
  for (let i = 0; i < 9; i++) { tickRestStomach(s); assert.equal(s.restStomach.length, 2); assert.equal(s.restQueue.length, 8); }
  tickRestStomach(s); // 第 10 次：第 1 組用完，第 2 組整組進來
  assert.equal(s.restStomach.length, 2);
  assert.equal(s.restQueue.length, 6);
  assert.equal(s.inventory['大肉棒'] ?? 0, 0);
});

test('菜單只有 1 份吃多組：同時間胃袋只放 1 份', () => {
  const s = fresh();
  s.restStomach = []; s.restQueue = []; delete s.restQueueGroups;
  s.inventory['大肉棒'] = 3;
  assert.equal(eatPreset(s, ['大肉棒'], 3, 'rest'), null);
  assert.equal(s.restStomach.length, 1);
  assert.equal(s.restQueue.length, 2);
  for (let i = 0; i < 10; i++) tickRestStomach(s);
  assert.equal(s.restStomach.length, 1);
  assert.equal(s.restQueue.length, 1);
});

test('單吃排隊的料理照舊每份有空格就補；舊存檔沒有分組也能用', () => {
  const s = fresh();
  s.restStomach = [{ food: '拉麵', left: 1 }]; s.restQueue = ['炒飯', '炒飯']; delete s.restQueueGroups;
  tickRestStomach(s);
  assert.deepEqual(s.restStomach.map((x) => x.food), ['炒飯', '炒飯']);
  assert.equal(s.restQueue.length, 0);
});

test('菜單吃多組：第一組放不下整組排隊，佇列上限要算準', () => {
  const s = fresh();
  s.restStomach = [{ food: '拉麵', left: 5 }, { food: '拉麵', left: 5 }]; s.restQueue = []; delete s.restQueueGroups;
  s.inventory['大肉棒'] = 200;
  assert.equal(eatPreset(s, ['大肉棒', '大肉棒'], 2, 'rest'), null);
  assert.equal(s.restStomach.length, 2); // 只剩 1 格，放不下 2 份的一組：整組排隊
  assert.equal(s.restQueue.length, 4);
  s.restQueue = []; delete s.restQueueGroups;
  assert.match(eatPreset(s, ['大肉棒', '大肉棒'], 50, 'rest'), /佇列放不下/); // 100 份 > 99
});
