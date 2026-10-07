// 執行方式：在專案根目錄 npm test
// 房間邏輯：成員與白名單、GM 權限、擲骰、紀錄保存、限流、輸入驗證
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { HISTORY_LIMIT, RATE_LIMIT_PER_SEC, RATE_ABUSE_PER_SEC, MAX_MESSAGE_CHARS, MAX_DRAW_DICE } from '../src/config.js';
import { LIFE_SKILLS, ART_SKILLS } from '../../src/game/rules.js';
import { makeDb, seqRng } from './helpers.js';

const GM = { uid: '100', name: 'GM', avatar: null };
const ADMIN = { uid: '200', name: '開發者', avatar: 'abc' };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const P2 = { uid: '400', name: '玩家二', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,200,300,400', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '200' };

function room(opts = {}) {
  let clock = 1_000_000;
  const db = opts.db ?? makeDb();
  const core = new RoomCore({
    db, env: opts.env ?? env, now: () => clock, rng: opts.rng ?? seqRng([3, 4, 5, 6]),
    uuid: (() => { let n = 0; return () => `id${++n}`; })(),
  });
  core.migrate();
  if (opts.autoAdvance !== false) { // 每則訊息隔 250ms，不然測試自己會撞到限流
    const handle = core.handle.bind(core);
    core.handle = (...a) => { clock += 250; return handle(...a); };
  }
  return { core, db, advance: (ms) => { clock += ms; }, clock: () => clock };
}
const send = (core, user, msg, opts) => core.handle(user, typeof msg === 'string' ? msg : JSON.stringify(msg), opts);
const eventOf = (res) => res.out.find((o) => o.msg.t === 'event')?.msg.event;
const errorOf = (res) => res.out.find((o) => o.msg.t === 'error')?.msg;

test('白名單：成員 = 名單內；名單為空一律拒絕（安全預設）', () => {
  const { core } = room();
  assert.equal(core.accessState('300'), 'ok');
  assert.equal(core.accessState('999'), 'not_allowed');
  const empty = room({ env: { ...env, DISCORD_ALLOWED_IDS: '' } }).core;
  assert.equal(empty.accessState('300'), 'whitelist_empty');
  assert.equal(empty.accessState('100'), 'whitelist_empty');
});

test('加入房間：hello 帶自己、GM、成員與歷史；重複加入不會產生重複成員', () => {
  const { core } = room();
  core.join(GM); core.join(P1); core.join(P1);
  const hello = core.hello(P1, ['100', '300']);
  assert.equal(hello.t, 'hello');
  assert.equal(hello.me.uid, '300');
  assert.equal(hello.me.isGm, false);
  assert.equal(hello.members.length, 2);
  assert.deepEqual(hello.members.map((m) => [m.uid, m.online]), [['100', true], ['300', true]]);
  assert.deepEqual(hello.gm.uids, ['100']);
  assert.equal(core.hello(GM).me.isGm, true);
  assert.equal(core.hello(ADMIN).me.isAdmin, true);
});

test('伺服器擲骰：自訂骰用伺服器 rng，廣播給所有人並寫入紀錄', () => {
  const { core } = room({ rng: seqRng([4, 5]) });
  const res = send(core, P1, { t: 'dice', rid: 'r1', who: '福德', expr: '2d6+3' });
  const ev = eventOf(res);
  assert.equal(ev.kind, 'dice');
  assert.equal(ev.label, '2D6+3');
  assert.equal(ev.big, 12);
  assert.equal(ev.who, '福德');
  assert.equal(ev.by, '300');
  assert.equal(ev.srv, true);
  assert.deepEqual(res.out.map((o) => [o.to, o.msg.t]), [['all', 'event'], ['self', 'rolled']]);
  assert.equal(res.out[1].msg.rid, 'r1');
  assert.equal(core.history()[0].id, ev.id);
});

test('伺服器擲骰：技能檢定 1D20 + 前端送來的加值', () => {
  const { core } = room({ rng: seqRng([14]) });
  const skill = LIFE_SKILLS[0];
  const res = send(core, P1, { t: 'check', rid: 'c1', who: '福德', skill, mod: 7, parts: [{ label: skill, value: 4 }, { label: '熟練', value: 3 }] });
  const ev = eventOf(res);
  assert.equal(ev.kind, 'check');
  assert.equal(ev.big, 21);
  assert.equal(ev.label, `${skill}檢定`);
  assert.match(ev.lines.join(' '), /生活技能/);
  assert.equal(res.out[1].msg.roll, 14);
  const art = eventOf(send(core, P1, { t: 'check', skill: ART_SKILLS[0], mod: 2, parts: [{ label: 'x', value: 2 }] }));
  assert.match(art.lines.join(' '), /非生活技能/); // 生活技能與否由伺服器依規則判斷，不信前端
});

test('輸入驗證：骰式格式、顆數與面數上限', () => {
  const { core } = room();
  for (const expr of ['abc', '0D6', '101D6', '1D10001', '1D0', '', '1D6+', 5, null, 'x'.repeat(41)]) {
    assert.equal(errorOf(send(core, P1, { t: 'dice', expr }))?.code, 'bad_dice', String(expr));
  }
  assert.ok(eventOf(send(core, P1, { t: 'dice', expr: '100D10000' })));
  assert.equal(core.history().length, 1); // 驗證失敗的不會寫入紀錄
});

test('輸入驗證：檢定欄位', () => {
  const { core } = room();
  const ok = { t: 'check', skill: LIFE_SKILLS[0], mod: 3, parts: [{ label: 'a', value: 3 }] };
  assert.ok(eventOf(send(core, P1, ok)));
  for (const bad of [
    { ...ok, skill: '不存在的技能' }, { ...ok, mod: 1.5 }, { ...ok, mod: 99999, parts: [{ label: 'a', value: 99999 }] },
    { ...ok, parts: [] }, { ...ok, parts: 'x' }, { ...ok, parts: [{ label: 'a', value: 4 }] }, // 明細加起來不等於加值
    { ...ok, parts: [{ label: 5, value: 3 }] }, { ...ok, parts: Array.from({ length: 13 }, () => ({ label: 'a', value: 0 })) },
  ]) assert.equal(errorOf(send(core, P1, bad))?.code, 'bad_check', JSON.stringify(bad).slice(0, 60));
});

test('輸入驗證：訊息格式、未知類型、大小、二進位', () => {
  const { core } = room();
  assert.equal(errorOf(send(core, P1, 'not json'))?.code, 'bad_json');
  for (const raw of ['[]', '1', 'null', '{"x":1}', '{"t":5}']) assert.equal(errorOf(send(core, P1, raw))?.code, 'bad_message', raw);
  assert.equal(errorOf(send(core, P1, { t: 'nope' }))?.code, 'unknown_type');
  assert.deepEqual(send(core, P1, ' '.repeat(MAX_MESSAGE_CHARS + 1)).close, { code: 1009, reason: 'message too big' });
  assert.equal(core.handle(P1, new ArrayBuffer(4)).close.code, 1003);
  // rid 格式不對就當沒有
  assert.equal(errorOf(send(core, P1, { t: 'nope', rid: '<script>' })).rid, undefined);
});

test('戰鬥／鑑定擲骰（draw）：依組別擲出每一顆，驗證組數、面數、顆數', () => {
  const { core } = room({ rng: seqRng([1, 2, 3, 4]) });
  const res = send(core, P1, { t: 'draw', rid: 'd1', pools: [[4, 3], [15, 1]] });
  const m = res.out[0].msg;
  assert.equal(m.t, 'drawn');
  assert.deepEqual(m.values, [1, 2, 3, 4]);
  assert.ok(m.draw);
  for (const pools of [[], 'x', [[4]], [[1, 3]], [[4, 0]], [[10001, 1]], [[4, 1.5]], [[4, MAX_DRAW_DICE + 1]], [[4, MAX_DRAW_DICE], [4, 1]], Array.from({ length: 33 }, () => [4, 1])]) {
    assert.equal(errorOf(send(core, P1, { t: 'draw', pools }))?.code, 'bad_draw', JSON.stringify(pools).slice(0, 40));
  }
  assert.equal(core.history().length, 0); // 只擲骰、還不算紀錄
});

test('發布事件（post）：只收白名單內的種類、清理內容；帶有效 draw 才標記伺服器擲骰，且只能用一次', () => {
  const { core } = room({ rng: seqRng([2]) });
  const draw = send(core, P1, { t: 'draw', pools: [[4, 1]] }).out[0].msg.draw;
  const event = { who: '福德', kind: 'attack', label: '重擊 → 魔物1', big: 12, tone: 'ok', lines: ['A 軌 12', 'x\u0000y'.repeat(100)], by: 'hacker', srv: true, id: 'forged' };
  const ev = eventOf(send(core, P1, { t: 'post', draw, event }));
  assert.equal(ev.srv, true);
  assert.equal(ev.by, '300'); // 發送者由連線身分決定，不信訊息裡寫的
  assert.notEqual(ev.id, 'forged');
  assert.equal(ev.lines[1].length, 200);
  assert.ok(!/\u0000/.test(ev.lines[1]));
  // 同一個 draw 不能重複使用；別人的 draw 也不能用；沒有 draw 就不標記
  assert.equal(eventOf(send(core, P1, { t: 'post', draw, event })).srv, undefined);
  const other = send(core, P2, { t: 'draw', pools: [[4, 1]] }).out[0].msg.draw;
  assert.equal(eventOf(send(core, P1, { t: 'post', draw: other, event })).srv, undefined);
  assert.equal(eventOf(send(core, P1, { t: 'post', event: { kind: 'note', label: '備註' } })).srv, undefined);
  for (const bad of [{ kind: 'check', label: 'x' }, { kind: 'divider', label: 'x' }, { kind: 'note' }, { kind: 'note', label: '   ' }, null, 'x']) {
    assert.equal(errorOf(send(core, P1, { t: 'post', event: bad }))?.code, 'bad_event', JSON.stringify(bad));
  }
});

test('draw 過期後不能再用', () => {
  const r = room({ rng: seqRng([2]) });
  const draw = send(r.core, P1, { t: 'draw', pools: [[4, 1]] }).out[0].msg.draw;
  r.advance(61_000);
  assert.equal(eventOf(send(r.core, P1, { t: 'post', draw, event: { kind: 'note', label: 'x' } })).srv, undefined);
});

test('紀錄只留最近 200 筆，新的在前；重新建立房間物件（模擬重新部署／休眠）後仍在', () => {
  const r = room({ rng: seqRng([1]) });
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) send(r.core, P1, { t: 'post', event: { kind: 'note', label: `n${i}` } });
  const h = r.core.history();
  assert.equal(h.length, HISTORY_LIMIT);
  assert.equal(h[0].label, `n${HISTORY_LIMIT + 24}`);
  assert.equal(h.at(-1).label, 'n25');
  const again = new RoomCore({ db: r.db, env, rng: seqRng([1]) }); // 同一份資料庫，新的物件
  again.migrate();
  assert.equal(again.history().length, HISTORY_LIMIT);
  assert.equal(again.history()[0].label, `n${HISTORY_LIMIT + 24}`);
});

