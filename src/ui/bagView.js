// ============================================================
// 背包頁面：物品格排列，點物品打開面板調整數量或直接吃
// 搜尋與「放進背包」固定在最上方
// ============================================================
import { h, fmt } from './dom.js';
import { itemTile } from './controls.js';
import { CATEGORIES, categoryOf } from './items.js';
import { openItemSheet, openAddSheet } from './itemSheet.js';
import { countOf } from '../game/engine.js';

// 紀念品與收藏放最前面，是玩家的特色
const ORDER = ['keepsake', 'meal', 'potion', 'material', 'book', 'gear'];

export function createBagView({ root, getState, commit, onReset }) {
  const ui = { query: '', collapsed: new Set() };

  function render() {
    const state = getState();
    const names = Object.keys(state.inventory);
    const ordered = [
      ...state.sortOrder.filter((n) => names.includes(n)),
      ...names.filter((n) => !state.sortOrder.includes(n)).sort((a, b) => countOf(state, b) - countOf(state, a)),
    ];
    const q = ui.query.trim();
    const visible = q ? ordered.filter((n) => n.includes(q)) : ordered;

    const groups = ORDER.map((id) => ({ ...CATEGORIES.find((c) => c.id === id), items: [] }));
    visible.forEach((n) => groups.find((g) => g.id === categoryOf(n)).items.push(n));

    const search = h('input', {
      class: 'field', type: 'search', placeholder: '搜尋背包', value: ui.query, 'aria-label': '搜尋背包',
      oninput: (e) => {
        ui.query = e.target.value;
        render();
        const el = root.querySelector('.bag-bar input');
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      },
    });

    const scrollY = root.scrollTop;
    root.replaceChildren(
      h('div', { class: 'bag-bar' },
        h('div', { class: 'bag-bar__title' },
          h('strong', { text: `${state.name}的背包` }),
          h('span', { text: `${fmt(names.length)} 種　金幣 ${fmt(state.gold)}` })),
        h('div', { class: 'bag-bar__tools' },
          search,
          h('button', { type: 'button', class: 'btn btn--primary', onclick: () => openAddSheet(state, commit) }, '＋ 放進背包'))),
      h('div', { class: 'bag' },
        groups.filter((g) => g.items.length).map((g) => {
          const open = Boolean(q) || !ui.collapsed.has(g.id);
          const grid = h('div', { class: g.id === 'keepsake' ? 'showcase' : 'tile-grid', hidden: !open },
            g.items.map((n) => itemTile(n, countOf(state, n), {
              size: g.id === 'keepsake' ? 'lg' : 'md',
              extra: g.id === 'keepsake' && state.keepsakes[n]
                ? h('span', { class: 'tile__note', text: state.keepsakes[n].desc })
                : null,
              onClick: () => openItemSheet(state, n, commit),
            })));
          return h('section', { class: `bag-group bag-group--${g.id}` },
            h('button', {
              type: 'button', class: 'bag-group__head', 'aria-expanded': String(open),
              // 只切換這一組的顯示，不重畫整頁（整頁重畫會閃）
              onclick: (e) => {
                const nowOpen = grid.hidden;
                grid.hidden = !nowOpen;
                e.currentTarget.setAttribute('aria-expanded', String(nowOpen));
                if (nowOpen) ui.collapsed.delete(g.id); else ui.collapsed.add(g.id);
              },
            }, h('span', { text: g.name }), h('small', { text: `${g.items.length} 種` })),
            grid);
        }),
        visible.length ? null : h('p', { class: 'empty', text: `背包裡沒有「${q}」。` }),
        h('div', { class: 'bag-foot' },
          h('p', { class: 'hint', text: '原型階段的資料只存在這台裝置的瀏覽器。' }),
          h('button', {
            type: 'button', class: 'btn btn--ghost btn--small',
            onclick: () => confirm('還原成示範資料？目前的變更會消失。') && onReset(),
          }, '還原示範資料')))
    );
    root.scrollTop = scrollY;
  }

  return { render };
}
