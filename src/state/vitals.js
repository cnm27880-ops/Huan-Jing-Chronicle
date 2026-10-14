// ============================================================
// 隊友狀態：把自己的生命、資源、毒性、護盾回報給房間，跑團頁就能看到隊友的血量。
// 每次存檔後 0.6 秒（防抖）比對，有變才送；剛連上房間時送一次。沒連上房間就不送。
// 伺服器端見 worker/src/room-core.js 的 onVitals。
// ============================================================
import * as defaultRoom from './rollLog.js';
import { maxHp } from '../game/stats.js';
import { OTHER_RESOURCES, resourceNow, resourceMax } from '../game/resources.js';
import { isDowned } from '../game/combat.js';

const DEBOUNCE_MS = 600;
const int = (v) => Math.max(0, Math.floor(Number(v)) || 0);

/** 角色 → 要回報的狀態（只放數字；資源上限是 0 的不送） */
export function vitalsOf(state) {
  const res = {};
  for (const r of OTHER_RESOURCES) {
    const max = int(resourceMax(state, r));
    if (max > 0) res[r] = [int(resourceNow(state, r)), max];
  }
  const v = { name: String(state.name ?? '').slice(0, 40), hp: Math.floor(Number(state.hp)) || 0, // 生命可以是負數（倒扣）
    maxHp: int(maxHp(state)), downed: isDowned(state), res };
  if (typeof state.toxicity === 'number') v.tox = int(state.toxicity);
  if (state.shield?.hp > 0) v.shield = int(state.shield.hp);
  return v;
}

/**
 * skip()：這時候不要回報（例如還在等 GM 匯入，本機只是示範角色）。
 * ready()：回傳 Promise，等它完成才回報（main.js 傳 sync.idle：連上房間後要先等角色比對完，不然會把放了很久的舊血量當成最新的）。
 * room：房間介面（預設是 rollLog.js；測試時換成另一份模組實例）。
 * 每則回報帶 seq（Date.now()，同一毫秒內也保證遞增）：伺服器遇到比已存的舊就忽略，兩台裝置不會互蓋。
 */
export function createVitalsReporter({ getState, skip = () => false, ready = () => Promise.resolve(), room = defaultRoom }) {
  const { sendVitals, getRoomStatus, subscribeRoom } = room;
  let last = '';
  let timer = null;
  let seq = 0;
  const online = () => getRoomStatus().phase === 'online';
  let wasOnline = online();
  const flush = async () => {
    if (!online() || skip()) return;
    try { await ready(); } catch { /* 比對失敗也照送，總比一直不回報好 */ }
    if (!online() || skip()) return; // 等待期間可能斷線了，或比對後發現還在等 GM 匯入
    const v = vitalsOf(getState()); // 等完之後才取，拿到的是比對後（可能已換成伺服器版）的角色
    const sig = JSON.stringify(v);
    if (sig === last) return;
    last = sig;
    seq = Math.max(Date.now(), seq + 1);
    sendVitals({ ...v, seq });
  };
  const changed = () => { clearTimeout(timer); timer = setTimeout(flush, DEBOUNCE_MS); };
  subscribeRoom(() => {
    const now = online();
    if (now && !wasOnline) { last = ''; changed(); } // 剛連上（或重新連上）：送一次最新的
    wasOnline = now;
  });
  if (wasOnline) changed();
  return { changed };
}
