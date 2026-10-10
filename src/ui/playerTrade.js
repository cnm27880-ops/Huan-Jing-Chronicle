// ============================================================
// 玩家交易（交易頁「玩家交易」分頁）：A 指定一位玩家，用自己的東西換對方指定的東西。
//   發起：A 挑要給的東西（先從背包扣、押在伺服器的交易單上）＋填對方要拿出的東西 → 對方在這個分頁看到
//   對方回覆：接受（他的東西夠才成交）／拒絕；接受時東西不夠＝交易失敗，A 的東西退回；A 也可以自己取消
//   成交或退回的東西都走一般信箱（src/state/mailbox.js），上線就會收到。規則細節見 src/game/trade.js、GAME_RULES.md。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './controls.js';
import { createItemPicker } from './itemPicker.js';
import { KNOWN_ITEMS } from './items.js';
import { teammates } from './giftSheet.js';
import { getRoomStatus, sendMail, tradeList, tradeRespond, onTradeChange, notifyTradeChange } from '../state/rollLog.js';
import { takeItems, refundItems } from '../game/mail.js';
import { payOffer, shortages, itemsText } from '../game/trade.js';
import { logActivity } from '../state/activityLog.js';

const KNOWN = new Set(KNOWN_ITEMS);
let cache = []; // 上一次查到的交易單（換分頁重畫時先用它，免得畫面空一下）

