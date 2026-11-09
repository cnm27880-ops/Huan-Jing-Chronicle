// ============================================================
// 分頁列的方向鍵（M12）：在 role="tablist" 裡按 ← → 移動焦點到上／下一個分頁，Home／End 到頭尾。
// 只移動焦點（不自動切換內容）：按 Enter 或空白鍵才會切換，不會因為方向鍵一直重畫頁面而掉焦點。
// 全站只在 main.js 裝一次（掛在 document 上，之後動態建立的分頁列也會生效）。
// ============================================================

/** 純函式：按鍵 → 下一個要聚焦的索引（沒有對應就回 null；方向鍵會繞圈） */
export function nextTabIndex(key, index, count) {
  if (count < 1) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function installTabKeys(doc = document) {
  doc.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const tab = e.target?.closest?.('[role="tablist"] > *');
    const list = tab?.closest('[role="tablist"]');
    if (!tab || !list) return;
    const tabs = [...list.children].filter((el) => !el.disabled && el.tagName !== 'SPAN');
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    const next = nextTabIndex(e.key, i, tabs.length);
    if (next === null) return;
    e.preventDefault();
    tabs[next].focus();
  });
}
