// 執行方式：npm test
// 前端接線（src/state/rollLog.js）整合測試：用假的 WebSocket 直接接上真正的房間邏輯（worker/src/room-core.js），
// 兩個「瀏覽器」是同一個模組載入兩次（URL 加不同的 ?參數 = 各自獨立的狀態）。
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../worker/src/room-core.js';
import { makeDb, seqRng } from '../worker/test/helpers.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { POTIONS } from '../src/game/rules.js';

// ---------- 瀏覽器環境的替身 ----------
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
globalThis.location = { href: 'https://huan-jing.yuci8660.uk/' };
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); // 重連、逾時、心跳的計時器由測試手動快轉

const GM = { uid: '100', name: 'GM', avatar: null };
const ADMIN = { uid: '200', name: '開發者', avatar: null };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const baseEnv = { DISCORD_ALLOWED_IDS: '100,200,300', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '200' };

// ---------- 假的伺服器：WebSocket 一端接到 RoomCore ----------
const hub = { core: null, sockets: new Set(), access: 'ok', failNextDraw: false, noPong: false };

function resetHub(env = baseEnv) {
  hub.core = new RoomCore({ db: makeDb(), env, rng: seqRng([5]) });
  hub.core.migrate();
  hub.sockets.clear();
  hub.access = 'ok';
  hub.failNextDraw = false;
  hub.noPong = false;
}
const online = () => [...new Set([...hub.sockets].map((w) => w.user.uid))];
const deliver = (ws, obj) => queueMicrotask(() => { if (ws.readyState === 1) ws.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); });
const toAll = (obj) => hub.sockets.forEach((w) => deliver(w, obj));

class FakeWS {
  static OPEN = 1;
  constructor(url) {
    this.url = url; this.readyState = 0; this.user = globalThis.__user;
    queueMicrotask(() => {
      if (hub.core.accessState(this.user.uid) !== 'ok') { this.readyState = 3; this.onclose({ code: 1006 }); return; }
      this.readyState = 1;
      hub.sockets.add(this);
      this.onopen();
      hub.core.join(this.user);
      deliver(this, hub.core.hello(this.user, online()));
      toAll({ t: 'presence', members: hub.core.membersView(online()) });
    });
  }
  send(data) {
    if (data === 'ping') return hub.noPong ? undefined : deliver(this, 'pong');
    if (hub.failNextDraw && JSON.parse(data).t === 'draw') {
      hub.failNextDraw = false;
      return deliver(this, { t: 'error', rid: JSON.parse(data).rid, code: 'boom', message: '伺服器壞掉了' });
    }
    const res = hub.core.handle(this.user, data, { online: online() });
    for (const o of res.out) o.to === 'self' ? deliver(this, o.msg) : toAll(o.msg);
    if (res.close) this.kick(res.close.code);
  }
  kick(code) { // 伺服器端關閉
    if (this.readyState === 3) return;
    this.readyState = 3; hub.sockets.delete(this);
    queueMicrotask(() => this.onclose({ code }));
  }
  close() { this.readyState = 3; hub.sockets.delete(this); }
}
globalThis.WebSocket = FakeWS;
globalThis.fetch = async () => Response.json(hub.access === 'ok' ? { state: 'ok', user: globalThis.__user } : { state: hub.access });

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
let n = 0;
async function browser(user) {
  globalThis.__user = user;
  const m = await import(`../src/state/rollLog.js?b${++n}`);
  await m.startRoom();
  await flush();
  return m;
}
const stopAll = (...ms) => ms.forEach((m) => m.stopRoom());
const character = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));

