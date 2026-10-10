// ============================================================
// 封面：進入網站時的第一個畫面。
// 「Discord 登入」會導向 Worker（階段 1-A）。未登入、或 API 連不上時，一律以訪客進入 = 單機試玩
// （存檔在這個瀏覽器），網站不會因此壞掉。登入後目前只顯示名稱與頭像；角色共享與擲骰是 1-B。
// ============================================================
import { h } from './dom.js';
import { loginUrl, logout } from '../api/auth.js';

export function showCover({ onEnter, notice, onUserChange } = {}) {
  const background = [...document.querySelectorAll('.topbar, main')];
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

  // 封面骨架在 index.html（第一個畫面就是封面）；找不到時（例如測試）才自己建
  const INTRO_MS = 2600; // 入場動畫時間：這段時間後按鈕才浮現（點一下或按任意鍵可跳過）
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const actions = h('div', { class: 'cover__actions is-wait' }, userBox, enter, discord);
  let root = document.getElementById('cover');
  if (root) {
    root.querySelector('.cover__inner').append(actions, note);
  } else {
    root = h('div', { class: 'cover', id: 'cover' },
      h('div', { class: 'cover__fx', 'aria-hidden': 'true' }),
      h('div', { class: 'cover__inner' },
        h('p', { class: 'cover__kicker', text: '網遊 · 跑團 · 編年史' }),
        h('h1', { id: 'cover-title', class: 'cover__title', text: '幻境編年史' }),
        h('p', { class: 'cover__lead', text: '踏入幻境，書寫屬於你的篇章。' }),
        actions, note));
    document.body.prepend(root);
  }
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'cover-title');

  // 飄升的金色光點（只是裝飾；減少動態時不放）
  const fx = root.querySelector('.cover__fx');
  if (fx && !reduced) {
    for (let i = 0; i < 28; i++) {
      fx.append(h('i', { class: 'cover__ember', style: `--x:${Math.round(Math.random() * 100)}%;--s:${(2 + Math.random() * 4).toFixed(1)}px;--d:${(5 + Math.random() * 6).toFixed(1)}s;--delay:${(-Math.random() * 8).toFixed(1)}s` }));
    }
  }

  let revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    clearTimeout(introTimer);
    actions.classList.remove('is-wait');
    root.classList.add('is-ready');
    enter.focus();
  }
  const introTimer = setTimeout(reveal, reduced ? 0 : INTRO_MS);
  root.addEventListener('pointerdown', reveal);

  function close() {
    reveal();
    root.classList.add('is-leaving');
    setInert(false);
    setTimeout(() => root.remove(), 300);
    onEnter?.();
  }

  setInert(true);
  root.addEventListener('keydown', (e) => { if (!revealed) return reveal(); if (e.key === 'Escape') close(); return undefined; });
  document.addEventListener('keydown', reveal, { once: true }); // 還在播入場動畫時，按任意鍵跳過
  return { close, setUser };
}
