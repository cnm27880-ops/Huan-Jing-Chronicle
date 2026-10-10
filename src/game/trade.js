// ============================================================
// 玩家交易（純函式）：A 先把要給的東西扣掉、押在伺服器的交易單上，B 拿指定的東西來換。
// 伺服器流程在 worker/src/room-core.js（tradeRespond）；這裡只管 B 這一端「付得起付不起」。
// 付不起（接受了但東西不夠）＝交易失敗，伺服器把 A 的東西退回去。紀念品不能交易（和送東西一樣）。
// ============================================================
import { countOf } from './engine.js';
import { giftable, takeItems } from './mail.js';

/** 寫成文字：「豪華蓋飯 ×10、鐵礦 ×5」 */
export const itemsText = (items) => Object.entries(items ?? {}).map(([name, n]) => `${name} ×${n}`).join('、');

/** 付不起的項目：[{ name, need, have }]（空陣列＝付得起） */
export const shortages = (state, want) => Object.entries(want ?? {})
  .map(([name, need]) => ({ name, need, have: giftable(state, name) ? countOf(state, name) : 0 }))
  .filter((x) => x.have < x.need);

/** B 接受交易：從 B 的背包扣掉 want。成功回傳 { ok: true }；東西不夠回傳 { error, lacks }（什麼都不扣） */
export function payOffer(state, offer) {
  const lacks = shortages(state, offer.want);
  if (lacks.length || !takeItems(state, offer.want)) {
    return { error: `東西不夠：${lacks.map((x) => `${x.name} 需要 ${x.need}、只有 ${x.have}`).join('；') || itemsText(offer.want)}`, lacks };
  }
  return { ok: true };
}