test('兩個瀏覽器自動進同一個房間；一方擲骰另一方即時看到，骰點由伺服器擲', async () => {
  resetHub();
  const a = await browser(GM);
  const b = await browser(P1);
  assert.equal(a.getRoomStatus().phase, 'online');
  assert.equal(b.getRoomStatus().phase, 'online');
  assert.equal(b.getRoomStatus().me.isGm, false);
  assert.equal(a.getRoomStatus().me.isGm, true);
  assert.equal(a.getRoomStatus().members.filter((m) => m.online).length, 2);

  let seen = null;
  b.subscribe((ev) => { if (ev) seen = ev; });
  const ev = await a.rollDice('福德', { count: 2, sides: 6, mod: 3, text: '2D6+3' });
  await flush();
  assert.equal(ev.big, 5 + 5 + 3); // 假伺服器的 rng 固定擲 5
  assert.equal(seen?.id, ev.id);
  assert.equal(b.getLog()[0].label, '2D6+3');
  assert.equal(b.getLog()[0].byName, 'GM');
  assert.equal(b.getLog()[0].srv, true);
  assert.equal(a.getLog()[0].id, ev.id); // 自己也是從廣播收到，只有一筆
  assert.equal(a.getLog().filter((e) => e.id === ev.id).length, 1);
  stopAll(a, b);
});

test('伺服器擲技能檢定：加值由前端算、d20 由伺服器擲', async () => {
  resetHub();
  const a = await browser(P1);
  const r = await a.rollCheck('福德', character(), '釣魚');
  assert.equal(r.roll, 5);
  assert.equal(r.total, 5 + r.mod);
  assert.equal(r.skill, '釣魚');
  assert.ok(r.parts.length >= 2); // 技能值 + 熟練
  assert.equal(a.getLog()[0].label, '釣魚檢定');
  assert.equal(a.getLog()[0].big, r.total);
  stopAll(a);
});

test('藥水回血：骰點由伺服器擲，角色狀態用同一個規則函式更新，事件標記為伺服器擲骰', async () => {
  resetHub();
  const a = await browser(P1);
  const b = await browser(GM);
  const { drinkPotion } = await import('../src/game/combat.js');
  const state = character();
  state.hp = 100;
  const { r, draw } = await a.rollWith(state, (st, rng) => drinkPotion(st, '回春湯', rng));
  assert.equal(r.rolled, 8 * 5); // 8D10，假伺服器每顆擲 5
  assert.equal(state.hp, 100 + 40);
  assert.equal(state.inventory.回春湯, SAMPLE_CHARACTER.inventory.回春湯 - 1);
  assert.ok(draw);
  a.publish({ who: '福德', kind: 'potion', label: '喝下回春湯', big: `+${r.healed}`, lines: [] }, { draw });
  await flush();
  assert.equal(b.getLog()[0].label, '喝下回春湯');
  assert.equal(b.getLog()[0].srv, true);
  assert.equal(b.getLog()[0].by, '300');
  stopAll(a, b);
  assert.ok(POTIONS.回春湯);
});

test('伺服器擲骰失敗：丟 RollError，角色狀態完全沒變', async () => {
  resetHub();
  const a = await browser(P1);
  const { drinkPotion } = await import('../src/game/combat.js');
  const state = character();
  state.hp = 100;
  const before = JSON.stringify(state);
  hub.failNextDraw = true;
  await assert.rejects(a.rollWith(state, (st, rng) => drinkPotion(st, '回春湯', rng)), (e) => e instanceof a.RollError && /伺服器壞掉了/.test(e.message));
  assert.equal(JSON.stringify(state), before);
  stopAll(a);
});

test('沒有骰子要擲的操作（例如背包沒有藥水）不用打擾伺服器，錯誤照常回傳', async () => {
  resetHub();
  const a = await browser(P1);
  const { drinkPotion } = await import('../src/game/combat.js');
  const state = character();
  state.inventory.回春湯 = 0;
  const { r, draw } = await a.rollWith(state, (st, rng) => drinkPotion(st, '回春湯', rng));
  assert.match(r.error, /沒有/);
  assert.equal(draw, null);
  stopAll(a);
});

