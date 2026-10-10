// ============================================================
// 網頁自己的對話框（取代瀏覽器的 confirm() 與 prompt()）：
//   askConfirm(按鈕, { title, lines, okText, cancelText, danger }) → Promise<boolean>
//   askText(按鈕, { title, lines, value, maxLength, okText })      → Promise<string | null>（取消回傳 null）
// 有給按鈕：貼在按鈕旁邊，滑鼠不用移到頁面頂端；沒給按鈕（null）：置中並蓋一層暗色背景。
// 點旁邊、按 Esc、按「取消」都算取消；一次只會有一個。
// ============================================================
import { h } from './dom.js';

let current = null;

function close(result) {
  if (!current) return;
  const { node, backdrop, resolve, anchor, off } = current;
  current = null;
  off();
  node.remove();
  backdrop?.remove();
  resolve(result);
  if (anchor?.isConnected) anchor.focus?.({ preventScroll: true });
}

/** 把對話框放在按鈕上方（放不下就放下方），左右對齊按鈕中心並限制在畫面內；沒有按鈕就置中 */
function place(node, anchor) {
  const gap = 8;
  const margin = 8;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = Math.min(340, vw - margin * 2);
  node.style.width = `${w}px`;
  const ph = node.offsetHeight;
  if (!anchor?.isConnected) { // 沒有按鈕、或按鈕已經被重畫掉：放畫面中間
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

/** 共用：build(done) 回傳內容元素，done(結果) 關閉並回傳；focusEl() 回傳要先 focus 的元素 */
function openPop(anchor, title, build, cancelValue) {
  if (current) close(cancelValue);
  return new Promise((resolve) => {
    const modal = !anchor?.isConnected;
    const done = (v) => close(v);
    const { content, focusEl } = build(done);
    const node = h('div', { class: 'confirm-pop', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, content);
    const backdrop = modal ? h('div', { class: 'confirm-backdrop', onclick: () => close(cancelValue) }) : null;
    if (backdrop) document.body.append(backdrop);
    document.body.append(node);
    place(node, anchor);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // 不要連底下的面板一起關掉
      close(cancelValue);
    };
    const onDown = (e) => { if (!node.contains(e.target) && e.target !== anchor && !anchor?.contains?.(e.target)) close(cancelValue); };
    const onMove = () => place(node, anchor);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true); // 面板內捲動時跟著按鈕走
    current = { node, backdrop, resolve, anchor, off: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, true);
    } };
    focusEl().focus({ preventScroll: true });
    requestAnimationFrame(() => { node.dataset.open = 'true'; if (backdrop) backdrop.dataset.open = 'true'; });
  });
}

const textLines = (lines) => lines.flatMap((t) => String(t).split('\n')).filter((t) => t !== '').map((t) => h('p', { class: 'confirm-pop__line', text: t }));

export function askConfirm(anchor, { title, lines = [], okText = '確定', cancelText = '取消', danger = false } = {}) {
  return openPop(anchor, title, (done) => {
    const ok = h('button', { type: 'button', class: `btn btn--small ${danger ? 'btn--danger' : 'btn--primary'}`, onclick: () => done(true) }, okText);
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => done(false) }, cancelText);
    return {
      content: [h('p', { class: 'confirm-pop__title', text: title }), textLines(lines), h('div', { class: 'confirm-pop__actions' }, cancel, ok)],
      focusEl: () => (danger ? cancel : ok),
    };
  }, false);
}

export function askText(anchor, { title, lines = [], value = '', maxLength = 40, okText = '確定', cancelText = '取消' } = {}) {
  return openPop(anchor, title, (done) => {
    const input = h('input', { class: 'field confirm-pop__input', type: 'text', maxlength: String(maxLength), value, 'aria-label': title });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value); } });
    const ok = h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => done(input.value) }, okText);
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => done(null) }, cancelText);
    return {
      content: [h('p', { class: 'confirm-pop__title', text: title }), textLines(lines), input, h('div', { class: 'confirm-pop__actions' }, cancel, ok)],
      focusEl: () => { queueMicrotask(() => input.select()); return input; },
    };
  }, null);
}
