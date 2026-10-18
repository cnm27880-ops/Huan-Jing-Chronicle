// ============================================================
// 合成（純函式；GM 定案 2026-10-19，配方表在 rules.js 的 SYNTH_RECIPES）
// 強效藥水（調劑）、套餐（烹飪）。行為比照 special.js 的 craftSpecial：1D20 + 該生活技能加值 ≥ DC 成功，
// 一次檢定扣一份材料、失敗材料全毀、算一次修整檢定（扣修整胃袋次數）、不花時間與金幣；批次時每次各自擲骰，材料不足就停。
// 和特殊配方的差別：不算進 500 次製作徽章（不動 state.counters）。紀念品可以用（加值型；「非配方的困難」型與雙倍型不適用）。
// ============================================================
import { SYNTH_RECIPES } from './rules.js';
import { modifier, countOf, addItem, removeItem, consumeKeepsakes, tickRestStomach, d20 } from './engine.js';

/** 最多可以合成幾次（只看材料） */
export const synthMaxTimes = (state, name) =>
  Math.min(...Object.entries(SYNTH_RECIPES[name].materials).map(([item, n]) => Math.floor(countOf(state, item) / n)));

/** 合成 times 次；材料不足就停。回傳 { rolls, loot }（格式跟製作結果卡相同） */
export function craftSynth(state, name, times, keepsakes = [], rng = Math.random) {
  const r = SYNTH_RECIPES[name];
  if (!r) return { rolls: [], loot: {} };
  const rolls = [];
  const loot = {};
  for (let i = 0; i < times; i++) {
    if (synthMaxTimes(state, name) < 1) break;
    for (const [item, n] of Object.entries(r.materials)) removeItem(state, item, n);
    const kctx = { kind: 'synth' }; // 有難度限制的紀念品（非配方的困難製作）不適用
    const mod = modifier(state, r.skill, 'rest', keepsakes, kctx);
    const used = consumeKeepsakes(state, r.skill, keepsakes, kctx);
    const roll = d20(rng);
    const total = roll + mod.total;
    const success = total >= r.dc;
    const got = {};
    if (success) {
      addItem(state, name);
      got[name] = 1;
      loot[name] = (loot[name] ?? 0) + 1;
    }
    rolls.push({ roll, mod: mod.total, parts: mod.parts, total, dc: r.dc, success, got, used });
    tickRestStomach(state);
  }
  return { rolls, loot };
}
