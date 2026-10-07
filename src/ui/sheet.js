// ============================================================
// 彈出面板：手機從底部滑出，桌機置中。點背景或按 Esc 關閉
// ============================================================
import { h } from './dom.js';

let current = null;

export function closeSheet() {
  if (!current) return;
  const { node, lastFocus } = current;
  current = null;
  node.dataset.open = 'false';
  setTimeout(() => node.remove(), 220);
  lastFocus?.focus?.({ preventScroll: true });
}

/** build(close) 回傳面板內容；之後要更新內容可呼叫回傳的 refresh() */
export function openSheet(title, build, { tall = false } = {}) {
  closeSheet();
  const body = h('div', { class: 'sheet__body' });
  const panel = h('div', { class: 'sheet__panel', dataset: { size: tall ? 'tall' : 'normal' }, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'sheet__head' },
      h('h2', { class: 'sheet__title', text: title }),
      h('button', { type: 'button', class: 'sheet__close', onclick: closeSheet }, '關閉')),
    body);
  const node = h('div', { class: 'sheet', dataset: { open: 'false' } },
    h('div', { class: 'sheet__backdrop', onclick: closeSheet }), panel);
  const refresh = () => body.replaceChildren(build(closeSheet));
  refresh();
  document.body.append(node);
  current = { node, lastFocus: document.activeElement };
  requestAnimationFrame(() => {
    node.dataset.open = 'true';
    panel.querySelector('.sheet__close').focus({ preventScroll: true });
  });
  return { refresh };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && current) closeSheet();
});
