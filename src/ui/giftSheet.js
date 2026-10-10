// ============================================================
// 「送給別人」：把背包裡的東西打包（可複選、每樣選數量）送給房間裡的玩家。
// 對方不用同意；對方不在線時會留在伺服器，上線才跳通知。東西先從自己的背包扣，寄失敗會還回來。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './controls.js';
import { iconOf, plainName, CATEGORIES, categoryOf } from './items.js';
import { holdRepeat } from './holdRepeat.js';
import { getRoomStatus, sendMail } from '../state/rollLog.js';
import { giftable, takeItems, refundItems } from '../game/mail.js';
import { countOf } from '../game/engine.js';
import { logActivity } from '../state/activityLog.js';

/** 房間裡的隊友。name 是「角色名」（隊友回報的狀態裡有；還沒回報過才用 Discord 名稱），playerName 是 Discord 名稱 */
export const teammates = () => {
  const r = getRoomStatus();
  if (r.phase !== 'online') return [];
  return r.members.filter((m) => m.uid !== r.me?.uid)
    .map((m) => ({ ...m, playerName: m.name, name: r.vitals?.[m.uid]?.name || m.name }));
};

export function openGiftSheet(getState, commit) {
  const ui = { to: '', picked: new Map(), query: '', cat: 'all', busy: false }; // picked：物品名 → 要送的數量

  async function send(sendBtn) {
    const state = getState();
    const items = Object.fromEntries(ui.picked);
    if (!ui.to) return toast('先選要送給誰。');
    if (!Object.keys(items).length) return toast('先點選要送的東西。');
    if (!takeItems(state, items)) return toast('背包裡的數量不夠，請重新選。');
    ui.busy = true; sendBtn.disabled = true; sendBtn.textContent = '送出中…';
    commit();
    try {
      await sendMail({ to: ui.to, kind: 'gift', items });
      const who = teammates().find((m) => m.uid === ui.to)?.name ?? '對方';
      toast(`已送給 ${who}（對方不在線也會在上線時收到）。`);
      logActivity(state, { cat: 'item', text: `送給 ${who}：${Object.keys(items).length} 種東西`, lines: Object.entries(items).map(([n, q]) => `${n} ×${q}`) });
      closeSheet();
    } catch (e) {
      refundItems(state, items); // 寄失敗：還回背包
      commit();
      ui.busy = false;
      toast(`沒有送出：${e.message}`);
      sendBtn.disabled = false;
      sendBtn.textContent = '🎁 送出';
    }
    return undefined;
  }

  /** 物品顯示名：名字本身已含圖示的不重複加 */
  const labelOf = (n) => { const i = iconOf(n); return i ? `${i} ${plainName(n)}` : n; };

  function body() {
    const state = getState();
    const mates = teammates();
    if (!mates.length) return h('p', { class: 'notice', text: '要登入並加入房間，而且房間裡有其他玩家，才能送東西。' });
    const owned = Object.keys(state.inventory).filter((n) => giftable(state, n));
    if (!owned.length) return h('p', { class: 'notice', text: '背包裡沒有可以送的東西（紀念品不能送）。' });
    const cats = [{ id: 'all', name: '全部' }, ...CATEGORIES.filter((c) => owned.some((n) => categoryOf(n) === c.id))];

    // 下面三塊（分類鈕、物品格、底部送出列）都是「原地更新」，選東西、搜尋、切分類時不會整頁重畫、捲動位置不會跳
    const chips = h('div', { class: 'gift-cats', role: 'tablist', 'aria-label': '物品分類' });
    const grid = h('div', { class: 'gift-grid' });
    const total = h('span', { class: 'gift-foot__n' });
    const clear = h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { ui.picked.clear(); renderGrid(); } }, '清除已選');
    const sendBtn = h('button', { type: 'button', class: 'btn btn--primary btn--go', onclick: () => send(sendBtn) }, '🎁 送出');

    function renderFoot() {
      const n = [...ui.picked.values()].reduce((a, b) => a + b, 0);
      total.textContent = ui.picked.size ? `已選 ${ui.picked.size} 種・共 ${fmt(n)} 件` : '點物品就會選取';
      clear.hidden = !ui.picked.size;
      sendBtn.disabled = ui.busy || !n;
    }

    function renderChips() {
      chips.replaceChildren(...cats.map((c) => h('button', {
        type: 'button', role: 'tab', class: 'chip', 'aria-selected': String(ui.cat === c.id),
        onclick: () => { ui.cat = c.id; renderChips(); renderGrid(); },
      }, c.name)));
    }

    function tile(n) {
      const have = countOf(state, n);
      const on = ui.picked.has(n);
      let stepper = null;
      if (on) {
        const qty = h('input', {
          class: 'field gift-qty', type: 'number', min: 1, max: have, value: ui.picked.get(n), inputmode: 'numeric', 'aria-label': `${n} 送幾個`,
          onchange: (e) => { set(Number(e.target.value) || 1); },
        });
        const minus = h('button', { type: 'button', class: 'btn btn--ghost gift-step', 'aria-label': '少 1 個（按住連減）' }, '−');
        const plus = h('button', { type: 'button', class: 'btn btn--ghost gift-step', 'aria-label': '多 1 個（按住連加）' }, '＋');
        const set = (v) => {
          const c = Math.max(1, Math.min(have, Math.floor(v)));
          qty.value = String(c);
          if (c === ui.picked.get(n)) return false;
          ui.picked.set(n, c);
          renderFoot();
          return true;
        };
        holdRepeat(minus, () => set(ui.picked.get(n) - 1));
        holdRepeat(plus, () => set(ui.picked.get(n) + 1));
        stepper = h('div', { class: 'gift-tile__qty' }, minus, qty, plus,
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => set(have) }, '全部'));
      }
      return h('div', { class: 'gift-tile', dataset: { on: on ? '1' : '0' } },
        h('button', {
          type: 'button', class: 'gift-tile__main', 'aria-pressed': String(on),
          onclick: () => { if (ui.picked.has(n)) ui.picked.delete(n); else ui.picked.set(n, 1); renderGrid(); },
        },
        h('span', { class: 'gift-tile__name', text: labelOf(n) }),
        h('small', { class: 'num', text: `有 ${fmt(have)}` })),
        stepper);
    }

    function renderGrid() {
      const q = ui.query.trim();
      const names = owned.filter((n) => (ui.cat === 'all' || categoryOf(n) === ui.cat) && n.includes(q));
      grid.replaceChildren(...(names.length ? names.map(tile) : [h('p', { class: 'notice', text: '沒有符合的東西。' })]));
      renderFoot();
    }

    renderChips();
    renderGrid();
    return h('div', { class: 'giftsheet' },
      h('div', { class: 'gift-head' },
        h('label', { class: 'extra' }, h('span', { text: '送給' }),
          h('select', { class: 'field', 'aria-label': '送給誰', onchange: (e) => { ui.to = e.target.value; } },
            h('option', { value: '', text: '選擇玩家…' }),
            mates.map((m) => h('option', { value: m.uid, selected: ui.to === m.uid ? true : null, text: `${m.name}${m.online ? '' : '（離線）'}` })))),
        h('input', { class: 'field', type: 'search', placeholder: '搜尋背包', value: ui.query, 'aria-label': '搜尋背包', oninput: (e) => { ui.query = e.target.value; renderGrid(); } }),
        chips),
      grid,
      h('div', { class: 'gift-foot' }, total, clear, sendBtn));
  }

  openSheet('送給別人', body, { tall: true });
}
