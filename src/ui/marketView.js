// ============================================================
// 交易頁：交易大廳、黑市、特殊黑市（玩家之間的交易在背包頁的「贈送／交易」面板；規則見 GAME_RULES.md「交易」，計算在 src/game/market.js）
// 黑市要擲骰：走 rollWith（房間模式由伺服器擲），結果用 publish 發到擲骰紀錄，大家都看得到。
// 另外匯出 openGearSellSheet：裝備頁「賣出」已鑑定裝備時用。
// ============================================================
import { h, fmt } from './dom.js';
import { toast, rollFailed, rarityTag } from './controls.js';
import { iconOf, rarityOf, plainName } from './items.js';
import { openSheet } from './sheet.js';
import { countOf } from '../game/engine.js';
import { gearName, effectText } from '../game/equipment.js';
import { MAX_TIME } from '../game/rules.js';
import {
  VOUCHER, HALL_DAILY_LIMIT, HALL_BUY, HALL_SELL, BLACK_BUY, BLACK_SELL, BLACK_BUY_DICE, BLACK_SELL_DICE,
  LABOR_GOLD_PER_TIME, VOUCHER_EXCHANGE_DAILY, SPECIAL_BUY, SPECIAL_SELL, SPECIAL_SESSION_LIMIT,
  marketToday, hallLeft, exchangeLeft, specialLeft, hallQuote, hallTrade, blackBuy, blackSell,
  exchangeVouchers, setBlackSession, specialTrade, gearPriceName,
} from '../game/market.js';
import { publish, rollWith } from '../state/rollLog.js';
import { logActivity } from '../state/activityLog.js';

const diceText = (d) => `${d.n}D${d.sides}+${d.add}`;
const BUY_MIN = (BLACK_BUY_DICE.n + BLACK_BUY_DICE.add + 10) / 10; // ×1.3
const BUY_MAX = (BLACK_BUY_DICE.n * BLACK_BUY_DICE.sides + BLACK_BUY_DICE.add + 10) / 10; // ×2.2
const SELL_MIN = (BLACK_SELL_DICE.n + BLACK_SELL_DICE.add) / 10; // ×0.4
const SELL_MAX = (BLACK_SELL_DICE.n * BLACK_SELL_DICE.sides + BLACK_SELL_DICE.add) / 10; // ×1.0

// ---------- 擲骰的交易：發布到擲骰紀錄 ----------
async function doBlackBuy(state, item, qty, commit) {
  let r;
  let draw;
  try { ({ r, draw } = await rollWith(state, (st, rng) => blackBuy(st, item, qty, rng))); } catch (e) { return rollFailed(e); }
  if (r.error) return toast(r.error);
  publish({
    who: state.name, kind: 'deal', label: `黑市購買 ${item} ×${fmt(qty)}`, big: `${fmt(r.total)} 金幣`,
    tone: r.labor ? 'fail' : undefined,
    lines: [
      `${diceText(BLACK_BUY_DICE)} → ${r.roll}（溢價 ×${r.rate}）`,
      `${fmt(r.unit)} × ${fmt(qty)} × ${r.rate} = ${fmt(r.total)} 金幣`,
      r.labor ? `付不出錢：付了 ${fmt(r.paid)} 金幣，強制勞動 ${r.labor} 時間抵債（時間剩 ${state.time}）` : null,
    ].filter(Boolean),
  }, { draw });
  toast(r.labor ? `金幣不夠，勞動抵債 ${r.labor} 時間` : `花了 ${fmt(r.total)} 金幣`);
  logActivity(state, { cat: 'item', text: `黑市購買 ${item} ×${fmt(qty)}，${fmt(r.total)} 金幣`, lines: [`溢價 ×${r.rate}`, r.labor ? `付不起，勞動抵債 ${r.labor} 時間` : ''].filter(Boolean) });
  commit();
}

async function doBlackSell(state, item, qty, commit, gearIds = null) {
  let r;
  let draw;
  try { ({ r, draw } = await rollWith(state, (st, rng) => blackSell(st, item, qty, rng, gearIds))); } catch (e) { return rollFailed(e); }
  if (r.error) return toast(r.error);
  publish({
    who: state.name, kind: 'deal', label: `黑市販賣 ${item} ×${fmt(qty)}`, big: `${fmt(r.total)} 代金券`,
    lines: [`${diceText(BLACK_SELL_DICE)} → ${r.roll}（壓價 ×${r.rate}）`, `${fmt(r.unit)} × ${fmt(qty)} × ${r.rate} = ${fmt(r.total)} 代金券`],
  }, { draw });
  toast(`得到 ${fmt(r.total)} 代金券`);
  logActivity(state, { cat: 'item', text: `黑市販賣 ${item} ×${fmt(qty)}，${fmt(r.total)} 代金券`, lines: [`壓價 ×${r.rate}`] });
  commit();
}

