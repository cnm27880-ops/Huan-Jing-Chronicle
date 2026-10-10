// ============================================================
// 玩家交易的「待回覆」清單（背包頁「贈送／交易」面板的第三個分頁，面板在 src/ui/giftSheet.js）：A 指定一位玩家，用自己的東西／金幣換對方指定的。
//   發起：在面板切到「交易」：A 挑要給的東西（先從背包扣、押在伺服器的交易單上）＋填對方要拿出的東西 → 對方在「待回覆」看到
//   對方回覆：接受（他的東西夠才成交）／拒絕；接受時東西不夠＝交易失敗，A 的東西退回；A 也可以自己取消
//   成交或退回的東西都走一般信箱（src/state/mailbox.js），上線就會收到。規則細節見 src/game/trade.js、GAME_RULES.md。
// ============================================================
import { h, fmt } from './dom.js';
import { toast } from './controls.js';
import { getRoomStatus, tradeList, tradeRespond, onTradeChange, notifyTradeChange } from '../state/rollLog.js';
import { payOffer, shortages, itemsText, refundOffer } from '../game/trade.js';
import { logActivity } from '../state/activityLog.js';

let cache = []; // 上一次查到的交易單（換分頁重畫時先用它，免得畫面空一下）

/** 還沒回覆的、別人向我提出的交易單數量（用上次查到的資料） */
export const incomingCount = () => cache.filter((o) => o.to === getRoomStatus().me?.uid).length;
/** 重新查一次交易單（回傳 true 代表資料有更新） */
export async function refreshTrades() {
  if (getRoomStatus().phase !== 'online') return false;
  try { cache = (await tradeList()).offers ?? []; return true; } catch { return false; }
}

// ---------- 待回覆清單 ----------
export function createOffersView({ getState, commit }) {
  const busy = new Set();
  const list = h('div', { class: 'trade-offers' });
  const root = h('div', { class: 'trade-panel' }, list);
  const me = () => getRoomStatus().me?.uid;
  let unsub = null;

  async function load() {
    if (getRoomStatus().phase !== 'online') return;
    await refreshTrades(); // 連線中斷時保留上次的
    if (!root.isConnected) { unsub?.(); unsub = null; return; } // 已經換分頁了
    draw();
  }

  async function respond(o, action) {
    if (busy.has(o.id)) return;
    busy.add(o.id);
    const state = getState();
    try {
      if (action === 'accept') {
        if (!confirm(`接受這筆交易？\n你要交出：${itemsText(o.want, o.wantGold)}\n你會換到：${itemsText(o.give, o.giveGold)}`)) return;
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
          refundOffer(state, o.want, o.wantGold);
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

  const line = (label, items, gold) => h('p', { class: 'trade-offer__line' }, h('small', { text: label }), h('span', { text: itemsText(items, gold) || '（沒有）' }));

  function incoming(o) {
    const state = getState();
    const lacks = shortages(state, o.want, o.wantGold);
    return h('li', { class: 'trade-offer' },
      h('strong', { text: `${o.fromName} 向你提出交易` }),
      line('他給你', o.give, o.giveGold),
      line('要你交出', o.want, o.wantGold),
      h('p', { class: `trade-offer__have${lacks.length ? ' is-short' : ''}`, text: lacks.length ? `你的背包還不夠：${lacks.map((x) => `${x.name} ${fmt(x.have)}/${fmt(x.need)}`).join('、')}（接受會交易失敗）` : '你的背包夠付 ✓' }),
      h('div', { class: 'trade-offer__act' },
        h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => respond(o, 'accept') }, '接受'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => respond(o, 'reject') }, '拒絕')));
  }

  function outgoing(o) {
    return h('li', { class: 'trade-offer' },
      h('strong', { text: `你 → ${o.toName}（等對方回覆）` }),
      line('你給出（已先扣）', o.give, o.giveGold),
      line('要對方交出', o.want, o.wantGold),
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
