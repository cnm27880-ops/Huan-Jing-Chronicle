// ============================================================
// 擲骰紀錄的畫面：骰盤與戰鬥頁共用。文字一律走 textContent（防 XSS）
// ============================================================
import { h } from './dom.js';
import { getLog, subscribe } from '../state/rollLog.js';

const ICON = {
  check: '🎲', dice: '🎲', identify: '🔍', attack: '⚔️', defend: '🛡️', potion: '🧪', skill: '✨', note: '📝', divider: '⚔️',
};

const clock = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 單一事件的卡片 */
export function renderRoll(ev, { fresh = false } = {}) {
  if (ev.kind === 'divider') { // GM 開新戰鬥：紀錄裡的分隔線，只是分段，不影響任何規則
    return h('li', { class: 'roll roll--divider', dataset: { tone: '', fresh: fresh ? '1' : '0' } },
      h('span', { class: 'roll__icon', 'aria-hidden': 'true', text: ICON.divider }),
      h('strong', { class: 'roll__label', text: ev.label }),
      h('time', { class: 'roll__time', text: clock(ev.t) }),
      ev.lines?.length ? h('span', { class: 'roll__sub', text: ev.lines.join('　') }) : null);
  }
  return h('li', { class: `roll roll--${ev.kind}`, dataset: { tone: ev.tone ?? '', fresh: fresh ? '1' : '0' } },
    h('div', { class: 'roll__head' },
      h('span', { class: 'roll__icon', 'aria-hidden': 'true', text: ICON[ev.kind] ?? '🎲' }),
      h('span', { class: 'roll__who', text: ev.who }),
      h('span', { class: 'roll__label', text: ev.label }),
      h('time', { class: 'roll__time', text: clock(ev.t) })),
    ev.big != null ? h('div', { class: 'roll__big', text: String(ev.big) }) : null,
    ev.lines?.length ? h('ul', { class: 'roll__lines' }, ev.lines.map((l) => h('li', { text: l }))) : null);
}

/**
 * 把紀錄清單掛進 container，之後有新事件會自動更新。
 * 回傳 { destroy }；limit 是最多顯示幾筆，skip 是略過最新的幾筆。
 */
export function mountFeed(container, { limit = 30, skip = 0, empty = '還沒有人擲骰。' } = {}) {
  const draw = (latest) => {
    const list = getLog().slice(skip, skip + limit);
    container.replaceChildren(
      list.length
        ? h('ol', { class: 'roll-list' }, list.map((e) => renderRoll(e, { fresh: Boolean(latest) && latest.id === e.id })))
        : h('p', { class: 'empty', text: empty }));
  };
  draw(null);
  const off = subscribe(draw);
  return { destroy: off };
}