test('重新整理頁面：歷史紀錄還在（新的頁面一加入就收到最近的紀錄）', async () => {
  resetHub();
  const a = await browser(P1);
  await a.rollDice('福德', { count: 1, sides: 20, mod: 0, text: '1D20' });
  await a.rollDice('福德', { count: 1, sides: 6, mod: 0, text: '1D6' });
  stopAll(a); // 關掉分頁
  const again = await browser(P1); // 重新整理
  assert.deepEqual(again.getLog().map((e) => e.label), ['1D6', '1D20']);
  stopAll(again);
});

test('未登入／API 連不上：維持本機模式，擲骰與狀態照常，紀錄存在本機', async () => {
  resetHub();
  hub.access = 'unauthenticated';
  const a = await browser(P1);
  assert.equal(a.getRoomStatus().phase, 'local');
  const ev = await a.rollDice('福德', { count: 1, sides: 20, mod: 0, text: '1D20' });
  assert.ok(ev.big >= 1 && ev.big <= 20);
  assert.equal(a.getLog()[0].id, ev.id);
  assert.equal(hub.core.history().length, 0); // 沒有送到房間
  const { drinkPotion } = await import('../src/game/combat.js');
  const state = character();
  state.hp = 100;
  const { r, draw } = await a.rollWith(state, (st, rng) => drinkPotion(st, '回春湯', rng));
  assert.equal(draw, null);
  assert.equal(state.hp, 100 + r.healed);

  // API 連不上
  globalThis.fetch = async () => { throw new TypeError('network'); };
  const b = await browser(P1);
  assert.equal(b.getRoomStatus().phase, 'local');
  globalThis.fetch = async () => Response.json(hub.access === 'ok' ? { state: 'ok', user: globalThis.__user } : { state: hub.access });
  stopAll(a, b);
});

test('被白名單拒絕：顯示明確原因並維持本機模式；白名單為空是另一個原因', async () => {
  resetHub();
  hub.access = 'not_allowed';
  const a = await browser(P1);
  assert.equal(a.getRoomStatus().phase, 'denied');
  assert.match(a.getRoomStatus().message, /不在這個房間的白名單/);
  hub.access = 'whitelist_empty';
  const b = await browser(P1);
  assert.match(b.getRoomStatus().message, /尚未設定白名單/);
  const ev = await b.rollDice('福德', { count: 1, sides: 6, mod: 0, text: '1D6' }); // 本機照樣能擲
  assert.equal(b.getLog()[0].id, ev.id);
  stopAll(a, b);
});

test('連線中斷：暫時用本機骰盤，自動重連後回到房間且歷史還在', async () => {
  resetHub();
  store.clear(); // 本機紀錄是另外存的，先清乾淨才看得出差別
  const a = await browser(P1);
  await a.rollDice('福德', { count: 1, sides: 6, mod: 0, text: '1D6' });
  const socket = [...hub.sockets][0];
  socket.kick(1006);
  await flush();
  assert.equal(a.getRoomStatus().phase, 'reconnecting');
  assert.equal(a.getLog().length, 0); // 本機紀錄（空的），不是房間的
  const local = await a.rollDice('福德', { count: 1, sides: 20, mod: 0, text: '1D20' }); // 斷線時仍可擲（本機）
  assert.equal(hub.core.history().length, 1); // 沒有送到房間
  mock.timers.tick(31_000); // 快轉到重連
  await flush();
  assert.equal(a.getRoomStatus().phase, 'online');
  assert.deepEqual(a.getLog().map((e) => e.label), ['1D6']);
  assert.ok(local.id);
  stopAll(a);
});

test('心跳沒回應（網路已死、瀏覽器遲遲不觸發 onclose）：不等關閉握手，直接轉為重連', async () => {
  resetHub();
  const a = await browser(P1);
  assert.equal(a.getRoomStatus().phase, 'online');
  hub.noPong = true;
  mock.timers.tick(45_000); // 送出心跳
  mock.timers.tick(10_000); // 等不到 pong
  await flush();
  assert.equal(a.getRoomStatus().phase, 'reconnecting');
  hub.noPong = false;
  mock.timers.tick(31_000);
  await flush();
  assert.equal(a.getRoomStatus().phase, 'online');
  stopAll(a);
});