test('限流：每人每秒超過上限的訊息被丟棄；嚴重超量直接斷線；一秒後恢復；各人分開計算', () => {
  const r = room({ autoAdvance: false, rng: seqRng([1]) });
  const note = { t: 'post', event: { kind: 'note', label: 'x' } };
  let ok = 0;
  for (let i = 0; i < RATE_LIMIT_PER_SEC; i++) if (eventOf(send(r.core, P1, note))) ok++;
  assert.equal(ok, RATE_LIMIT_PER_SEC);
  assert.equal(errorOf(send(r.core, P1, note))?.code, 'rate_limited');
  assert.ok(eventOf(send(r.core, P2, note))); // 另一個人不受影響
  r.advance(1001);
  assert.ok(eventOf(send(r.core, P1, note)));
  r.advance(1001);
  let last;
  for (let i = 0; i <= RATE_ABUSE_PER_SEC; i++) last = send(r.core, P1, note);
  assert.deepEqual(last.close, { code: 4429, reason: 'rate limit' });
  assert.equal(r.core.history().length, RATE_LIMIT_PER_SEC + 1 + 1 + RATE_LIMIT_PER_SEC); // 被丟棄的訊息不會寫入紀錄
});

test('每則訊息都重新確認白名單：被移出名單、名單被清空、session 過期都會被踢', () => {
  const r = room({ rng: seqRng([1]) });
  const note = { t: 'post', event: { kind: 'note', label: 'x' } };
  assert.ok(eventOf(send(r.core, P1, note)));
  r.core.env = { ...env, DISCORD_ALLOWED_IDS: '100,200,400' }; // 玩家一被移出
  assert.deepEqual(send(r.core, P1, note).close, { code: 4403, reason: 'not allowed' });
  assert.ok(eventOf(send(r.core, P2, note)));
  r.core.env = { ...env, DISCORD_ALLOWED_IDS: '' }; // 清空 = 全部拒絕
  assert.equal(send(r.core, P2, note).close.code, 4403);
  assert.equal(send(r.core, GM, note).close.code, 4403);
  r.core.env = env;
  const expiring = { ...P1, exp: r.clock() + 1000 };
  assert.ok(eventOf(send(r.core, expiring, note)));
  r.advance(2000);
  assert.deepEqual(send(r.core, expiring, note).close, { code: 4401, reason: 'session expired' });
});

