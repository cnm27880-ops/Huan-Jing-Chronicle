// ============================================================
// 抽取技能書（純函式，RULES_OVERVIEW 5.1）：初階／進階／大師／傳說技能書用掉後，
// 每本出現「3 個技能選 1」；可以先開多本再一一選；選完之前不能做其他事（畫面端檢查 hasPendingDraw）。
// 選到的技能以「技能名稱」的技能書進背包（學習時要 3 本同名，見 skillTable.js）。
// 技能池 = 技能目錄裡同位階、非個人專屬的技能（清單是否與機器人一致需驗證）。
// ============================================================
import { SKILL_TABLE } from '../data/skills.js';
import { countOf, removeItem, addItem } from './engine.js';

export const DRAW_TIERS = ['初階', '進階', '大師', '傳說'];
export const DRAW_CHOICES = 3;
export const MAX_DRAW_AT_ONCE = 20;

export const drawPool = (tier) => Object.keys(SKILL_TABLE).filter((n) => SKILL_TABLE[n].tier === tier && !SKILL_TABLE[n].personal);
export const hasPendingDraw = (state) => (state.pendingDraws?.length ?? 0) > 0;

/** 用掉 times 本 tier 技能書，產生 times 組選項放進 state.pendingDraws */
export function drawBooks(state, tier, times, rng = Math.random) {
  if (!DRAW_TIERS.includes(tier)) return { ok: false, error: '這個位階不能抽取。' };
  if (hasPendingDraw(state)) return { ok: false, error: '還有沒選完的抽取結果，先選完。' };
  const n = Math.floor(Number(times)) || 0;
  const book = `${tier}技能書`;
  if (n < 1 || n > MAX_DRAW_AT_ONCE) return { ok: false, error: `一次抽 1～${MAX_DRAW_AT_ONCE} 本。` };
  if (countOf(state, book) < n) return { ok: false, error: `${book}不夠。` };
  const pool = drawPool(tier);
  removeItem(state, book, n);
  state.pendingDraws = Array.from({ length: n }, () => {
    const left = [...pool];
    const options = [];
    while (options.length < DRAW_CHOICES && left.length) options.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
    return { tier, options };
  });
  return { ok: true, count: n };
}

/** 從第 index 組選項選一個技能：拿到該技能的技能書 */
export function chooseDraw(state, index, name) {
  const d = state.pendingDraws?.[index];
  if (!d || !d.options.includes(name)) return { ok: false, error: '沒有這個選項。' };
  addItem(state, name);
  state.pendingDraws = state.pendingDraws.filter((_, i) => i !== index);
  return { ok: true, name };
}
