// ============================================================
// 資源：生命、靈氣、魔力、算力、能量、鬥氣的「目前值」與消耗（試算表「消耗資源」欄）。
// 生命沿用 state.hp；其他放在 state.resources。最大值來自數值面板。
// 規則假設（需驗證）：以生命付費時，付完必須仍 > 0（不能靠付費把自己打到倒地）。
// ============================================================
import { RESOURCE_STATS } from './rules.js';
import { derivedStats } from './stats.js';
import { passivesOf, WITCH_EXTRA_COST } from './skills.js';

export const OTHER_RESOURCES = RESOURCE_STATS.filter((r) => r !== '生命');

export const resourceMax = (state, r) => derivedStats(state)[r].total;
export const resourceNow = (state, r) => (r === '生命' ? state.hp : state.resources?.[r] ?? 0);

export function setResource(state, r, v) {
  const max = resourceMax(state, r);
  const val = Math.max(0, Math.min(max, Math.floor(v)));
  if (r === '生命') state.hp = val;
  else state.resources = { ...state.resources, [r]: val };
}
export const restoreAllResources = (state) => RESOURCE_STATS.forEach((r) => setResource(state, r, resourceMax(state, r)));

/** 一個招式這次要付的資源（含魔女的額外 30 魔力）。extra = 追加的花費（例如域外魔祖 30 靈氣） */
export function actionCost(state, move, extra = {}) {
  const total = {};
  const add = (c) => Object.entries(c ?? {}).forEach(([k, v]) => { total[k] = (total[k] ?? 0) + v; });
  add(move.cost);
  add(extra);
  if (passivesOf(state).witch) add({ 魔力: WITCH_EXTRA_COST });
  return total;
}

/** 付得起嗎？回傳 null（付得起）或缺少什麼的說明 */
export function shortfall(state, cost) {
  const lacking = [];
  for (const [r, v] of Object.entries(cost)) {
    if (v <= 0) continue;
    const now = resourceNow(state, r);
    if (r === '生命' ? now - v <= 0 : now < v) lacking.push(`${r} ${now} / 需要 ${v}`);
  }
  return lacking.length ? lacking.join('；') : null;
}

export function pay(state, cost) {
  for (const [r, v] of Object.entries(cost)) if (v > 0) setResource(state, r, resourceNow(state, r) - v);
}

export const costText = (cost) =>
  Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) => `${v}${k}`).join(' + ') || '無';

/** 魔女：放棄主動動作，回復 30 魔力 */
export function witchRest(state) {
  if (!passivesOf(state).witch) return { error: '你沒有「魔女」技能。' };
  const before = resourceNow(state, '魔力');
  setResource(state, '魔力', before + WITCH_EXTRA_COST);
  return { gained: resourceNow(state, '魔力') - before, now: resourceNow(state, '魔力') };
}

/** 戰鬥結束時資源不會自動回復（回復規則尚未確認），只提供手動／回滿 */
