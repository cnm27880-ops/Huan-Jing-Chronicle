// ============================================================
// 擲骰紀錄：所有「大家都該看到」的結果（檢定、自訂骰、鑑定、出招、喝藥水）都從這裡發布。
// 這是畫面和「房間」之間唯一的接線點：
//   - 已登入、在白名單內、連上房間（WebSocket）→ 擲骰由伺服器擲、紀錄是房間共用的（保存最近 200 筆）
//   - 未登入、不在白名單、連線失敗或中斷 → 本機模式：和以前一樣，只存在這台裝置
//   連不上時網站照常運作，不會壞掉。
//
// 事件格式（伺服器也用同一份）：
//   { id, t, who, kind, label, big, tone, lines }
//   kind：check 檢定｜dice 自訂骰｜identify 鑑定｜attack 出招｜defend 承受攻擊｜potion 藥水｜skill 輔助技能｜note 備註｜divider 新戰鬥分隔線
//   big：醒目的大數字或短文字；tone：'ok' | 'fail' | 'crit' | 'warn' | undefined；lines：說明文字陣列
//
// 信任邊界（階段 1-B）：骰子的數量與加值仍由前端算出再送上去，伺服器只負責「擲」與「記錄」；
// 角色資料在伺服器是階段 2。所以改過的前端可以謊報加值，但無法影響骰點本身。
// ============================================================
import { rollExpr } from '../game/dice.js';
import { sessionCheck } from '../game/engine.js';
import { checkEvent, diceEvent } from '../game/events.js';
import { getRoomAccess, roomWsUrl, DEFAULT_ROOM_ID } from '../api/auth.js';
import { createRoomClient } from './roomClient.js';
import { planDice, applyDice, TapeError } from './diceTape.js';

const KEY = 'huanjing:rolllog:v1';
const MAX = 100;
const subs = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(raw)) return raw.slice(0, MAX);
  } catch {
    /* 讀不到就從空的開始 */
  }
  return [];
}
let log = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* 儲存失敗不中斷遊戲 */
  }
}

function publishLocal(ev) {
  const e = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    t: Date.now(),
    lines: [],
    ...ev,
  };
  log.unshift(e);
  if (log.length > MAX) log.length = MAX;
  persist();
  subs.forEach((fn) => fn(e));
  return e;
}



/** 有新事件時呼叫 fn(event)；回傳取消訂閱的函式 */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function clearLog() {
  if (isOnline()) return; // 房間的紀錄是大家共用的，不能從這裡清掉
  log = [];
  persist();
  subs.forEach((fn) => fn(null));
}

// ============================================================
// 房間（階段 1-B）
// ============================================================
const MAX_ROOM_LOG = 200;
const REQUEST_TIMEOUT_MS = 6000;
const DENIED_TEXT = {
  whitelist_empty: '房間尚未設定白名單，目前無法加入，已使用本機模式。',
  not_allowed: '你的 Discord 帳號不在這個房間的白名單內，已使用本機模式。請聯絡 GM。',
  replaced: '你在其他分頁開太多連線，這個分頁已改用本機模式。重新整理即可再加入。',
  expired: '登入已過期，已改用本機模式。請重新登入。',
};

export class RollError extends Error {}

const room = {
  phase: 'local', // local 本機｜connecting 連線中｜online 已加入｜reconnecting 重新連線中｜denied 被拒絕
  reason: null,
  message: '',
  roomId: DEFAULT_ROOM_ID,
  me: null, // { uid, name, avatarUrl, isGm, isAdmin }
  gm: { uids: [], override: null, names: {} },
  members: [],
  battleNo: 0,
  notice: '', // 伺服器回的錯誤（例如不是 GM 還按新戰鬥）
};
let roomLog = [];
let client = null;
let startToken = 0;
const roomSubs = new Set();
const pending = new Map();
let ridCounter = 0;

const isOnline = () => room.phase === 'online';

function setNotice(message) {
  room.notice = message;
  notifyRoom();
  setTimeout(() => { if (room.notice === message) { room.notice = ''; notifyRoom(); } }, 6000);
}
const notifyRoom = () => roomSubs.forEach((fn) => fn(room));

export const getRoomStatus = () => room;
export function subscribeRoom(fn) {
  roomSubs.add(fn);
  return () => roomSubs.delete(fn);
}

/** 目前畫面要顯示的紀錄（新的在前）：在房間裡是房間的，否則是本機的 */
export const getLog = () => (isOnline() ? roomLog : log);