test('重連前發現已被移出白名單：不再重連，顯示原因', async () => {
  resetHub();
  const a = await browser(P1);
  [...hub.sockets][0].kick(1006);
  await flush();
  hub.access = 'not_allowed';
  mock.timers.tick(31_000);
  await flush();
  assert.equal(a.getRoomStatus().phase, 'denied');
  assert.equal(a.getRoomStatus().reason, 'not_allowed');
  stopAll(a);
});

test('房間中途被移出白名單：伺服器踢人，前端改回本機模式並說明', async () => {
  resetHub();
  const a = await browser(P1);
  hub.core.env = { ...baseEnv, DISCORD_ALLOWED_IDS: '100,200' };
  a.publish({ kind: 'note', label: 'x' }); // 下一則訊息就會被伺服器重新檢查白名單
  await flush();
  assert.equal(a.getRoomStatus().phase, 'denied');
  assert.equal(a.getRoomStatus().reason, 'not_allowed');
  stopAll(a);
});

test('GM：非 GM 按「新戰鬥」被拒；GM 按了所有人都看到分隔線', async () => {
  resetHub();
  const gm = await browser(GM);
  const p = await browser(P1);
  p.startNewBattle();
  await flush();
  assert.match(p.getRoomStatus().notice, /只有 GM/);
  assert.equal(gm.getLog().length, 0);
  gm.startNewBattle();
  await flush();
  assert.equal(p.getLog()[0].kind, 'divider');
  assert.equal(p.getLog()[0].label, '第 1 場戰鬥');
  assert.equal(p.getRoomStatus().battleNo, 1);
  stopAll(gm, p);
});

test('開發者暫代 GM：所有人的 GM 狀態同步更新，還回去後恢復', async () => {
  resetHub();
  const gm = await browser(GM);
  const admin = await browser(ADMIN);
  const p = await browser(P1);
  assert.equal(admin.getRoomStatus().me.isGm, false);
  p.setGmOverride('take');
  await flush();
  assert.match(p.getRoomStatus().notice, /沒有暫代 GM/);
  admin.setGmOverride('take');
  await flush();
  assert.equal(admin.getRoomStatus().me.isGm, true);
  assert.equal(gm.getRoomStatus().me.isGm, false);
  assert.equal(p.getRoomStatus().gm.override, '200');
  admin.setGmOverride('release');
  await flush();
  assert.equal(admin.getRoomStatus().me.isGm, false);
  assert.equal(gm.getRoomStatus().me.isGm, true);
  assert.equal(p.getRoomStatus().gm.override, null);
  stopAll(gm, admin, p);
});

test('登出（stopRoom）：關閉連線並回到本機模式', async () => {
  resetHub();
  const a = await browser(P1);
  a.stopRoom();
  assert.equal(a.getRoomStatus().phase, 'local');
  assert.equal(hub.sockets.size, 0);
});

// ---------- 角色存檔同步（階段 2）----------
test('角色同步：全新裝置登入，伺服器有存檔就直接採用，不問', async () => {
  resetHub(); store.clear();
  hub.core.onCharPut(P1, { base: 0, data: { name: '雲端角色', hp: 7 } });
  const m = await browser(P1);
  const { createCharSync } = await import('../src/state/charSync.js?t1');
  let adopted = null; let asked = 0;
  createCharSync({ getState: () => ({ name: '示範' }), adopt: (d) => { adopted = d; }, hasLocalSave: () => false, confirmFn: () => { asked++; return true; }, room: m });
  await flush();
  assert.equal(adopted?.name, '雲端角色');
  assert.equal(asked, 0);
  assert.equal(JSON.parse(store.get('huanjing:character:sync:v1')).version, 1);
  stopAll(m);
});

