// ============================================================
// 送東西與餵藥（純函式）。對方不用同意：寄的人先扣、對方領取時直接加進自己的背包（或套用藥水）。
// 伺服器只轉交與暫存（worker/src/room-core.js 的信箱），東西的增減都在各自的瀏覽器裡。
// ============================================================
import { addItem, removeItem, countOf } from './engine.js';
import { POTIONS, TOXICITY_MAX } from './rules.js';
import { healPlayer, isDowned } from './combat.js';
import { maxHp } from './stats.js';

/** 可以送的東西：背包裡有的；紀念品是玩家自己的特色（有專屬說明），不送 */
export const giftable = (state, name) => countOf(state, name) > 0 && !state.keepsakes?.[name];

/** 寄出前先把東西從背包扣掉（任何一樣不夠就一樣都不扣，回傳 false）。寄失敗時用 refundItems 還回去 */
export function takeItems(state, items) {
  const entries = Object.entries(items);
  if (!entries.length || entries.some(([name, n]) => !Number.isInteger(n) || n < 1 || !giftable(state, name) || countOf(state, name) < n)) return false;
  for (const [name, n] of entries) removeItem(state, name, n);
  return true;
}
export const refundItems = (state, items) => Object.entries(items).forEach(([name, n]) => addItem(state, name, n));

/**
 * 收到信件：套用到自己的角色。mail = 伺服器給的 { id, from, fromName, kind, items | potion, heal }
 * 回傳 { title, lines, bounce? }：bounce = 要退回給寄件人的東西（例如毒性已滿喝不下的藥水）
 */
export function applyMail(state, mail) {
  const from = mail.fromName || '某位玩家';
  if (mail.kind === 'gift') {
    const entries = Object.entries(mail.items ?? {}).filter(([name, n]) => typeof name === 'string' && Number.isInteger(n) && n > 0);
    for (const [name, n] of entries) addItem(state, name, n);
    return {
      title: mail.bounced ? `${from} 退回了東西` : `${from} 送給你東西`,
      lines: entries.map(([name, n]) => `${name} ×${n}`),
    };
  }
  if (mail.kind === 'potion') {
    const def = POTIONS[mail.potion];
    if (!def?.heal || !Number.isInteger(mail.heal) || mail.heal < 0) return { title: `${from} 餵你的藥水無法使用`, lines: [] };
    if (state.toxicity + def.toxicity > TOXICITY_MAX) { // 領取時毒性已滿：不喝，藥水退回給對方
      return {
        title: `${from} 想餵你 ${mail.potion}`,
        lines: [`你的毒性 ${state.toxicity}，喝了會超過 ${TOXICITY_MAX}，已把藥水退回給對方。`],
        bounce: { to: mail.from, items: { [mail.potion]: 1 } },
      };
    }
    const wasDowned = isDowned(state);
    const before = state.hp;
    state.toxicity += def.toxicity;
    healPlayer(state, mail.heal);
    return {
      title: `${from} 餵你喝了 ${mail.potion}`,
      lines: [
        `回復 ${state.hp - before} 生命${wasDowned && !isDowned(state) ? '，你站起來了！' : ''}`,
        `毒性 ${state.toxicity} / ${TOXICITY_MAX}`,
      ],
    };
  }
  if (mail.kind === 'support') { // 隊友對你施放補血／護盾技能：照「你自己的最大生命」算百分比
    const pct = Number(mail.pct);
    if (!['heal', 'shield'].includes(mail.support) || !Number.isFinite(pct) || pct <= 0 || pct > 100) return { title: `${from} 的技能無法使用`, lines: [] };
    const amount = Math.floor((maxHp(state) * pct) / 100);
    const skill = String(mail.skill ?? '技能');
    if (mail.support === 'heal') {
      const wasDowned = isDowned(state);
      const before = state.hp;
      healPlayer(state, amount);
      return { title: `${from} 對你施放了 ${skill}`, lines: [`回復 ${state.hp - before} 生命（最大生命 ${pct}%）${wasDowned && !isDowned(state) ? '，你站起來了！' : ''}`] };
    }
    const res = Number.isInteger(mail.res) && mail.res > 0 ? mail.res : 0;
    state.shield = { hp: amount, res }; // 不可疊加：取代舊護盾
    return { title: `${from} 對你施放了 ${skill}`, lines: [`獲得護盾 ${amount}（最大生命 ${pct}%）${res ? `，抗性免疫 +${res}（護盾破了才消失）` : ''}`] };
  }
  return { title: `${from} 寄來不明的東西`, lines: [] };
}
