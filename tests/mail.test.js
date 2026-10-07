// 執行方式：npm test
// 送東西與餵藥（src/game/mail.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { addItem, countOf } from '../src/game/engine.js';
import { maxHp } from '../src/game/stats.js';
import { giftable, takeItems, refundItems, applyMail } from '../src/game/mail.js';

const hero = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));

test('打包：全部夠才扣；不夠、數量不對、紀念品都不能送；失敗可以還回去', () => {
  const s = hero();
  addItem(s, '鐵礦', 5); addItem(s, '紅藥水', 2);
  assert.equal(takeItems(s, { 鐵礦: 6 }), false);
  assert.equal(countOf(s, '鐵礦'), 5); // 一樣都沒扣
  assert.equal(takeItems(s, { 鐵礦: 2, 紅藥水: 9 }), false);
  assert.equal(countOf(s, '鐵礦'), 5);
  assert.equal(takeItems(s, { 鐵礦: 0 }), false);
  assert.equal(takeItems(s, {}), false);
  const keepsake = Object.keys(s.keepsakes ?? {})[0];
  if (keepsake) { addItem(s, keepsake, 1); assert.equal(giftable(s, keepsake), false); }
  assert.equal(takeItems(s, { 鐵礦: 5, 紅藥水: 1 }), true);
  assert.deepEqual([countOf(s, '鐵礦'), countOf(s, '紅藥水')], [0, 1]);
  assert.ok(!('鐵礦' in s.inventory)); // 扣到 0 就從背包拿掉
  refundItems(s, { 鐵礦: 5, 紅藥水: 1 });
  assert.deepEqual([countOf(s, '鐵礦'), countOf(s, '紅藥水')], [5, 2]);
});

test('收到禮物：加進背包，通知列出每一樣', () => {
  const s = hero();
  const before = countOf(s, '鐵礦');
  const r = applyMail(s, { kind: 'gift', fromName: '玩家一', from: '300', items: { 鐵礦: 3, 紅藥水: 1 } });
  assert.equal(countOf(s, '鐵礦'), before + 3);
  assert.match(r.title, /玩家一 送給你東西/);
  assert.deepEqual(r.lines, ['鐵礦 ×3', '紅藥水 ×1']);
  assert.equal(r.bounce, undefined);
});

test('被餵藥：照伺服器擲的點數回復、倒地的站起來、毒性算在自己身上', () => {
  const s = hero();
  s.hp = 0; s.toxicity = 3;
  const r = applyMail(s, { kind: 'potion', fromName: '玩家一', from: '300', potion: '紅藥水', heal: 12 });
  assert.equal(s.hp, 12);
  assert.equal(s.toxicity, 5);
  assert.match(r.lines[0], /回復 12 生命，你站起來了/);
  // 回復量不會超過生命上限
  s.hp = maxHp(s) - 3;
  applyMail(s, { kind: 'potion', fromName: 'x', from: '300', potion: '紅藥水', heal: 50 });
  assert.equal(s.hp, maxHp(s));
});

test('被餵藥時毒性已滿：不喝，藥水退回給對方', () => {
  const s = hero();
  s.toxicity = 14; s.hp = 0;
  const r = applyMail(s, { kind: 'potion', fromName: '玩家一', from: '300', potion: '紅藥水', heal: 12 });
  assert.equal(s.hp, 0);
  assert.equal(s.toxicity, 14);
  assert.deepEqual(r.bounce, { to: '300', items: { 紅藥水: 1 } });
  // 不是回復藥水、點數亂填：直接忽略
  assert.equal(applyMail(s, { kind: 'potion', fromName: 'x', from: '300', potion: '黃藥水', heal: 5 }).bounce, undefined);
  assert.equal(s.toxicity, 14);
});

// ---------- 整條流程：寄件人 → 伺服器 → （離線）→ 收件人上線領取 ----------
import { RoomCore } from '../worker/src/room-core.js';
import { makeDb } from '../worker/test/helpers.js';
import { POTIONS } from '../src/game/rules.js';

test('整條流程：玩家一送禮＋餵藥，玩家二離線；上線後領取、套用，領兩次不會重複', () => {
  let clock = 1_000_000;
  const rng = () => 0.5; rng.int = () => 5;
  const core = new RoomCore({ db: makeDb(), env: { DISCORD_ALLOWED_IDS: '300,400', GM_DISCORD_IDS: '300' }, now: () => (clock += 250), rng, uuid: (() => { let n = 0; return () => `m${++n}`; })() });
  core.migrate();
  const A = { uid: '300', name: '玩家一' }; const B = { uid: '400', name: '玩家二' };
  core.join(A); core.join(B);
  const sender = hero(); const target = hero();
  addItem(sender, '鐵礦', 4); addItem(sender, '回春湯', 1);
  target.hp = 0; target.toxicity = 0;
  const ironBefore = countOf(target, '鐵礦');

  assert.ok(takeItems(sender, { 鐵礦: 4 }));
  core.handle(A, JSON.stringify({ t: 'mailSend', to: '400', kind: 'gift', items: { 鐵礦: 4 } }));
  assert.ok(takeItems(sender, { 回春湯: 1 }));
  core.handle(A, JSON.stringify({ t: 'mailSend', to: '400', kind: 'potion', potion: '回春湯' }));
  assert.equal(countOf(sender, '鐵礦'), 0);

  const inbox = core.hello(B).mail; // 玩家二上線
  assert.equal(inbox.length, 2);
  for (const m of inbox) {
    const got = JSON.parse(JSON.stringify(core.handle(B, JSON.stringify({ t: 'mailClaim', id: m.id })).out[0].msg.mail));
    assert.ok(got);
    applyMail(target, got);
    assert.equal(core.handle(B, JSON.stringify({ t: 'mailClaim', id: m.id })).out[0].msg.mail, null); // 再領一次是空的
  }
  assert.equal(countOf(target, '鐵礦'), ironBefore + 4);
  assert.ok(target.hp > 0); // 回春湯 8D10（每顆 5）= 40，倒地的站起來了
  assert.equal(target.toxicity, POTIONS.回春湯.toxicity);
  assert.equal(core.hello(B).mail.length, 0);
});
