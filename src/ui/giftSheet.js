// ============================================================
// 「贈送／交易」面板（背包頁按鈕，唯一的入口）：把背包裡的東西打包（可複選、每樣選數量）送給房間裡的玩家，
// 可以選「贈送」、「交易」，或到「待回覆」處理別人向我提出的交易。對方不在線時會留在伺服器，上線才跳通知。
// 東西先從自己的背包扣，寄失敗會還回來。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './controls.js';
import { createItemPicker } from './itemPicker.js';
import { KNOWN_ITEMS } from './items.js';
import { getRoomStatus, sendMail, notifyTradeChange } from '../state/rollLog.js';
import { createOffersView, incomingCount, refreshTrades } from './playerTrade.js';
import { itemsText, takeOffer, refundOffer } from '../game/trade.js';
import { logActivity } from '../state/activityLog.js';

const KNOWN = new Set(KNOWN_ITEMS);

/** 房間裡的隊友。name 是「角色名」（隊友回報的狀態裡有；還沒回報過才用 Discord 名稱），playerName 是 Discord 名稱 */
export const teammates = () => {
  const r = getRoomStatus();
  if (r.phase !== 'online') return [];
  return r.members.filter((m) => m.uid !== r.me?.uid)
    .map((m) => ({ ...m, playerName: m.name, name: r.vitals?.[m.uid]?.name || m.name }));
};

/**
 * 贈送／交易：背包頁的唯一入口，上方三個分頁——
 *   🎁 贈送：對方不用同意
 *   🤝 交易：對方拿指定的東西（物品與／或金幣）來換，可接受或拒絕
 *   📥 待回覆：別人向我提出的交易單（接受／拒絕）與我發出的（取消），清單在 src/ui/playerTrade.js
 * mode 決定一開始停在哪個。東西（與金幣）先從自己的背包扣，寄失敗會還回來。
 */