test('GM 權限：只有 GM 能開新戰鬥；分隔訊息有場次編號與時間，重新部署後編號延續', () => {
  const r = room();
  const denied = send(r.core, P1, { t: 'newBattle', rid: 'n1' });
  assert.equal(errorOf(denied).code, 'forbidden');
  assert.equal(errorOf(send(r.core, ADMIN, { t: 'newBattle' })).code, 'forbidden'); // 開發者在沒有暫代前不是 GM
  assert.equal(r.core.history().length, 0);

  const first = eventOf(send(r.core, GM, { t: 'newBattle' }));
  assert.equal(first.kind, 'divider');
  assert.equal(first.label, '第 1 場戰鬥');
  assert.equal(first.battleNo, 1);
  assert.ok(first.t > 0);
  assert.match(first.lines[0], /GM/);
  const again = new RoomCore({ db: r.db, env, rng: seqRng([1]) });
  again.migrate();
  assert.equal(again.battleNo(), 1);
  assert.equal(eventOf(again.handle(GM, JSON.stringify({ t: 'newBattle' }))).label, '第 2 場戰鬥');
});

test('GM 切換：開發者可暫代 GM、再還回；暫代期間原 GM 沒有權限；設定重新部署後仍在', () => {
  const r = room();
  assert.equal(errorOf(send(r.core, P1, { t: 'gm', action: 'take' })).code, 'forbidden'); // 一般玩家不行
  assert.equal(errorOf(send(r.core, GM, { t: 'gm', action: 'take' })).code, 'forbidden'); // GM 本人也不能「接管」
  assert.equal(errorOf(send(r.core, ADMIN, { t: 'gm', action: 'bad' })).code, 'bad_gm');

  r.core.join(ADMIN);
  const took = send(r.core, ADMIN, { t: 'gm', action: 'take' });
  assert.deepEqual(took.out.find((o) => o.msg.t === 'gm').msg.gm.uids, ['200']);
  assert.match(eventOf(took).label, /暫代 GM/); // 紀錄裡留下稽核訊息，所有人都看得到
  assert.equal(r.core.isGm('200'), true);
  assert.equal(r.core.isGm('100'), false);
  assert.equal(errorOf(send(r.core, GM, { t: 'newBattle' })).code, 'forbidden');
  assert.ok(eventOf(send(r.core, ADMIN, { t: 'newBattle' })));

  const again = new RoomCore({ db: r.db, env, rng: seqRng([1]) });
  again.migrate();
  assert.equal(again.isGm('200'), true);

  assert.equal(errorOf(send(r.core, P1, { t: 'gm', action: 'release' })).code, 'forbidden');
  const back = send(r.core, ADMIN, { t: 'gm', action: 'release' });
  assert.deepEqual(back.out.find((o) => o.msg.t === 'gm').msg.gm.uids, ['100']);
  assert.equal(r.core.isGm('100'), true);
  assert.equal(r.core.isGm('200'), false);
});