function doHall(state, side, item, qty, commit, gearIds = null) {
  const r = hallTrade(state, side, item, qty, gearIds);
  if (r.error) return toast(r.error);
  toast(`${side === 'buy' ? '花了' : '得到'} ${fmt(r.total)} 金幣${r.black ? `（其中 ${r.black} 個黑心價）` : ''}`);
  logActivity(state, { cat: 'item', text: `交易大廳${side === 'buy' ? '購買' : '賣出'} ${item} ×${fmt(qty)}，${fmt(r.total)} 金幣`, lines: r.black ? [`其中 ${r.black} 個黑心價`] : [] });
  commit();
}

function doSpecial(state, side, item, qty, commit, gearIds = null) {
  const r = specialTrade(state, side, item, qty, gearIds);
  if (r.error) return toast(r.error);
  toast(`${side === 'buy' ? '花了' : '得到'} ${fmt(r.total)} 代金券`);
  logActivity(state, { cat: 'item', text: `特殊黑市${side === 'buy' ? '購買' : '販賣'} ${item} ×${fmt(qty)}，${fmt(r.total)} 代金券`, lines: [`本次黑市團還能交易 ${specialLeft(state)} 個`] });
  commit();
}

/** 裝備頁：賣出一件已鑑定裝備（照等級的通用價） */
export function openGearSellSheet(state, g, commit) {
  const name = gearPriceName(g);
  openSheet(`賣出 ${gearName(g)}`, (close) => {
    const done = () => { close(); };
    const hall = HALL_SELL[name];
    const black = BLACK_SELL[name];
    const special = SPECIAL_SELL[name];
    const open = marketToday(state).session.open;
    const opt = (title, desc, enabled, onclick, note) => h('div', { class: 'sell-opt', 'aria-disabled': String(!enabled) },
      h('div', { class: 'sell-opt__text' }, h('strong', { text: title }), h('small', { text: desc }), note ? h('small', { class: 'sell-opt__note', text: note }) : null),
      h('button', { type: 'button', class: 'btn btn--primary btn--small', disabled: !enabled, onclick: () => { onclick(); done(); } }, '賣出'));
    return h('div', { class: 'sell-sheet' },
      h('p', { class: 'hint', text: `${effectText(g)}　價目表以「${name}」計價。賣出後就沒了。` }),
      g.gem ? h('p', { class: 'notice notice--bad', text: '鑲了寶石的裝備不能賣。' }) : null,
      opt('交易大廳', hall ? `${hallLeft(state) > 0 ? `原價 ${hall[0]}` : `黑心價 ${hall[1]}`} 金幣（今天原價還剩 ${hallLeft(state)} 個）` : '不收這個等級',
        Boolean(hall) && !g.gem, () => doHall(state, 'sell', name, 1, commit, [g.id])),
      opt('黑市', black ? `擲 ${diceText(BLACK_SELL_DICE)}：${fmt(Math.floor(black * SELL_MIN))}～${fmt(Math.floor(black * SELL_MAX))} 代金券` : '不收這個等級',
        Boolean(black) && !g.gem, () => doBlackSell(state, name, 1, commit, [g.id])),
      opt('特殊黑市', special ? `${fmt(special)} 代金券（固定價）` : '不收這個等級',
        Boolean(special) && open && specialLeft(state) > 0 && !g.gem, () => doSpecial(state, 'sell', name, 1, commit, [g.id]),
        special && !open ? '只在黑市團期間開放（到「交易」頁打開黑市團）' : null));
  });
}

