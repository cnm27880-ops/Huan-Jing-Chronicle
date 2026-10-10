// ============================================================
// 玩家日誌的回報點：修整、學習、物品的動作都經過這裡。
// 已加入房間：送給伺服器（所有玩家都看得到）；沒加入房間（單機試玩）：只存在這個瀏覽器，日誌頁只看得到自己的。
// 日誌只是紀錄，送失敗不影響遊戲。
// ============================================================
import { sendActivity, getRoomStatus } from './rollLog.js';
import { cleanActivity } from '../game/activity.js';

const KEY = 'huanjing:activity:v1';
const LOCAL_MAX = 300;

function readLocal() {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** 單機試玩的日誌（最新的在前）；格式和伺服器回的一樣 */
export const localActivities = () => readLocal();

/**
 * 記一筆：raw = { cat: 'rest'|'learn'|'item', text, lines? }；state 用來取角色名稱
 * 格式不對就略過（不丟錯）。
 */
export function logActivity(state, raw) {
  const clean = cleanActivity(raw);
  if (!clean) return;
  const who = String(state?.name ?? '').slice(0, 40);
  if (getRoomStatus().phase === 'online' && sendActivity({ ...clean, who })) return;
  try {
    const entry = { id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), uid: 'local', name: who, who, ...clean };
    localStorage.setItem(KEY, JSON.stringify([entry, ...readLocal()].slice(0, LOCAL_MAX)));
  } catch { /* 存不進去就算了 */ }
}