function setPhase(phase, extra = {}) {
  const wasOnline = isOnline();
  Object.assign(room, { phase, reason: null, message: '' }, extra);
  if (wasOnline !== isOnline()) subs.forEach((fn) => fn(null)); // 切換本機／房間：重畫紀錄
  notifyRoom();
}

function failPending(message) {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new RollError(message)); }
  pending.clear();
}

function request(msg) {
  return new Promise((resolve, reject) => {
    if (!isOnline()) return reject(new RollError('尚未連上房間。'));
    const rid = `r${Date.now().toString(36)}${(++ridCounter).toString(36)}`;
    const timer = setTimeout(() => { pending.delete(rid); reject(new RollError('伺服器沒有回應，請再試一次。')); }, REQUEST_TIMEOUT_MS);
    pending.set(rid, { resolve, reject, timer });
    if (!client?.send({ ...msg, rid })) { clearTimeout(timer); pending.delete(rid); reject(new RollError('連線中斷，請再試一次。')); }
  });
}

/** 給 charSync 用：送一則要等回覆的房間訊息（沒連上房間會丟 RollError） */
export const roomRequest = request;

function addRoomEvent(ev) {
  if (roomLog.some((e) => e.id === ev.id)) return;
  roomLog.unshift(ev);
  if (roomLog.length > MAX_ROOM_LOG) roomLog.length = MAX_ROOM_LOG;
  if (ev.kind === 'divider' && ev.battleNo) { room.battleNo = ev.battleNo; notifyRoom(); }
  subs.forEach((fn) => fn(ev));
}

function onRoomMessage(msg) {
  switch (msg.t) {
    case 'hello':
      roomLog = Array.isArray(msg.history) ? msg.history.slice(0, MAX_ROOM_LOG) : [];
      setPhase('online', { me: msg.me, gm: msg.gm, members: msg.members ?? [], battleNo: msg.battleNo ?? 0, roomId: msg.room ?? room.roomId, notice: '' });
      break;
    case 'event':
      if (msg.event) addRoomEvent(msg.event);
      break;
    case 'presence':
      room.members = msg.members ?? room.members;
      notifyRoom();
      break;
    case 'gm':
      room.gm = msg.gm;
      if (room.me) room.me = { ...room.me, isGm: msg.gm.uids.includes(room.me.uid) };
      notifyRoom();
      break;
    case 'rolled': case 'drawn': case 'posted': case 'char': case 'charSaved': case 'charList': {
      const p = pending.get(msg.rid);
      if (p) { clearTimeout(p.timer); pending.delete(msg.rid); p.resolve(msg); }
      break;
    }
    case 'error': {
      const p = msg.rid && pending.get(msg.rid);
      if (p) { clearTimeout(p.timer); pending.delete(msg.rid); p.reject(new RollError(msg.message)); }
      else setNotice(msg.message ?? '發生錯誤。');
      break;
    }
    default: break;
  }
}

function deny(reason) {
  client?.close(); client = null;
  failPending('已離開房間。');
  setPhase('denied', { reason, message: DENIED_TEXT[reason] ?? '無法加入房間。', me: null, members: [] });
}

/** 已登入後呼叫：問 Worker 能不能進房間，可以就連 WebSocket；不行就維持本機模式並說明原因 */
export async function startRoom(roomId = DEFAULT_ROOM_ID) {
  stopRoom();
  const token = ++startToken;
  const access = await getRoomAccess(roomId);
  if (token !== startToken) return;
  if (access.state === 'whitelist_empty' || access.state === 'not_allowed') return deny(access.state);
  if (access.state !== 'ok') return; // 未登入、或 API 連不上：本機模式
  setPhase('connecting', { roomId });
  client = createRoomClient({
    url: roomWsUrl(roomId),
    onMessage: onRoomMessage,
    onStatus: (status, info) => {
      if (token !== startToken) return;
      if (status === 'connecting') { if (room.phase !== 'online') setPhase(room.phase === 'reconnecting' ? 'reconnecting' : 'connecting'); }
      else if (status === 'retrying') { failPending('連線中斷，請再試一次。'); setPhase('reconnecting'); }
      else if (status === 'fatal') {
        client = null;
        failPending('連線中斷。');
        const reason = info.code === 4403 ? 'not_allowed' : info.code === 4409 ? 'replaced' : info.code === 4401 ? 'expired' : null;
        if (reason) deny(reason);
        else if (room.phase !== 'denied' && room.phase !== 'local') setPhase('local', { me: null, members: [] }); // 已經被 beforeRetry 處理過的就不要蓋掉
      }
    },
    // 每次重連前先確認：登入還在不在、還在不在白名單（連不上 API 就繼續試）
    beforeRetry: async () => {
      if (token !== startToken) return false;
      const a = await getRoomAccess(roomId);
      if (a.state === 'ok' || a.state === 'offline') return true;
      if (a.state === 'unauthenticated') { setPhase('local', { me: null, members: [] }); return false; }
      deny(a.state);
      return false;
    },
  });
  client.connect();
}

