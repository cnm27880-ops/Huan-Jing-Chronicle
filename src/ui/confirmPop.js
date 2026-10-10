// ============================================================
// 網頁自己的確認框（取代瀏覽器的 confirm()）：貼在觸發按鈕旁邊，滑鼠不用移到頁面頂端。
// 用法：if (!(await askConfirm(e.currentTarget, { title: '…', lines: ['…'] }))) return;
// 點旁邊、按 Esc、按「取消」都回傳 false；一次只會有一個。
// ============================================================
import { h } from './dom.js';

let current = null;

function close(result) {
  if (!current) return;
  const { node, resolve, anchor, off } = current;
  current = null;
  off();
  node.remove();
  resolve(result);
  if (anchor?.isConnected) anchor.focus?.({ preventScroll: true });
}

/** 把確認框放在按鈕上方（放不下就放下方），左右對齊按鈕中心並限制在畫面內 */
function place(node, anchor) {
  const gap = 8;
  const margin = 8;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = Math.min(340, vw - margin * 2);
  node.style.width = `${w}px`;
  const ph = node.offsetHeight;
  if (!anchor?.isConnected) { // 按鈕已經被重畫掉：放畫面中間
    node.style.left = `${(vw - w) / 2}px`; node.style.top = `${Math.max(margin, (vh - ph) / 2)}px`; node.dataset.side = 'center';
    return;
  }
  const r = anchor.getBoundingClientRect();
  const above = r.top - gap - ph >= margin;
  const top = above ? r.top - gap - ph : Math.min(vh - ph - margin, r.bottom + gap);
  const center = r.left + r.width / 2;
  const left = Math.max(margin, Math.min(vw - w - margin, center - w / 2));
  node.style.left = `${left}px`;
  node.style.top = `${Math.max(margin, top)}px`;
  node.style.setProperty('--arrow-x', `${Math.max(16, Math.min(w - 16, center - left))}px`); // 小箭頭指向按鈕
  node.dataset.side = above ? 'above' : 'below';
}

/**
 * 在 anchor（觸發的按鈕）旁邊問一次。opts: { title, lines（說明，每個一行）, okText, cancelText, danger（確定鈕改紅色、預設focus取消） }
 * 回傳 Promise<boolean>。
 */
export function askConfirm(anchor, { title, lines = [], okText = '確定', cancelText = '取消', danger = false } = {}) {
  if (current) close(false);
  return new Promise((resolve) => {
    const ok = h('button', { type: 'button', class: `btn btn--small ${danger ? 'btn--danger' : 'btn--primary'}`, onclick: () => close(true) }, okText);
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => close(false) }, cancelText);
    const node = h('div', { class: 'confirm-pop', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('p', { class: 'confirm-pop__title', text: title }),
      lines.map((t) => h('p', { class: 'confirm-pop__line', text: t })),
      h('div', { class: 'confirm-pop__actions' }, cancel, ok));
    document.body.append(node);
    place(node, anchor);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // 不要連底下的面板一起關掉
      close(false);
    };
    const onDown = (e) => { if (!node.contains(e.target) && e.target !== anchor && !anchor?.contains?.(e.target)) close(false); };
    const onMove = () => place(node, anchor);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true); // 面板內捲動時跟著按鈕走
    current = { node, resolve, anchor, off: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, true);
    } };
    (danger ? cancel : ok).focus({ preventScroll: true });
    requestAnimationFrame(() => { node.dataset.open = 'true'; });
  });
}
