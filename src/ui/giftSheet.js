// ============================================================
// 「送給別人」：把背包裡的東西打包（可複選、每樣選數量）送給房間裡的玩家。
// 對方不用同意；對方不在線時會留在伺服器，上線才跳通知。東西先從自己的背包扣，寄失敗會還回來。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './controls.js';
import { iconOf } from './items.js';
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
  const ui = { to: '', picked: new Map(), query: '', busy: false }; // picked：物品名 → 要送的數量
  let sheet;

  async function send() {
    const state = getState();
    const items = Object.fromEntries(ui.picked);
    if (!ui.to) return toast('先選要送給誰。');
    if (!Object.keys(items).length) return toast('先勾選要送的東西。');
    if (!takeItems(state, items)) return toast('背包裡的數量不夠，請重新選。');
    ui.busy = true; sheet.refresh();
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
      sheet.refresh();
    }
  }

  function body() {
    const state = getState();
    const mates = teammates();
    if (!mates.length) return h('p', { class: 'notice', text: '要登入並加入房間，而且房間裡有其他玩家，才能送東西。' });
    const names = Object.keys(state.inventory).filter((n) => giftable(state, n) && n.includes(ui.query.trim()));
    const total = [...ui.picked.values()].reduce((a, b) => a + b, 0);
    return h('div', { class: 'giftsheet' },
      h('label', { class: 'extra' }, h('span', { text: '送給' }),
        h('select', { class: 'field', 'aria-label': '送給誰', onchange: (e) => { ui.to = e.target.value; sheet.refresh(); } },
          h('option', { value: '', text: '選擇玩家…' }),
          mates.map((m) => h('option', { value: m.uid, selected: ui.to === m.uid ? true : null, text: `${m.name}${m.online ? '' : '（離線）'}` })))),
      h('input', { class: 'field', type: 'search', placeholder: '搜尋背包', value: ui.query, 'aria-label': '搜尋背包', onchange: (e) => { ui.query = e.target.value; sheet.refresh(); } }),
      names.length
        ? h('ul', { class: 'import-list' }, names.map((n) => {
            const have = countOf(state, n);
            const on = ui.picked.has(n);
            return h('li', { class: 'import-row' },
              h('label', { class: 'check' },
                h('input', { type: 'checkbox', checked: on ? true : null, onchange: (e) => { if (e.target.checked) ui.picked.set(n, 1); else ui.picked.delete(n); sheet.refresh(); } }),
                h('span', { text: `${iconOf(n)} ${n}　（有 ${fmt(have)}）` })),
              on ? h('input', {
                class: 'field gift-qty', type: 'number', min: 1, max: have, value: ui.picked.get(n), inputmode: 'numeric', 'aria-label': `${n} 送幾個`,
                onchange: (e) => { ui.picked.set(n, Math.max(1, Math.min(have, Math.floor(Number(e.target.value)) || 1))); sheet.refresh(); },
              }) : null);
          }))
        : h('p', { class: 'notice', text: '背包裡沒有可以送的東西（紀念品不能送）。' }),
      h('button', { type: 'button', class: 'btn btn--primary btn--go', disabled: ui.busy || !total ? true : null, onclick: send },
        ui.busy ? '送出中…' : total ? `🎁 送出（共 ${fmt(total)} 件）` : '🎁 送出'));
  }

  sheet = openSheet('送給別人', body, { tall: true });
}
