// ============================================================
// 背包物品挑選器（贈送、交易共用）：分類鈕＋格狀物品（沒有搜尋欄，用分類找）。金幣是物品格裡的一格（每次加減 100，也可以直接輸入）。
// 點一下選取，選取後出現 −／＋／全部（按住 −／＋ 連加連減）。picked 是 Map（物品名 → 數量，金幣的名字是 GOLD_NAME），由呼叫端持有；
// 選取有變時呼叫 onChange()。所有更新都是「原地更新」，選東西、切分類時捲動位置不會跳。
// ============================================================
import { h, fmt } from './dom.js';
import { iconOf, plainName, CATEGORIES, categoryOf } from './items.js';
import { holdRepeat } from './holdRepeat.js';
import { giftable } from '../game/mail.js';
import { GOLD_NAME } from '../game/trade.js';
import { countOf } from '../game/engine.js';

/** 物品顯示名：名字本身已含圖示的不重複加 */
export const labelOf = (n) => { const i = iconOf(n); return i ? `${i} ${plainName(n)}` : n; };

const GOLD_STEP = 100; // 金幣 −／＋ 每次加減多少

/**
 * 回傳 { head, grid, owned }：head（分類鈕）與 grid（物品格）由呼叫端放進自己的版面；
 * owned 是背包裡可以送的東西名單（不含金幣）。
 */
export function createItemPicker({ state, picked, onChange = () => {} }) {
  const ui = { cat: 'all' };
  const owned = Object.keys(state.inventory).filter((n) => giftable(state, n));
  const hasGold = (state.gold ?? 0) > 0;
  const cats = [{ id: 'all', name: '全部' }, ...(hasGold ? [{ id: 'gold', name: '🪙 金幣' }] : []), ...CATEGORIES.filter((c) => owned.some((n) => categoryOf(n) === c.id))];
  const chips = h('div', { class: 'gift-cats', role: 'tablist', 'aria-label': '物品分類' });
  const grid = h('div', { class: 'gift-grid' });

  function renderChips() {
    chips.replaceChildren(...cats.map((c) => h('button', {
      type: 'button', role: 'tab', class: 'chip', 'aria-selected': String(ui.cat === c.id),
      onclick: () => { ui.cat = c.id; renderChips(); renderGrid(); },
    }, c.name)));
  }

  function tile(n) {
    const isGold = n === GOLD_NAME;
    const have = isGold ? state.gold : countOf(state, n);
    const step = isGold ? GOLD_STEP : 1;
    const on = picked.has(n);
    let stepper = null;
    if (on) {
      const qty = h('input', {
        class: 'field gift-qty', type: 'number', min: 1, max: have, value: picked.get(n), inputmode: 'numeric', 'aria-label': `${n} 幾個`,
        onchange: (e) => { set(Number(e.target.value) || 1); },
      });
      if (isGold) qty.classList.add('gift-qty--gold');
      const minus = h('button', { type: 'button', class: 'btn btn--ghost gift-step', 'aria-label': `少 ${fmt(step)}（按住連減）` }, '−');
      const plus = h('button', { type: 'button', class: 'btn btn--ghost gift-step', 'aria-label': `多 ${fmt(step)}（按住連加）` }, '＋');
      const set = (v) => {
        const c = Math.max(1, Math.min(have, Math.floor(v)));
        qty.value = String(c);
        if (c === picked.get(n)) return false;
        picked.set(n, c);
        onChange();
        return true;
      };
      holdRepeat(minus, () => set(picked.get(n) - step));
      holdRepeat(plus, () => set(picked.get(n) + step));
      stepper = h('div', { class: 'gift-tile__qty' }, minus, qty, plus,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => set(have) }, '全部'));
    }
    return h('div', { class: 'gift-tile', dataset: { on: on ? '1' : '0' } },
      h('button', {
        type: 'button', class: 'gift-tile__main', 'aria-pressed': String(on),
        onclick: () => { if (picked.has(n)) picked.delete(n); else picked.set(n, 1); renderGrid(); },
      },
      h('span', { class: 'gift-tile__name', text: isGold ? '🪙 金幣' : labelOf(n) }),
      h('small', { class: 'num', text: `有 ${fmt(have)}${isGold ? `（每次 ±${fmt(step)}）` : ''}` })),
      stepper);
  }

  function renderGrid() {
    const names = [
      ...(hasGold && (ui.cat === 'all' || ui.cat === 'gold') ? [GOLD_NAME] : []),
      ...(ui.cat === 'gold' ? [] : owned.filter((n) => ui.cat === 'all' || categoryOf(n) === ui.cat)),
    ];
    grid.replaceChildren(...(names.length ? names.map(tile) : [h('p', { class: 'notice', text: '背包裡沒有可以送的東西（紀念品不能送）。' })]));
    onChange();
  }

  const head = h('div', { class: 'gift-picker-head' }, chips);
  renderChips();
  renderGrid();
  return { head, grid, owned, refresh: renderGrid };
}