test('角色同步：伺服器沒有存檔就上傳本機的；之後修改會在 1.5 秒後上傳新版本', async () => {
  resetHub(); store.clear();
  const m = await browser(P1);
  const { createCharSync } = await import('../src/state/charSync.js?t2');
  const state = { name: '本機角色', hp: 3 };
  const sync = createCharSync({ getState: () => state, adopt: () => assert.fail('不該採用伺服器'), hasLocalSave: () => true, room: m });
  await flush();
  assert.equal(hub.core.charRow('300').version, 1);
  state.hp = 2; sync.markDirty(); sync.markDirty();
  mock.timers.tick(1000); await flush();
  assert.equal(hub.core.charRow('300').version, 1); // 防抖：還沒到 1.5 秒
  mock.timers.tick(600); await flush();
  assert.equal(hub.core.charRow('300').version, 2);
  assert.equal(JSON.parse(hub.core.charRow('300').json).hp, 2);
  assert.equal(JSON.parse(store.get('huanjing:character:sync:v1')).dirty, false);
  stopAll(m);
});

test('角色同步：兩邊都有不同存檔時問玩家；選伺服器就採用，選本機就覆蓋伺服器', async () => {
  for (const [choice, expectAdopt, expectHp] of [[true, true, 7], [false, false, 3]]) {
    resetHub(); store.clear();
    hub.core.onCharPut(P1, { base: 0, data: { name: '雲端角色', hp: 7 } });
    const m = await browser(P1);
    const { createCharSync } = await import(`../src/state/charSync.js?t3${choice}`);
    let adopted = null; let question = '';
    createCharSync({ getState: () => ({ name: '本機角色', hp: 3 }), adopt: (d) => { adopted = d; }, hasLocalSave: () => true, confirmFn: (q) => { question = q; return choice; }, room: m });
    await flush();
    assert.match(question, /第 1 版/);
    assert.equal(Boolean(adopted), expectAdopt);
    assert.equal(JSON.parse(hub.core.charRow('300').json).hp, expectHp);
    stopAll(m);
  }
});

test('角色同步：另一台裝置先存了（本機版本過舊且有修改）→ 不會悄悄覆蓋，會詢問', async () => {
  resetHub(); store.clear();
  hub.core.onCharPut(P1, { base: 0, data: { name: '角色', hp: 1 } });
  hub.core.onCharPut(P1, { base: 1, data: { name: '角色', hp: 2 } }); // 手機存到第 2 版
  store.set('huanjing:character:sync:v1', JSON.stringify({ uid: '300', version: 1, dirty: true })); // 電腦停在第 1 版且有改動
  const m = await browser(P1);
  const { createCharSync } = await import('../src/state/charSync.js?t4');
  let asked = 0;
  createCharSync({ getState: () => ({ name: '角色', hp: 99 }), adopt: () => {}, hasLocalSave: () => true, confirmFn: () => { asked++; return true; }, room: m });
  await flush();
  assert.equal(asked, 1);
  assert.equal(JSON.parse(hub.core.charRow('300').json).hp, 2); // 伺服器的沒被蓋掉
  stopAll(m);
});

test('角色同步：GM 可以列出並讀取玩家角色，玩家不行', async () => {
  resetHub(); store.clear();
  hub.core.onCharPut(P1, { base: 0, data: { name: '玩家角色', hp: 5 } });
  const gm = await browser(GM);
  const p = await browser(P1);
  const sync = await import('../src/state/charSync.js?t5');
  assert.equal(typeof sync.listCharacters, 'function'); // 預設綁 rollLog.js，這裡改直接用房間請求驗證權限
  const list = await gm.roomRequest({ t: 'charList' });
  assert.equal(list.list[0].charName, '玩家角色');
  assert.equal((await gm.roomRequest({ t: 'charGet', uid: '300' })).data.hp, 5);
  await assert.rejects(p.roomRequest({ t: 'charList' }), /GM/);
  stopAll(gm, p);
});
