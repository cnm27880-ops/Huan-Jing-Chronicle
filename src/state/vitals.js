// ============================================================
// 隊友狀態：把自己的生命、資源、毒性、護盾回報給房間，跑團頁就能看到隊友的血量。
// 每次存檔後 0.6 秒（防抖）比對，有變才送；剛連上房間時送一次。沒連上房間就不送。
// 伺服器端見 worker/src/room-core.js 的 onVitals。
// ============================================================
import { sendVitals, getRoomStatus, subscribeRoom } from './rollLog.js';
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
  const v = { name: String(state.name ?? '').slice(0, 40), hp: int(state.hp), maxHp: int(maxHp(state)), downed: isDowned(state), res };
  if (typeof state.toxicity === 'number') v.tox = int(state.toxicity);
  if (state.shield?.hp > 0) v.shield = int(state.shield.hp);
  return v;
}

/** skip()：這時候不要回報（例如還在等 GM 匯入，本機只是示範角色） */
export function createVitalsReporter({ getState, skip = () => false }) {
  let last = '';
  let timer = null;
  const online = () => getRoomStatus().phase === 'online';
  let wasOnline = online();
  const flush = () => {
    if (!online() || skip()) return;
    const v = vitalsOf(getState());
    const sig = JSON.stringify(v);
    if (sig === last) return;
    last = sig;
    sendVitals(v);
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
