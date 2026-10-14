// ============================================================
// 彈窗堆疊：全站只有一個 Esc 監聽器，Esc 一次只關畫面上最上面的那一層。
//   const layer = pushLayer({ tier: 'sheet', close, modal: true, dismissible: true, node });
//   layer.remove();   // 彈窗關閉時呼叫
// - tier 決定層級（順序見 TIERS，要和 tokens.css 的 --z-* 一致），同一層級內先開的在下面。
//   層級同時就是 CSS 的 z-index，所以 Esc 對應的永遠是看得到的最上層。
// - modal: true 的彈窗開著時，背景（#main、頂部列，以及被蓋住的其他彈窗 node）設成 inert（不能點、不能 Tab），
//   <html> 加 data-modal="open"；最後一個 modal 關閉才解除。不鎖 body 捲動（body 本來就是 overflow: hidden）。
// - dismissible: false（戰鬥提醒）：Esc 只吞掉、不關。
// - 輸入法組字中、或封面還在時，不處理 Esc（交給輸入法／封面自己）。
// 判斷邏輯是純函式（insertIndex、decideEscape、inertPlan），可以直接測試；下面的 DOM 部分很薄。
// ============================================================

/** 由下到上；要和 src/styles/tokens.css 的 --z-drawer … --z-confirm 順序一致 */
export const TIERS = ['drawer', 'sheet', 'popover', 'reveal', 'nudge', 'confirm'];
const rank = (tier) => {
  const r = TIERS.indexOf(tier);
  if (r < 0) throw new Error(`未知的彈窗層級：${tier}`);
  return r;
};

/** 新的一層要插在哪個位置：同層級或更低的後面（同層級先開的在下） */
export function insertIndex(layers, tier) {
  const r = rank(tier);
  let i = layers.length;
  while (i > 0 && rank(layers[i - 1].tier) > r) i--;
  return i;
}

/** 按下 Esc：要不要吞掉事件、要關哪一層 → { consume, close } */
export function decideEscape(layers, { composing = false, coverActive = false } = {}) {
  if (!layers.length || composing || coverActive) return { consume: false, close: null };
  const top = layers[layers.length - 1];
  return { consume: true, close: top.dismissible === false ? null : top };
}

/** 背景鎖定計畫：page＝#main 與頂部列要不要 inert；inertIdx＝哪幾層（被最上面的 modal 蓋住的）要 inert */
export function inertPlan(layers) {
  let topModal = -1;
  layers.forEach((l, i) => { if (l.modal) topModal = i; });
  return { page: topModal >= 0, inertIdx: layers.map((_, i) => i).filter((i) => i < topModal) };
}

// ---------- DOM 部分 ----------
const layers = [];
let listening = false;

const coverActive = () => {
  const cover = typeof document === 'undefined' ? null : document.getElementById('cover');
  return Boolean(cover) && !cover.classList.contains('is-leaving');
};

function sync() {
  const plan = inertPlan(layers);
  layers.forEach((l, i) => { if (l.node) l.node.inert = plan.inertIdx.includes(i); });
  const html = document.documentElement;
  if (plan.page) html.dataset.modal = 'open'; else delete html.dataset.modal;
  if (coverActive()) return; // 封面還在：背景的 inert 由 cover.js 管，不去動
  document.querySelectorAll('#main, .topbar').forEach((el) => { el.inert = plan.page; });
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  const d = decideEscape(layers, { composing: e.isComposing || e.keyCode === 229, coverActive: coverActive() });
  if (!d.consume) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // 底下的視窗與頁面的其他 Esc 處理都收不到
  if (!d.close) return;
  d.close.close?.();
  if (layers.includes(d.close)) remove(d.close); // close 沒自己移除的話，保險起見由這裡移除
}

function remove(layer) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  layer.node && (layer.node.inert = false);
  sync();
}

/** 註冊一層彈窗；回傳 { remove }。close：按 Esc 時要執行的關閉函式（要記得在裡面呼叫 remove，沒呼叫也會被補移除） */
export function pushLayer({ tier, close = null, modal = true, dismissible = true, node = null }) {
  const layer = { tier, close, modal, dismissible, node };
  layers.splice(insertIndex(layers, tier), 0, layer);
  if (!listening) { listening = true; document.addEventListener('keydown', onKey, true); }
  sync();
  return { remove: () => remove(layer) };
}
