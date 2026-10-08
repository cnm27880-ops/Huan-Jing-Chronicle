// ============================================================
// GM 新增的專屬技能的本機快取：房間送來後存一份，下次開網站（還沒連上房間、或離線）就先用它。
// 為什麼要快取：角色載入時會把生命與資源夾在「最大值」以內，如果這時候目錄還沒有 GM 新增的技能
// （例如提供生命上限的專屬技能），最大值會算低、玩家的生命被悄悄砍掉並存檔。所以載入角色之前要先放進目錄。
// ============================================================
const KEY = 'huanjing:customSkills:v1';

export function loadCachedCustomSkills() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

export function saveCachedCustomSkills(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data ?? {})); } catch { /* 存不了就算了，下次連線再拿 */ }
}
