// ============================================================
// 玩家交易（純函式）：A 先把要給的東西（物品與／或金幣）扣掉、押在伺服器的交易單上，B 拿指定的東西（物品與／或金幣）來換。
// 伺服器流程在 worker/src/room-core.js（tradeRespond）；這裡只管兩端「付得起付不起」。
// 付不起（接受了但東西或金幣不夠）＝交易失敗，伺服器把 A 押的退回去。紀念品不能交易（和送東西一樣）。
// 交易單的格式：{ give, giveGold, want, wantGold }（give／want 是 { 物品名: 數量 }，金幣是整數，沒有就是 0）。
// ============================================================
import { countOf } from './engine.js';
import { giftable, takeItems, refundItems } from './mail.js';

/** 物品挑選器與交易單的「要換什麼」裡，金幣用這個名字當成一種物品（同名的物品不存在）；送出前用 splitGold 拆開 */
export const GOLD_NAME = '金幣';
/** 把 { 名稱: 數量 }（可能含「金幣」）拆成 { items: 不含金幣的物品, gold: 金幣數 } */
export function splitGold(picked) {
  const items = {};
  let gold = 0;
  for (const [name, n] of picked instanceof Map ? picked : Object.entries(picked ?? {})) {
    if (name === GOLD_NAME) gold += n; else items[name] = (items[name] ?? 0) + n;
  }
  return { items, gold };
}

/** 寫成文字：「豪華蓋飯 ×10、鐵礦 ×5、金幣 500」 */
export const itemsText = (items, gold = 0) => [
  ...Object.entries(items ?? {}).map(([name, n]) => `${name} ×${n}`),
  ...(gold > 0 ? [`金幣 ${gold.toLocaleString('zh-TW')}`] : []),
].join('、');

const hasItems = (items) => Object.keys(items ?? {}).length > 0;

/** 付不起的項目：[{ name, need, have }]（空陣列＝付得起；金幣的 name 是「金幣」） */
export const shortages = (state, want, wantGold = 0) => [
  ...Object.entries(want ?? {})
    .map(([name, need]) => ({ name, need, have: giftable(state, name) ? countOf(state, name) : 0 }))
    .filter((x) => x.have < x.need),
  ...(wantGold > (state.gold ?? 0) ? [{ name: '金幣', need: wantGold, have: state.gold ?? 0 }] : []),
];

/** 把一方要出的東西（物品＋金幣）從背包與錢包扣掉。扣得動回傳 true；任何一樣不夠就什麼都不扣、回傳 false */
export function takeOffer(state, items, gold = 0) {
  if (shortages(state, items, gold).length) return false;
  if (hasItems(items) && !takeItems(state, items)) return false;
  state.gold -= gold;
  return true;
}
/** takeOffer 的反向：寄失敗或交易失敗時還回去 */
export function refundOffer(state, items, gold = 0) {
  if (hasItems(items)) refundItems(state, items);
  state.gold += gold;
}

/** B 接受交易：從 B 扣掉 want（物品＋金幣）。成功回傳 { ok: true }；不夠回傳 { error, lacks }（什麼都不扣） */
export function payOffer(state, offer) {
  const lacks = shortages(state, offer.want, offer.wantGold ?? 0);
  if (lacks.length || !takeOffer(state, offer.want, offer.wantGold ?? 0)) {
    return { error: `東西不夠：${lacks.map((x) => `${x.name} 需要 ${x.need.toLocaleString('zh-TW')}、只有 ${x.have.toLocaleString('zh-TW')}`).join('；') || itemsText(offer.want, offer.wantGold)}`, lacks };
  }
  return { ok: true };
}
