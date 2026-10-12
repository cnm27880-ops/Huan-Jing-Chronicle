// ============================================================
// 招式使用紀錄（純函式）：玩家每次出招／用輔助，就在角色資料的 moveUse 累計「招式名稱 → 次數」。
// 用途：GM 的模擬戰可以照每位玩家「實際常用的招式」模擬，而不是靠程式猜（使用者 2026-10-12：五個人裡通常只有一個人會用萬物歸一）。
// 紀錄跟著角色存檔同步到伺服器，GM 讀得到；網站上還沒有戰鬥過的玩家沒有紀錄，模擬會退回自動挑招。
// 記在 combat.js 的 playerAttack／useSupport 成功之後（所有戰鬥入口自動生效，畫面不用改）。
// ============================================================
export const MAX_MOVE_USE_NAMES = 60; // 一個角色最多記幾種招式名稱（防止資料無限長大）；滿了以後只累計已經有的

const isSupport = (m) => m?.kind === 'heal' || m?.kind === 'shield';

/** 記一次招式使用（名稱相同的累加）。回傳新的次數；名稱太多又是新名稱就不記，回傳 0 */
export function recordMoveUse(state, name) {
  if (typeof name !== 'string' || !name) return 0;
  if (!state.moveUse || typeof state.moveUse !== 'object') state.moveUse = {};
  if (!(name in state.moveUse) && Object.keys(state.moveUse).length >= MAX_MOVE_USE_NAMES) return 0;
  state.moveUse[name] = (Number(state.moveUse[name]) || 0) + 1;
  return state.moveUse[name];
}

/** 用過的招式清單 [{ name, count }]，次數多的在前（次數相同照名稱排，結果才固定） */
export function usageList(state) {
  return Object.entries(state.moveUse ?? {})
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

/** 這個角色有沒有任何招式使用紀錄 */
export const hasMoveUse = (state) => usageList(state).length > 0;

/**
 * 依使用紀錄排出的「出招優先順序」（模擬戰用）：只留還在招式清單裡的攻擊招式（輔助招式不算），次數多的在前。
 * 沒有紀錄、或紀錄的招式都已經不在清單裡，回傳空陣列（模擬會改用自動挑招）。
 */
export function usagePlan(state) {
  const attacks = new Set((state.moves ?? []).filter((m) => !isSupport(m)).map((m) => m.name));
  return usageList(state).map((x) => x.name).filter((n) => attacks.has(n));
}
