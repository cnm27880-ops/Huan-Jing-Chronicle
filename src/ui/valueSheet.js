// ============================================================
// 數值調整面板：手機從底部彈出（bottom sheet），電腦版是貼在觸發元件旁的小彈出框（popover）。
// 只管畫面與操作；寫入數值由呼叫端的 onConfirm 負責。樣式見 blackgold.css 的 .vsheet。
// ============================================================
import { h, fmt } from './dom.js';

const STEPS = [-10, -5, -1, 1, 5, 10];
const isWide = () => window.matchMedia('(min-width: 760px)').matches;
let uid = 0;

/**
 * title：標題；now / max：目前值與上限；trigger：觸發的按鈕（關閉後把焦點還給它）
 * onConfirm(newValue)：按「確定」才呼叫；focusAfter()：畫面重畫後，回傳要接手焦點的新元素（選填）
 */
export function openValueSheet({ title, now, max, trigger, onConfirm, focusAfter }) {
  const clamp = (n) => Math.max(0, Math.min(max, Math.floor(Number(n)) || 0));
  let draft = clamp(now);
  const titleId = `vsheet-title-${++uid}`;

  const input = h('input', {
    class: 'field vsheet__input', type: 'number', inputmode: 'numeric', min: 0, max, value: draft, 'aria-label': `${title}（目前值）`,
    oninput: (e) => { draft = clamp(e.target.value); },
    onchange: () => { input.value = draft; },
  });
  const setDraft = (n) => { draft = clamp(n); input.value = draft; };

  const stepBtn = (n) => h('button', {
    type: 'button', class: 'btn vsheet__step', onclick: () => setDraft(draft + n), 'aria-label': `${n > 0 ? '加' : '減'} ${Math.abs(n)}`,
  }, `${n > 0 ? '+' : '−'}${Math.abs(n)}`);

  const panel = h('div', { class: 'vsheet__panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('h2', { class: 'vsheet__title', id: titleId, text: title }),
    h('div', { class: 'vsheet__read' }, input, h('span', { class: 'vsheet__max num', text: `/ ${fmt(max)}` })),
    h('p', { class: 'vsheet__was', text: `原本 ${fmt(now)}` }),
    h('div', { class: 'vsheet__steps' }, STEPS.map(stepBtn)),
    h('button', { type: 'button', class: 'btn vsheet__full', onclick: () => setDraft(max) }, '回滿'),
    h('div', { class: 'vsheet__actions' },
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => close(false) }, '取消'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: () => close(true) }, '確定')));
  const backdrop = h('div', { class: 'vsheet__backdrop', onclick: () => close(false) });
  const box = h('div', { class: 'vsheet' }, backdrop, panel);

  function place() {
    if (!isWide() || !trigger?.isConnected) return;
    const r = trigger.getBoundingClientRect();
    const w = panel.offsetWidth;
    const hh = panel.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll('button, input')];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  const onHash = () => close(false);

  let closed = false;
  function close(ok) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('resize', place);
    if (ok) onConfirm(draft); // 先寫入（會重畫頁面），再移除面板、把焦點還給重畫後的新元素
    box.remove();
    const back = (focusAfter && focusAfter()) || trigger;
    if (back?.isConnected) back.focus();
  }

  document.body.append(box);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', onHash);
  window.addEventListener('resize', place);
  place();
  panel.focus();
  requestAnimationFrame(() => { box.dataset.open = 'true'; });
}
