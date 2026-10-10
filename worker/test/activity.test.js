// 玩家日誌：回報、查詢（依玩家、類別、翻頁）、每人上限、輸入驗證
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { ACTIVITY_PER_USER, ACTIVITY_PAGE } from '../src/config.js';
import { makeDb } from './helpers.js';

const P1 = { uid: '300', name: '玩家一', avatar: null };
const P2 = { uid: '400', name: '玩家二', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,200,300,400', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '200' };

function room() {
  let clock = 1_000_000;
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng: () => 0.5, uuid: (() => { let n = 0; return () => `id${++n}`; })() });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 1500; return handle(...a); }; // 每則訊息隔 1.5 秒，不會被限流
  core.join(P1); core.join(P2);
  return core;
}
const send = (core, user, msg) => core.handle(user, JSON.stringify(msg));
const errorOf = (res) => res.out.find((o) => o.msg.t === 'error')?.msg;
const list = (core, user, msg = {}) => send(core, user, { t: 'actList', rid: 'l1', ...msg }).out.find((o) => o.msg.t === 'acts').msg;
const post = (core, user, cat, text, lines, who) => send(core, user, { t: 'actPost', cat, text, lines, who });

test('日誌：回報後全員收到廣播；任何玩家都查得到，最新的在前', () => {
  const core = room();
  const res = post(core, P1, 'rest', '採集 釣魚 ×3，經驗 +150', ['鮮美肉 ×10'], '福德');
  const b = res.out[0];
  assert.equal(b.to, 'all');
  assert.equal(b.msg.t, 'act');
  assert.equal(b.msg.entry.who, '福德');
  assert.equal(b.msg.entry.name, '玩家一');
  assert.equal(b.msg.entry.uid, '300');
  post(core, P2, 'item', '吃下 拉麵（修整）', []);
  post(core, P1, 'learn', '八卦掌 學會，升到 1 級', ['消耗 30 經驗']);
  const all = list(core, P2); // 玩家二也看得到玩家一的
  assert.deepEqual(all.entries.map((e) => e.text), ['八卦掌 學會，升到 1 級', '吃下 拉麵（修整）', '採集 釣魚 ×3，經驗 +150']);
  assert.equal(all.entries[1].who, '玩家二'); // 沒給角色名稱就用 Discord 名稱
  assert.deepEqual(list(core, P2, { uid: '300' }).entries.map((e) => e.cat), ['learn', 'rest']);
  assert.deepEqual(list(core, P1, { cat: 'item' }).entries.map((e) => e.uid), ['400']);
  assert.deepEqual(list(core, P1, { uid: '400', cat: 'rest' }).entries, []);
});

test('日誌：翻頁（before）與每人上限', () => {
  const core = room();
  for (let i = 0; i < ACTIVITY_PAGE + 5; i++) post(core, P1, 'rest', `第 ${i} 筆`);
  const first = list(core, P1);
  assert.equal(first.entries.length, ACTIVITY_PAGE);
  assert.equal(first.more, true);
  assert.equal(first.entries[0].text, `第 ${ACTIVITY_PAGE + 4} 筆`);
  const second = list(core, P1, { before: first.next });
  assert.equal(second.entries.length, 5);
  assert.equal(second.more, false);
  assert.equal(second.entries.at(-1).text, '第 0 筆');
  // 每人只留最近 ACTIVITY_PER_USER 筆；別人的不受影響
  post(core, P2, 'item', '別人的一筆');
  for (let i = 0; i < ACTIVITY_PER_USER + 10; i++) core.db.exec('INSERT INTO activity(uid, t, json) VALUES (?, 1, ?)', '300', JSON.stringify({ cat: 'rest', text: 'x', lines: [] }));
  post(core, P1, 'rest', '最後一筆');
  const count = core.db.exec('SELECT COUNT(*) AS n FROM activity WHERE uid = ?', '300')[0].n;
  assert.equal(count, ACTIVITY_PER_USER);
  assert.equal(core.db.exec('SELECT COUNT(*) AS n FROM activity WHERE uid = ?', '400')[0].n, 1);
});

test('日誌：輸入驗證（類別、文字、行數與長度）', () => {
  const core = room();
  for (const bad of [{ cat: 'x', text: 'a' }, { cat: 'rest', text: '' }, { cat: 'rest', text: '   ' }, { cat: 'rest' }, { text: 'a' }]) {
    assert.equal(errorOf(send(core, P1, { t: 'actPost', ...bad }))?.code, 'bad_activity', JSON.stringify(bad));
  }
  const long = post(core, P1, 'rest', 'x'.repeat(500), Array.from({ length: 30 }, (_, i) => `行${i}${'y'.repeat(120)}`)).out[0].msg.entry;
  assert.equal(long.text.length, 120);
  assert.equal(long.lines.length, 10);
  assert.ok(long.lines.every((l) => l.length <= 80));
  assert.equal(errorOf(send(core, P1, { t: 'actList', rid: 'a', uid: 'abc' }))?.code, 'bad_activity');
  assert.equal(errorOf(send(core, P1, { t: 'actList', rid: 'a', cat: 'zzz' }))?.code, 'bad_activity');
  assert.equal(errorOf(send(core, P1, { t: 'actList', rid: 'a', before: -3 }))?.code, 'bad_activity');
});

test('日誌：不在白名單的人不能回報也不能查', () => {
  const core = room();
  const out = { uid: '999', name: '路人', avatar: null };
  assert.equal(send(core, out, { t: 'actPost', cat: 'rest', text: 'a' }).close?.code, 4403);
  assert.equal(send(core, out, { t: 'actList', rid: 'a' }).close?.code, 4403);
});
