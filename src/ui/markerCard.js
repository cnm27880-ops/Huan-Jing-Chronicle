// ============================================================
// 地點小卡片：點地圖標記後顯示名稱、簡介與「查看設定集」按鈕
// 文字一律走 h() 的 text（textContent），不用 innerHTML。
// ============================================================
import { h } from './dom.js';

export function createMarkerCard({ container, onViewLore, onClose }) {
  function close() {
    container.dataset.open = 'false';
    container.setAttribute('aria-hidden', 'true');
    container.replaceChildren();
  }

  function open(loc, region) {
    const lore = h('button', {
      class: 'btn marker-card__lore',
      type: 'button',
      disabled: loc.locked,
      text: loc.locked ? '情報尚未公開' : '查看設定集',
      onClick: () => onViewLore(loc.id),
    });

    container.replaceChildren(
      h('button', {
        class: 'marker-card__close',
        type: 'button',
        'aria-label': '關閉小卡片',
        text: '×',
        onClick: () => {
          close();
          onClose?.();
        },
      }),
      h('p', { class: 'marker-card__region', text: region?.name ?? '' }),
      h('h2', { class: 'marker-card__title', text: loc.name }),
      h('p', {
        class: 'marker-card__summary',
        text: loc.locked
          ? '這裡的情報還沒公開。'
          : loc.summary || '（GM 尚未撰寫簡介）',
      }),
      lore
    );
    container.dataset.open = 'true';
    container.setAttribute('aria-hidden', 'false');
  }

  return { open, close };
}