// ---------- 發起交易 ----------
export function openTradeSheet(getState, commit) {
  const ui = { to: '', picked: new Map(), wants: [{ name: '', qty: 1 }], busy: false };

  async function send(sendBtn) {
    const state = getState();
    const give = Object.fromEntries(ui.picked);
    const want = {};
    for (const w of ui.wants) {
      const name = w.name.trim();
      if (!name) continue;
      if (!Number.isInteger(w.qty) || w.qty < 1) return toast(`「${name}」的數量要是 1 以上的整數。`);
      want[name] = (want[name] ?? 0) + w.qty;
    }
    if (!ui.to) return toast('先選要跟誰交易。');
    if (!Object.keys(give).length) return toast('先點選你要給出的東西。');
    if (!Object.keys(want).length) return toast('請填你要對方拿什麼來換。');
    const odd = Object.keys(want).filter((n) => !KNOWN.has(n));
    if (odd.length && !confirm(`「${odd.join('、')}」不是已知的物品名稱，對方可能永遠湊不出來。仍要送出？`)) return undefined;
    if (!takeItems(state, give)) return toast('背包裡的數量不夠，請重新選。');
    ui.busy = true; sendBtn.disabled = true; sendBtn.textContent = '送出中…';
    commit();
    try {
      await sendMail({ to: ui.to, kind: 'trade', give, want });
      const who = teammates().find((m) => m.uid === ui.to)?.name ?? '對方';
      toast(`交易單已送給 ${who}，等對方回覆（你的東西已先押在單子上，隨時可以取消）。`);
      logActivity(state, { cat: 'item', text: `發起交易給 ${who}`, lines: [`給出：${itemsText(give)}`, `要換：${itemsText(want)}`] });
      closeSheet();
      notifyTradeChange();
    } catch (e) {
      refundItems(state, give); // 寄失敗：還回背包
      commit();
      ui.busy = false;
      toast(`沒有送出：${e.message}`);
      sendBtn.disabled = false; sendBtn.textContent = '🤝 送出交易單';
    }
    return undefined;
  }

  function body() {
    const state = getState();
    const mates = teammates();
    if (!mates.length) return h('p', { class: 'notice', text: '要登入並加入房間，而且房間裡有其他玩家，才能交易。' });
    const total = h('span', { class: 'gift-foot__n' });
    const sendBtn = h('button', { type: 'button', class: 'btn btn--primary btn--go', onclick: () => send(sendBtn) }, '🤝 送出交易單');
    const wantBox = h('div', { class: 'trade-wants' });
    function renderFoot() {
      const n = [...ui.picked.values()].reduce((a, b) => a + b, 0);
      total.textContent = ui.picked.size ? `給出 ${ui.picked.size} 種・共 ${fmt(n)} 件` : '先點選要給出的東西';
      sendBtn.disabled = ui.busy || !n;
    }
    function renderWants() {
      wantBox.replaceChildren(...ui.wants.map((w, i) => h('div', { class: 'trade-want' },
        h('input', { class: 'field', type: 'text', list: 'trade-known-items', placeholder: '物品名稱，例如 豪華蓋飯', value: w.name, 'aria-label': '對方要拿出的物品', oninput: (e) => { w.name = e.target.value; } }),
        h('input', { class: 'field gift-qty', type: 'number', min: 1, inputmode: 'numeric', value: w.qty, 'aria-label': '數量', onchange: (e) => { w.qty = Math.floor(Number(e.target.value)) || 0; } }),
        ui.wants.length > 1 ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': '移除這一項', onclick: () => { ui.wants.splice(i, 1); renderWants(); } }, '✕') : null)));
    }
    const picker = createItemPicker({ state, picked: ui.picked, onChange: renderFoot });
    if (!picker.owned.length) return h('p', { class: 'notice', text: '背包裡沒有可以拿來交易的東西（紀念品不能交易）。' });
    renderWants();
    return h('div', { class: 'giftsheet' },
      h('div', { class: 'gift-head' },
        h('label', { class: 'extra' }, h('span', { text: '交易對象' }),
          h('select', { class: 'field', 'aria-label': '跟誰交易', onchange: (e) => { ui.to = e.target.value; } },
            h('option', { value: '', text: '選擇玩家…' }),
            mates.map((m) => h('option', { value: m.uid, selected: ui.to === m.uid ? true : null, text: `${m.name}${m.online ? '' : '（離線）'}` })))),
        h('p', { class: 'field-label', text: '① 我要給出（點物品選取，選好數量）' }),
        picker.head),
      picker.grid,
      h('div', { class: 'trade-want-box' },
        h('p', { class: 'field-label', text: '② 我要對方拿出來換（名稱要和背包裡的一模一樣）' }),
        wantBox,
        h('datalist', { id: 'trade-known-items' }, KNOWN_ITEMS.map((n) => h('option', { value: n }))),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { ui.wants.push({ name: '', qty: 1 }); renderWants(); } }, '＋ 再加一項'),
        h('p', { class: 'hint', text: '你的東西送出時就先扣掉、押在交易單上。對方接受但東西不夠＝交易失敗，東西退回給你；對方拒絕或你取消也會退回。' })),
      h('div', { class: 'gift-foot' }, total, sendBtn));
  }

  openSheet('發起玩家交易', body, { tall: true });
}

// ---------- 交易頁的「玩家交易」分頁 ----------
export function createPlayerTradePanel({ getState, commit }) {
  const busy = new Set();
  const list = h('div', { class: 'trade-offers' });
  const root = h('div', { class: 'trade-panel' }, list);
  const me = () => getRoomStatus().me?.uid;
  let unsub = null;

  async function load() {
    if (getRoomStatus().phase !== 'online') return;
    try { cache = (await tradeList()).offers ?? []; } catch { /* 連線中斷：保留上次的 */ }
    if (!root.isConnected) { unsub?.(); unsub = null; return; } // 已經換分頁了
    draw();
  }

  async function respond(o, action) {
    if (busy.has(o.id)) return;
    busy.add(o.id);
    const state = getState();
    try {
      if (action === 'accept') {
        if (!confirm(`接受這筆交易？\n你要交出：${itemsText(o.want)}\n你會換到：${itemsText(o.give)}`)) return;
        const pay = payOffer(state, o);
        if (pay.error) { // 接受了但東西不夠：交易失敗，對方的東西退回去
          await tradeRespond(o.id, 'fail');
          toast(`交易失敗（${pay.error}），${o.fromName} 的東西已退回。`);
          logActivity(state, { cat: 'item', text: `玩家交易失敗：${o.fromName}`, lines: [pay.error] });
          return;
        }
        commit(); // 先扣自己的東西；伺服器不收就還回來
        try {
          await tradeRespond(o.id, 'accept');
        } catch (e) {
          refundItems(state, o.want);
          commit();
          toast(`交易沒有成功：${e.message}`);
          return;
        }
        logActivity(state, { cat: 'item', text: `玩家交易成功：${o.fromName}`, lines: [`付出：${itemsText(o.want)}`] });
        toast('交易成功！換到的東西稍後會出現在背包（右下角會有通知）。');
      } else if (action === 'reject') {
        if (!confirm(`拒絕 ${o.fromName} 的交易？東西會退回給對方。`)) return;
        await tradeRespond(o.id, 'reject');
        toast('已拒絕，東西退回給對方。');
      } else {
        if (!confirm(`取消給 ${o.toName} 的交易？東西會退回你的背包（稍後收到通知）。`)) return;
        await tradeRespond(o.id, 'cancel');
        toast('已取消，東西退回中。');
      }
    } catch (e) {
      toast(e.message || '操作失敗。');
    } finally {
      busy.delete(o.id);
      notifyTradeChange(); // 通知所有分頁重新查（接受時 commit() 會讓交易頁重畫，換了一個新的面板，要靠這個叫它更新）
    }
  }

  const line = (label, items) => h('p', { class: 'trade-offer__line' }, h('small', { text: label }), h('span', { text: itemsText(items) }));

  function incoming(o) {
    const state = getState();
    const lacks = shortages(state, o.want);
    return h('li', { class: 'trade-offer' },
      h('strong', { text: `${o.fromName} 向你提出交易` }),
      line('他給你', o.give),
      line('要你交出', o.want),
      h('p', { class: `trade-offer__have${lacks.length ? ' is-short' : ''}`, text: lacks.length ? `你的背包還不夠：${lacks.map((x) => `${x.name} ${fmt(x.have)}/${fmt(x.need)}`).join('、')}（接受會交易失敗）` : '你的背包夠付 ✓' }),
      h('div', { class: 'trade-offer__act' },
        h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => respond(o, 'accept') }, '接受'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => respond(o, 'reject') }, '拒絕')));
  }

  function outgoing(o) {
    return h('li', { class: 'trade-offer' },
      h('strong', { text: `你 → ${o.toName}（等對方回覆）` }),
      line('你給出（已先扣）', o.give),
      line('要對方交出', o.want),
      h('div', { class: 'trade-offer__act' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => respond(o, 'cancel') }, '取消交易（退回東西）')));
  }

  function draw() {
    if (getRoomStatus().phase !== 'online') {
      list.replaceChildren(h('p', { class: 'notice', text: '要登入並加入房間，才能和其他玩家交易。' }));
      return;
    }
    const mine = me();
    const ins = cache.filter((o) => o.to === mine);
    const outs = cache.filter((o) => o.from === mine);
    list.replaceChildren(
      h('section', { class: 'card' },
        h('h2', { class: 'section-title', text: '玩家交易' }),
        h('p', { class: 'hint', text: '指定一位玩家，用你的東西換他指定的東西。對方可以接受或拒絕；接受時他的東西不夠，交易失敗、你的東西退回。' }),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => openTradeSheet(getState, commit) }, '＋ 發起交易')),
      h('section', { class: 'card' },
        h('h2', { class: 'section-title', text: `收到的交易（${ins.length}）` }),
        ins.length ? h('ul', { class: 'trade-offers__list' }, ins.map(incoming)) : h('p', { class: 'empty', text: '目前沒有人向你提出交易。' })),
      h('section', { class: 'card' },
        h('h2', { class: 'section-title', text: `我發出的交易（${outs.length}）` }),
        outs.length ? h('ul', { class: 'trade-offers__list' }, outs.map(outgoing)) : h('p', { class: 'empty', text: '沒有等待回覆的交易。' })));
  }

  draw();
  unsub = onTradeChange(load);
  load();
  return root;
}
