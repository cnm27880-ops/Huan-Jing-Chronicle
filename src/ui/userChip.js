// 頂部列的登入者標籤：頭像 + Discord 名稱 + 登出。未登入時什麼都不顯示。
import { h } from './dom.js';
import { logout } from '../api/auth.js';
import { getRoomStatus, subscribeRoom } from '../state/rollLog.js';

export function createUserChip(onLoggedOut) {
  const chip = h('div', { class: 'user-chip', hidden: true });
  document.querySelector('.topbar')?.append(chip);

  const dotLabel = { connecting: '連線房間中', online: '已加入房間', reconnecting: '連線中斷，重新連線中', denied: '未加入房間（本機模式）', local: '本機模式' };
  function room() {
    const dot = chip.querySelector('.user-chip__dot');
    if (!dot) return;
    const phase = getRoomStatus().phase;
    dot.dataset.phase = phase;
    dot.title = dotLabel[phase];
    dot.setAttribute('aria-label', dotLabel[phase]);
  }
  subscribeRoom(room);

  function set(user) {
    chip.replaceChildren();
    chip.hidden = !user;
    if (!user) return;
    chip.append(
      h('span', { class: 'user-chip__dot', role: 'img' }),
      user.avatarUrl && h('img', { class: 'user-chip__avatar', src: user.avatarUrl, alt: '', width: 24, height: 24, referrerpolicy: 'no-referrer' }),
      h('span', { class: 'user-chip__name', text: user.name }),
      h('button', {
        type: 'button', class: 'btn btn--ghost user-chip__out', text: '登出',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          if (await logout()) { set(null); onLoggedOut?.(); } else e.currentTarget.disabled = false;
        },
      }));
    room();
  }
  return { set };
}
