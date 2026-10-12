// 執行方式：npm test
// 確認網頁的判定結果與機器人完全一致
import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherTier } from '../src/game/rules.js';
import { proficiency, modifier, eat, gather, craft, eatOrQueue, eatPreset, addPreset, presetLabel, clearQueue, overwriteLoss } from '../src/game/engine.js';
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
  eatPreset(s, ['惜未央', '惜未央'], 1, 'rest');
  assert.match(eatPreset(s, ['碳烤肉排', '碳烤肉排', '碳烤肉排'], 1, 'rest', { overwrite: true }), /不夠/);
  assert.equal(s.restStomach.length, 2);
});
