// ============================================================
// 封面：進入網站時的第一個畫面。
// 「Discord 登入」目前只是預留的按鈕 —— 真正的登入要等階段 1 的後端（Cloudflare Worker）才能做，
// 在那之前誠實地標示「尚未開放」，不假裝可以登入。以訪客進入 = 目前的單機試玩（存檔在這個瀏覽器）。
// ============================================================
import { h } from './dom.js';

export function showCover({ onEnter } = {}) {
  const background = [...document.querySelectorAll('.topbar, main, #index-panel, #dice-tray')];
  const setInert = (v) => background.forEach((el) => { el.inert = v; });

  const enter = h('button', { type: 'button', class: 'btn btn--primary cover__btn', onclick: close }, '以訪客進入');
  const discord = h('button', {
    type: 'button', class: 'btn cover__btn cover__btn--discord', disabled: true, 'aria-describedby': 'cover-discord-note',
  }, '使用 Discord 登入（尚未開放）');

  const root = h('div', { class: 'cover', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cover-title' },
    h('div', { class: 'cover__inner' },
      h('p', { class: 'cover__kicker', text: '網遊 · 跑團 · 編年史' }),
      h('h1', { id: 'cover-title', class: 'cover__title', text: '幻境編年史' }),
      h('p', { class: 'cover__lead', text: '踏入幻境，書寫屬於你的篇章。' }),
      h('div', { class: 'cover__actions' }, enter, discord),
      h('p', { id: 'cover-discord-note', class: 'cover__note', text: 'Discord 登入需要伺服器端，會在下一個開發階段加入；登入後角色存檔與擲骰會和其他玩家共享。現在以訪客進入，角色只存在這個瀏覽器。' })));

  function close() {
    root.classList.add('is-leaving');
    setInert(false);
    setTimeout(() => root.remove(), 300);
    onEnter?.();
  }

  setInert(true);
  document.body.append(root);
  enter.focus();
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { close };
}