export function openGiftSheet(getState, commit, { mode = 'gift' } = {}) {
  const ui = { mode, to: '', picked: new Map(), wants: [{ name: '', qty: 1 }], giveGold: 0, wantGold: 0, giftGold: 0, busy: false }; // picked：物品名 → 要送的數量
  let sheet;

  /** 寄出前的共同步驟：先把東西（與金幣）從背包扣掉；寄失敗再還回來。mail = sendMail 的內容（不含 to） */
  async function dispatch(sendBtn, idleText, give, giveGold, mail, onOk) {
    const state = getState();
    if (!takeOffer(state, give, giveGold)) return toast('背包裡的數量（或金幣）不夠，請重新選。');
    ui.busy = true; sendBtn.disabled = true; sendBtn.textContent = '送出中…';
    commit();
    try {
      await sendMail({ to: ui.to, ...mail });
      const who = teammates().find((m) => m.uid === ui.to)?.name ?? '對方';
      onOk(state, who);
      closeSheet();
    } catch (e) {
      refundOffer(state, give, giveGold); // 寄失敗：還回背包
      commit();
      ui.busy = false;
      toast(`沒有送出：${e.message}`);
      sendBtn.disabled = false; sendBtn.textContent = idleText;
    }
    return undefined;
  }

  function send(sendBtn) {
    const give = Object.fromEntries(ui.picked);
    if (!ui.to) return toast(ui.mode === 'gift' ? '先選要送給誰。' : '先選要跟誰交易。');
    if (ui.mode === 'gift') {
      const gold = ui.giftGold;
      if (!Object.keys(give).length && gold < 1) return toast('先點選要送的東西，或填要送的金幣。');
      return dispatch(sendBtn, '🎁 送出', give, gold, { kind: 'gift', items: give, ...(gold > 0 ? { gold } : {}) }, (state, who) => {
        toast(`已送給 ${who}（對方不在線也會在上線時收到）。`);
        logActivity(state, { cat: 'item', text: `送給 ${who}：${itemsText(give, gold)}`, lines: [] });
      });
    }
    const want = {};
    for (const w of ui.wants) {
      const name = w.name.trim();
      if (!name) continue;
      if (!Number.isInteger(w.qty) || w.qty < 1) return toast(`「${name}」的數量要是 1 以上的整數。`);
      want[name] = (want[name] ?? 0) + w.qty;
    }
    const { giveGold, wantGold } = ui;
    if (!Object.keys(give).length && giveGold < 1) return toast('你要給出的東西或金幣，至少要有一樣。');
    if (!Object.keys(want).length && wantGold < 1) return toast('請填你要對方拿什麼來換（物品或金幣）。');
    const odd = Object.keys(want).filter((n) => !KNOWN.has(n));
    if (odd.length && !confirm(`「${odd.join('、')}」不是已知的物品名稱，對方可能永遠湊不出來。仍要送出？`)) return undefined;
    return dispatch(sendBtn, '🤝 送出交易單', give, giveGold, { kind: 'trade', give, giveGold, want, wantGold }, (state, who) => {
      toast(`交易單已送給 ${who}，等對方回覆（你押的東西隨時可以到「📥 待回覆」取消）。`);
      logActivity(state, { cat: 'item', text: `發起交易給 ${who}`, lines: [`給出：${itemsText(give, giveGold)}`, `要換：${itemsText(want, wantGold)}`] });
      notifyTradeChange();
    });
  }

  /** 金幣輸入格：整數、不能是負的；改了就通知底部更新 */
  const goldField = (label, key, onChange) => h('label', { class: 'extra' }, h('span', { text: label }),
    h('input', {
      class: 'field', type: 'number', min: 0, inputmode: 'numeric', value: ui[key] || '', placeholder: '0', 'aria-label': label,
      oninput: (e) => { ui[key] = Math.max(0, Math.floor(Number(e.target.value)) || 0); onChange(); },
    }));

  function modeToggle(pending) {
    const tabs = [['gift', '🎁 贈送'], ['trade', '🤝 交易'], ['inbox', `📥 待回覆${pending ? `（${pending}）` : ''}`]];
    return h('div', { class: 'toggle-row', role: 'group', 'aria-label': '贈送或交易' }, tabs.map(([id, label]) => h('button', {
      type: 'button', class: 'toggle', 'aria-pressed': String(ui.mode === id), disabled: ui.busy ? true : null,
      onclick: () => { ui.mode = id; sheet.refresh(); },
    }, label)));
  }

  function body() {
    const state = getState();
    const mates = teammates();
    if (!mates.length) return h('p', { class: 'notice', text: '要登入並加入房間，而且房間裡有其他玩家，才能送東西或交易。' });
    if (ui.mode === 'inbox') {
      return h('div', { class: 'giftsheet' }, h('div', { class: 'gift-head' }, modeToggle(incomingCount())), createOffersView({ getState, commit }));
    }
    const trade = ui.mode === 'trade';
    const idle = trade ? '🤝 送出交易單' : '🎁 送出';
    const total = h('span', { class: 'gift-foot__n' });
    const clear = h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { ui.picked.clear(); picker.refresh(); } }, '清除已選');
    const sendBtn = h('button', { type: 'button', class: 'btn btn--primary btn--go', onclick: () => send(sendBtn) }, idle);
    function renderFoot() { // 選取有變（挑選器每次更新都會呼叫）：更新底部的「已選幾件」與送出鈕
      const n = [...ui.picked.values()].reduce((a, b) => a + b, 0);
      const goldNow = trade ? ui.giveGold : ui.giftGold;
      const gold = goldNow > 0 ? `${n ? '＋' : ''}金幣 ${fmt(goldNow)}` : '';
      total.textContent = ui.picked.size || gold ? `${trade ? '給出' : '已選'} ${ui.picked.size ? `${ui.picked.size} 種・共 ${fmt(n)} 件` : ''}${gold}` : '點物品就會選取';
      clear.hidden = !ui.picked.size;
      sendBtn.disabled = ui.busy || !(n || goldNow > 0);
    }
    const picker = createItemPicker({ state, picked: ui.picked, onChange: renderFoot });

    const wantBox = h('div', { class: 'trade-wants' });
    function renderWants() {
      wantBox.replaceChildren(...ui.wants.map((w, i) => h('div', { class: 'trade-want' },
        h('input', { class: 'field', type: 'text', list: 'trade-known-items', placeholder: '物品名稱，例如 豪華蓋飯', value: w.name, 'aria-label': '對方要拿出的物品', oninput: (e) => { w.name = e.target.value; } }),
        h('input', { class: 'field gift-qty', type: 'number', min: 1, inputmode: 'numeric', value: w.qty, 'aria-label': '數量', onchange: (e) => { w.qty = Math.floor(Number(e.target.value)) || 0; } }),
        ui.wants.length > 1 ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': '移除這一項', onclick: () => { ui.wants.splice(i, 1); renderWants(); } }, '✕') : null)));
    }
    renderWants();

    return h('div', { class: 'giftsheet' },
      h('div', { class: 'gift-head' },
        modeToggle(incomingCount()),
        h('label', { class: 'extra' }, h('span', { text: trade ? '交易對象' : '送給' }),
          h('select', { class: 'field', 'aria-label': '送給誰', onchange: (e) => { ui.to = e.target.value; } },
            h('option', { value: '', text: '選擇玩家…' }),
            mates.map((m) => h('option', { value: m.uid, selected: ui.to === m.uid ? true : null, text: `${m.name}${m.online ? '' : '（離線）'}` })))),
        trade ? h('p', { class: 'field-label', text: '① 我要給出（點物品選取、選好數量；也可以出金幣）' }) : null,
        trade ? goldField(`我給出金幣（你有 ${fmt(state.gold)}）`, 'giveGold', renderFoot) : goldField(`同時送金幣（你有 ${fmt(state.gold)}，可以只送金幣）`, 'giftGold', renderFoot),
        picker.head),
      picker.grid,
      trade
        ? h('div', { class: 'trade-want-box' },
          h('p', { class: 'field-label', text: '② 我要對方拿出來換（物品、金幣都可以，至少一樣）' }),
          wantBox,
          h('datalist', { id: 'trade-known-items' }, KNOWN_ITEMS.map((n) => h('option', { value: n }))),
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { ui.wants.push({ name: '', qty: 1 }); renderWants(); } }, '＋ 再加一項物品'),
          goldField('要對方付金幣', 'wantGold', () => {}),
          h('p', { class: 'hint', text: '你要給出的東西與金幣，送出時就先扣掉、押在交易單上。對方接受但東西或金幣不夠＝交易失敗，全部退回給你；對方拒絕或你取消也會退回。對方在「📥 待回覆」回覆。物品名稱要和背包裡的一模一樣。' }))
        : null,
      h('div', { class: 'gift-foot' }, total, clear, sendBtn));
  }

  sheet = openSheet('贈送／交易', body, { tall: true });
  refreshTrades().then((ok) => { if (ok && !ui.busy && ui.mode !== 'inbox' && incomingCount()) sheet.refresh(); }); // 開啟時順便查一次，「待回覆」分頁才有數字
}