export function createMarketView({ root, getState, commit }) {
  const ui = { tab: 'hall', qty: {} };
  const qtyOf = (key) => ui.qty[key] ?? 1;

  /** 一列商品：圖示、名稱、稀有度、價格說明、數量、按鈕。改數量時只更新這一列（不重畫整頁） */
  function row(state, { key, item, have, price, sub, max, button, onGo, disabled }) {
    const clamp = (n) => Math.max(1, Math.min(Math.floor(Number(n)) || 1, Number.isFinite(max) ? Math.max(1, max) : Infinity));
    const q = clamp(qtyOf(key));
    const tier = rarityOf(item);
    const subEl = sub ? h('small', { class: 'trade-row__sub', text: sub(q) }) : null;
    const btn = h('button', {
      type: 'button', class: 'btn btn--primary btn--small', disabled: disabled || (max != null && max < 1),
      onclick: () => onGo(clamp(qtyOf(key))),
    }, button(q));
    return h('li', { class: `trade-row${tier !== null ? ' rarity' : ''}`, dataset: { tier: tier ?? 'none', rarity: tier ?? 'none' } },
      h('span', { class: 'trade-row__icon', 'aria-hidden': 'true', text: iconOf(item) }),
      h('div', { class: 'trade-row__info' },
        h('strong', { class: 'rarity__name', text: plainName(item) }),
        rarityTag(tier),
        have != null ? h('small', { class: 'trade-row__have', text: `持有 ${fmt(have)}` }) : null,
        h('span', { class: 'trade-row__price', text: price }),
        subEl),
      h('div', { class: 'trade-row__act' },
        h('input', {
          class: 'field trade-row__qty', type: 'number', inputmode: 'numeric', min: 1, max: Number.isFinite(max) ? max : null, value: q,
          'aria-label': `${item} 數量`,
          oninput: (e) => {
            const n = clamp(e.target.value);
            ui.qty[key] = n;
            if (subEl) subEl.textContent = sub(n);
            btn.textContent = button(n);
          },
        }),
        btn));
  }

  const list = (rows) => (rows.length ? h('ul', { class: 'trade-list' }, rows) : h('p', { class: 'empty', text: '背包裡沒有可以賣的東西。' }));
  const section = (title, hint, ...children) => h('section', { class: 'card' },
    h('h2', { class: 'section-title', text: title }), ...children);

  /** 已鑑定裝備：數量提示（到裝備頁一件件賣） */
  function gearHint(state, table) {
    const n = state.gear.filter((g) => table[gearPriceName(g)] && !g.gem).length;
    return n ? h('p', { class: 'hint', text: `另有 ${n} 件已鑑定裝備可以賣：到「裝備」頁的背包裝備按「賣出」。` }) : null;
  }

  function hallPane(state) {
    const left = hallLeft(state);
    return [
      section('交易大廳・購買', `每天原價買＋賣合計 ${HALL_DAILY_LIMIT} 個，今天還剩 ${left} 個；超過的自動用黑心價。`,
        list(Object.entries(HALL_BUY).map(([item, [n, b]]) => row(state, {
          key: `hb:${item}`, item, have: countOf(state, item), price: `原價 ${n}　黑心價 ${b} 金幣`,
          sub: (q) => `共 ${fmt(hallQuote(state, 'buy', item, q).total)} 金幣`,
          button: (q) => `買 ${q}`, onGo: (q) => doHall(state, 'buy', item, q, commit),
        })))),
      section('交易大廳・販賣', '收到的是金幣。',
        list(Object.entries(HALL_SELL).filter(([item]) => countOf(state, item) > 0).map(([item, [n, b]]) => row(state, {
          key: `hs:${item}`, item, have: countOf(state, item), max: countOf(state, item), price: `原價 ${n}　黑心價 ${b} 金幣`,
          sub: (q) => `共 ${fmt(hallQuote(state, 'sell', item, q).total)} 金幣`,
          button: (q) => `賣 ${q}`, onGo: (q) => doHall(state, 'sell', item, q, commit),
        }))),
        gearHint(state, HALL_SELL)),
    ];
  }

  function blackPane(state) {
    const vouchers = countOf(state, VOUCHER);
    const canEx = Math.min(exchangeLeft(state), vouchers);
    return [
      section('黑市・購買', `付金幣。成交價 = 買價 × 數量 ×（1 + ${diceText(BLACK_BUY_DICE)} 成），也就是 ×${BUY_MIN}～×${BUY_MAX}。付不出錢就強制勞動抵債：1 時間 = ${LABOR_GOLD_PER_TIME} 金幣（時間可以變負的，換日時先還）。`,
        list(Object.entries(BLACK_BUY).map(([item, unit]) => row(state, {
          key: `bb:${item}`, item, have: countOf(state, item), price: `買價 ${unit} 金幣`,
          sub: (q) => `約 ${fmt(Math.ceil(unit * q * BUY_MIN))}～${fmt(Math.ceil(unit * q * BUY_MAX))} 金幣`,
          button: (q) => `擲骰買 ${q}`, onGo: (q) => doBlackBuy(state, item, q, commit),
        })))),
      section('黑市・販賣', `收到的是代金券。成交價 = 賣價 × 數量 × ${diceText(BLACK_SELL_DICE)} 成，也就是 ×${SELL_MIN}～×${SELL_MAX}。`,
        list(Object.entries(BLACK_SELL).filter(([item]) => countOf(state, item) > 0).map(([item, unit]) => row(state, {
          key: `bs:${item}`, item, have: countOf(state, item), max: countOf(state, item), price: `賣價 ${unit} 代金券`,
          sub: (q) => `約 ${fmt(Math.floor(unit * q * SELL_MIN))}～${fmt(Math.floor(unit * q * SELL_MAX))} 代金券`,
          button: (q) => `擲骰賣 ${q}`, onGo: (q) => doBlackSell(state, item, q, commit),
        }))),
        gearHint(state, BLACK_SELL)),
      section('代金券換金幣', `每天最多 ${fmt(VOUCHER_EXCHANGE_DAILY)} 張，1 比 1。今天還能換 ${fmt(exchangeLeft(state))} 張。`,
        h('ul', { class: 'trade-list' }, row(state, {
          key: 'ex', item: VOUCHER, have: vouchers, max: canEx, price: '1 張 = 1 金幣',
          button: (q) => `換 ${fmt(q)}`, disabled: canEx < 1,
          onGo: (q) => { const r = exchangeVouchers(state, q); if (r.error) return toast(r.error); toast(`換到 ${fmt(q)} 金幣`); logActivity(state, { cat: 'item', text: `代金券換金幣：${fmt(q)} 張`, lines: [] }); commit(); },
        }))),
    ];
  }

  function specialPane(state) {
    const open = marketToday(state).session.open;
    const left = specialLeft(state);
    if (!open) {
      return [section('特殊黑市', '只在黑市團期間開放。GM 宣布黑市團開始時，按上方的「黑市團」開關。',
        h('p', { class: 'notice', text: '目前不是黑市團。' }))];
    }
    return [
      section('特殊黑市・購買', `固定價，付代金券。本次黑市團買＋賣合計 ${SPECIAL_SESSION_LIMIT} 個，還剩 ${left} 個。`,
        list(Object.entries(SPECIAL_BUY).map(([item, unit]) => row(state, {
          key: `sb:${item}`, item, have: countOf(state, item), max: left, price: `${fmt(unit)} 代金券`,
          sub: (q) => `共 ${fmt(unit * q)} 代金券`, button: (q) => `買 ${q}`, onGo: (q) => doSpecial(state, 'buy', item, q, commit),
        })))),
      section('特殊黑市・販賣', '收到的是代金券（固定價）。',
        list(Object.entries(SPECIAL_SELL).filter(([item]) => countOf(state, item) > 0).map(([item, unit]) => row(state, {
          key: `ss:${item}`, item, have: countOf(state, item), max: Math.min(left, countOf(state, item)), price: `${fmt(unit)} 代金券`,
          sub: (q) => `共 ${fmt(unit * q)} 代金券`, button: (q) => `賣 ${q}`, onGo: (q) => doSpecial(state, 'sell', item, q, commit),
        }))),
        gearHint(state, SPECIAL_SELL)),
    ];
  }

  function hud(state) {
    const m = marketToday(state);
    const stat = (label, value, tone) => h('span', { class: 'mk-stat', dataset: { tone: tone ?? '' } }, h('small', { text: label }), h('strong', { class: 'num', text: value }));
    return h('div', { class: 'mk-hud' },
      stat('金幣', fmt(state.gold)),
      stat('代金券', fmt(countOf(state, VOUCHER))),
      stat('時間', `${state.time} / ${MAX_TIME}`, state.time < 0 ? 'bad' : ''),
      stat('今日原價', `${hallLeft(state)} / ${HALL_DAILY_LIMIT}`),
      stat('今日可換', `${fmt(exchangeLeft(state))}`),
      h('label', { class: `mk-session${m.session.open ? ' is-on' : ''}` },
        h('input', {
          type: 'checkbox', checked: m.session.open ? true : null,
          onchange: (e) => {
            if (e.target.checked && !confirm('開始黑市團？本團的特殊黑市交易數會從 0 開始算（上限 50 個）。')) { e.target.checked = false; return; }
            setBlackSession(state, e.target.checked); commit();
          },
        }),
        h('span', { text: m.session.open ? `黑市團中（剩 ${specialLeft(state)}）` : '黑市團' })));
  }

  function render() {
    const state = getState();
    const tabs = [['hall', '交易大廳'], ['black', '黑市'], ['special', '特殊黑市']];
    const pane = ui.tab === 'hall' ? hallPane(state) : ui.tab === 'black' ? blackPane(state) : specialPane(state);
    const scrollY = root.scrollTop;
    root.replaceChildren(
      h('div', { class: 'mk-root' },
        hud(state),
        h('div', { class: 'rest-tabs mk-tabs', role: 'tablist', 'aria-label': '交易' },
          tabs.map(([id, label]) => h('button', {
            type: 'button', role: 'tab', class: 'rest-tab', 'aria-selected': String(ui.tab === id),
            onclick: () => { ui.tab = id; render(); },
          }, h('span', { class: 'rest-tab__name', text: label })))),
        h('div', { class: 'mk-grid' }, pane)));
    root.scrollTop = scrollY;
  }

  return { render };
}

