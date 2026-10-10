// ============================================================
// 物品面板：點背包裡的物品就打開，可放入、取出、直接吃
// 以及「新增物品」面板：點選遊戲物品，或輸入自創紀念品名稱
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { itemTile, amountPicker, toast, rarityTag } from './controls.js';
import { KNOWN_ITEMS, rarityOf, iconOf, plainName } from './items.js';
import { FOODS, STOMACH_SLOTS } from '../game/rules.js';
import { addItem, removeItem, countOf, eat, useKeepsake } from '../game/engine.js';

export function openItemSheet(state, name, commit) {
  let amount = 1;
  const sheet = openSheet(plainName(name), (close) => {
    const have = countOf(state, name);
    const tier = rarityOf(name);
    const def = state.keepsakes[name];
    const food = FOODS[name];
    const doEat = (ctx) => {
      const err = eat(state, name, ctx);
      if (err) return toast(err);
      toast(`吃下${name}（${ctx === 'rest' ? '修整' : '跑團'}）`);
      commit();
      sheet.refresh();
    };
    const doUse = () => {
      const r = useKeepsake(state, name);
      if (!r.ok) return toast(r.error);
      const got = [...Object.entries(r.gives ?? {}).map(([k, q]) => `${k} ×${q}`), r.time ? `時間 +${r.time}` : ''].filter(Boolean).join('、');
      toast(`使用 ${name}：${got}`);
      commit();
      countOf(state, name) ? sheet.refresh() : close();
    };
    return h('div', { class: 'item-sheet' },
      h('div', { class: `item-sheet__hero${tier !== null ? ' rarity' : ''}`, dataset: { tier: tier ?? 'none', rarity: tier ?? 'none' } },
        h('span', { class: 'item-sheet__icon', text: iconOf(name) }),
        h('div', {},
          rarityTag(tier),
          h('p', { class: 'item-sheet__have' }, '持有 ', h('strong', { text: fmt(have) })))),
      def ? h('p', { class: 'item-sheet__desc', text: def.desc }) : null,
      food ? h('p', { class: 'item-sheet__desc', text: `效果：${food.effect}` }) : null,
      def?.use && have > 0
        ? h('div', { class: 'item-sheet__eat' }, h('button', { type: 'button', class: 'btn btn--primary', onclick: doUse }, '使用 1 個'))
        : null,
      food && have > 0
        ? h('div', { class: 'item-sheet__eat' },
            h('button', { type: 'button', class: 'btn btn--ghost', disabled: state.restStomach.length >= STOMACH_SLOTS, onclick: () => doEat('rest') },
              `修整時吃（${state.restStomach.length}/${STOMACH_SLOTS}）`),
            h('button', { type: 'button', class: 'btn btn--ghost', disabled: state.sessionStomach.length >= STOMACH_SLOTS, onclick: () => doEat('session') },
              `跑團時吃（${state.sessionStomach.length}/${STOMACH_SLOTS}）`))
        : null,
      h('p', { class: 'field-label', text: '數量' }),
      amountPicker({ value: amount, onChange: (n) => { amount = n; sheet.refresh(); } }),
      h('div', { class: 'item-sheet__actions' },
        h('button', {
          type: 'button', class: 'btn btn--ghost', disabled: have < 1,
          onclick: () => {
            const n = Math.min(amount, have);
            removeItem(state, name, n);
            toast(`取出 ${name} ×${fmt(n)}`);
            commit();
            countOf(state, name) ? sheet.refresh() : close();
          },
        }, `取出 ${fmt(Math.min(amount, Math.max(have, 1)))} 個`),
        h('button', {
          type: 'button', class: 'btn btn--primary',
          onclick: () => {
            addItem(state, name, amount);
            toast(`放入 ${name} ×${fmt(amount)}`);
            commit();
            sheet.refresh();
          },
        }, `放入 ${fmt(amount)} 個`))
    );
  });
}

export function openAddSheet(state, commit) {
  let query = '';
  const sheet = openSheet('放進背包', () => {
    const list = KNOWN_ITEMS.filter((n) => !query || n.includes(query));
    const custom = h('input', { class: 'field', placeholder: '自創物品名稱，例如：月月的魚頭', maxlength: 40, 'aria-label': '自創物品名稱' });
    const search = h('input', {
      class: 'field', type: 'search', placeholder: '搜尋遊戲物品', value: query, 'aria-label': '搜尋遊戲物品',
      oninput: (e) => {
        query = e.target.value.trim();
        sheet.refresh();
        const el = document.querySelector('.add-sheet input[type=search]');
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      },
    });
    return h('div', { class: 'add-sheet' },
      h('section', {},
        h('h3', { class: 'section-title', text: '自創物品' }),
        h('p', { class: 'hint', text: '紀念品、劇情道具都可以。' }),
        h('div', { class: 'row' }, custom,
          h('button', {
            type: 'button', class: 'btn btn--primary',
            onclick: () => {
              const n = custom.value.trim();
              if (!n) return custom.focus();
              closeSheet();
              setTimeout(() => openItemSheet(state, n, commit), 230);
            },
          }, '下一步'))),
      h('section', {},
        h('h3', { class: 'section-title', text: '遊戲物品' }),
        search,
        h('div', { class: 'tile-grid' },
          list.map((n) => itemTile(n, countOf(state, n) || null, {
            onClick: () => { closeSheet(); setTimeout(() => openItemSheet(state, n, commit), 230); },
          }))),
        list.length ? null : h('p', { class: 'hint', text: `沒有符合「${query}」的遊戲物品。` }))
    );
  });
}