test('暫代 GM 的人若被移出白名單，自動回到原 GM；ADMIN 沒設定時沒有人能暫代', () => {
  const r = room();
  send(r.core, ADMIN, { t: 'gm', action: 'take' });
  r.core.env = { ...env, DISCORD_ALLOWED_IDS: '100,300,400' };
  assert.equal(r.core.isGm('200'), false);
  assert.equal(r.core.isGm('100'), true);
  const none = room({ env: { ...env, ADMIN_DISCORD_IDS: '' } });
  assert.equal(errorOf(send(none.core, ADMIN, { t: 'gm', action: 'take' })).code, 'forbidden');
  const noGm = room({ env: { ...env, GM_DISCORD_IDS: '' } });
  assert.equal(errorOf(send(noGm.core, GM, { t: 'newBattle' })).code, 'forbidden'); // GM 預設留空 = 沒有 GM
});

test('「系統」這個名稱保留給伺服器，前端不能冒用；空名稱改用 Discord 名稱', () => {
  const { core } = room();
  assert.equal(eventOf(send(core, P1, { t: 'post', event: { kind: 'note', label: 'x', who: '系統' } })).who, '玩家一');
  assert.equal(eventOf(send(core, P1, { t: 'dice', who: '系統', expr: '1D6' })).who, '玩家一');
  assert.equal(eventOf(send(core, P1, { t: 'post', event: { kind: 'note', label: 'x', who: '   ' } })).who, '玩家一');
  assert.equal(eventOf(send(core, P1, { t: 'post', event: { kind: 'note', label: 'x', who: '福德' } })).who, '福德');
});
