// ============================================================
// 存檔問題的共用回報：localStorage 寫不進去（容量滿）或存檔讀壞時，不要靜靜吞掉，要讓玩家知道。
// 這個檔案不碰畫面：store.js／rollLog.js／activityLog.js／charSync.js 呼叫 reportStorageProblem()，
// main.js 用 onStorageProblem(toast) 接上提示。畫面接上前發生的問題會先存起來，接上時補發。
// ============================================================
const listeners = new Set();
const pending = [];
const lastShown = new Map(); // 同一種問題 30 秒內只提示一次，免得每次存檔都跳
const REPEAT_MS = 30_000;

/** 是不是「瀏覽器存檔空間滿了」（各瀏覽器名稱／代碼不同） */
export function isQuotaError(err) {
  if (!err) return false;
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
}

/** 白話提示文字：容量問題與其他問題分開講 */
export function storageMessage(err, what) {
  if (isQuotaError(err)) return `瀏覽器存檔空間滿了，${what}沒有存進去。請先備份角色，再清掉舊的擲骰紀錄或日誌。`;
  return `${what}存不進這台裝置（${err?.name || '未知錯誤'}）。請先備份角色，再重新整理；若一直發生請告訴 GM。`;
}

export function reportStorageProblem(err, what, now = Date.now()) {
  console.error(`[storage] ${what}`, err);
  const key = `${isQuotaError(err) ? 'quota' : 'other'}:${what}`;
  if (now - (lastShown.get(key) ?? -Infinity) < REPEAT_MS) return;
  lastShown.set(key, now);
  notify(storageMessage(err, what));
}

/** 直接發出一則文字提示（例如存檔讀壞） */
export function notify(text) {
  if (listeners.size === 0) { pending.push(text); return; }
  for (const fn of listeners) fn(text);
}

export function onStorageProblem(fn) {
  listeners.add(fn);
  while (pending.length) fn(pending.shift());
  return () => listeners.delete(fn);
}

/** 測試用：清掉狀態 */
export function _resetStorageIssue() {
  listeners.clear(); pending.length = 0; lastShown.clear();
}