/** 登出或離開時呼叫：關閉連線，回到本機模式 */
export function stopRoom() {
  startToken++;
  client?.close(); client = null;
  failPending('已離開房間。');
  roomLog = [];
  if (room.phase !== 'local') setPhase('local', { me: null, members: [], gm: { uids: [], override: null, names: {} }, battleNo: 0, notice: '' });
}

/**
 * 發布一個事件，回傳事件。
 * 房間模式：送給伺服器（它會加上 id、時間、發送者，廣播給所有人，大家包括自己都從廣播收到）。
 * opts.draw：這個事件的骰點是伺服器擲的（rollWith 回傳的編號），伺服器會標記。
 */
export function publish(ev, opts = {}) {
  if (isOnline() && client?.send({ t: 'post', draw: opts.draw ?? undefined, event: ev })) return { ...ev, t: Date.now(), lines: ev.lines ?? [] };
  return publishLocal(ev);
}

/** 自訂骰（骰盤）。房間模式由伺服器擲；本機模式照舊 */
export async function rollDice(who, expr) {
  if (!isOnline()) {
    const ev = diceEvent(who, rollExpr(expr));
    return publishLocal(ev);
  }
  return (await request({ t: 'dice', who, expr: expr.text })).event;
}

/** 技能檢定。回傳 { skill, roll, mod, parts, total, isLife }（和 sessionCheck 一樣），紀錄會自動發布 */
export async function rollCheck(who, state, skill) {
  if (!isOnline()) {
    const r = sessionCheck(state, skill);
    publishLocal(checkEvent(who, r));
    return r;
  }
  const base = sessionCheck(state, skill, () => 0); // 只取加值與明細；d20 由伺服器擲
  const res = await request({ t: 'check', who, skill, mod: base.mod, parts: base.parts });
  return { ...base, roll: res.roll, total: res.total };
}

let queue = Promise.resolve();
/**
 * 執行一個會擲骰又會改角色狀態的規則函式（出招、承受攻擊、喝藥水、鑑定）。
 * run(state, rng) 要把所有存取都經過傳進來的 state（例如 (st, rng) => playerAttack(st, st.encounter, ..., rng)）。
 * 本機模式：直接用 Math.random 執行。房間模式：向伺服器要骰點，再餵給同一個函式（見 diceTape.js）。
 * 回傳 { r: run 的回傳值, draw: 伺服器的骰點編號或 null }，拿 draw 去 publish(ev, { draw })。
 * 失敗丟 RollError（此時 state 完全沒有被改動）。
 */
export function rollWith(state, run) {
  const task = queue.then(() => doRollWith(state, run));
  queue = task.catch(() => {});
  return task;
}

async function doRollWith(state, run) {
  if (!isOnline()) return { r: run(state, Math.random), draw: null };
  const plan = planDice(state, run);
  if (plan.unsupported || plan.total === 0) return { r: run(state, Math.random), draw: null }; // 沒有骰子要擲（例如資源不足的錯誤）
  const res = await request({ t: 'draw', pools: plan.pools });
  try {
    return { r: applyDice(state, run, res.values, plan.pools), draw: res.draw };
  } catch (e) {
    if (e instanceof TapeError) throw new RollError('擲骰期間狀態變動了，請再試一次。');
    throw e;
  }
}

/** GM：在紀錄中插入「新戰鬥」分隔線（不改任何規則狀態） */
export function startNewBattle() {
  if (!isOnline() || !client?.send({ t: 'newBattle' })) setNotice('尚未連上房間。');
}

/** 開發者：暫代 GM（action = 'take'）或還給原 GM（'release'） */
export function setGmOverride(action) {
  if (!isOnline() || !client?.send({ t: 'gm', action })) setNotice('尚未連上房間。');
}
