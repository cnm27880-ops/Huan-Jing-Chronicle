// ============================================================
// 封面：進入網站時的第一個畫面。
// 「Discord 登入」會導向 Worker（階段 1-A）。未登入、或 API 連不上時，一律以訪客進入 = 單機試玩
// （存檔在這個瀏覽器），網站不會因此壞掉。登入後目前只顯示名稱與頭像；角色共享與擲骰是 1-B。
// ============================================================
import { h } from './dom.js';
import { loginUrl, logout } from '../api/auth.js';

export function showCover({ onEnter, notice, onUserChange } = {}) {
  const background = [...document.querySelectorAll('.topbar, main, #index-panel, #dice-tray')];
  const setInert = (v) => background.forEach((el) => { el.inert = v; });

  const enter = h('button', { type: 'button', class: 'btn btn--primary cover__btn', onclick: close }, '以訪客進入');
  const discord = h('a', { class: 'btn cover__btn cover__btn--discord', href: loginUrl(), role: 'button' }, '使用 Discord 登入');
  const userBox = h('div', { class: 'cover__user', hidden: true });
  const note = h('p', { id: 'cover-discord-note', class: 'cover__note' });
  const GUEST_NOTE = '登入後會顯示你的 Discord 名稱與頭像（角色存檔與擲骰共享將在下一階段加入）。現在以訪客進入，角色只存在這個瀏覽器。';
  note.textContent = notice || GUEST_NOTE;

  /** 依登入狀態更新封面；user 為 null = 未登入 */
  function setUser(user) {
    userBox.replaceChildren();
    userBox.hidden = !user;
    discord.hidden = !!user;
    note.textContent = user ? '已登入。目前角色存檔仍存在這個瀏覽器；共享存檔與擲骰將在下一階段加入。' : (notice || GUEST_NOTE);
    enter.textContent = user ? `以 ${user.name} 進入` : '以訪客進入';
    if (!user) return;
    userBox.append(
      user.avatarUrl && h('img', { class: 'cover__avatar', src: user.avatarUrl, alt: '', width: 48, height: 48, referrerpolicy: 'no-referrer' }),
      h('span', { class: 'cover__username', text: user.name }),
      h('button', {
        type: 'button', class: 'btn btn--ghost', text: '登出',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          if (await logout()) { setUser(null); onUserChange?.(null); } else e.currentTarget.disabled = false;
        },
      }));
  }

  const root = h('div', { class: 'cover', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cover-title' },
    h('div', { class: 'cover__inner' },
      h('p', { class: 'cover__kicker', text: '網遊 · 跑團 · 編年史' }),
      h('h1', { id: 'cover-title', class: 'cover__title', text: '幻境編年史' }),
      h('p', { class: 'cover__lead', text: '踏入幻境，書寫屬於你的篇章。' }),
      h('div', { class: 'cover__actions' }, userBox, enter, discord),
      note));

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
  return { close, setUser };
}
