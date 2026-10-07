// ============================================================
// 數值面板：基礎（技能累積）+ 裝備 + 食物（跑團胃袋）
// 戰鬥與擲骰都從這裡拿數值，畫面也從這裡拿「明細」
// ============================================================
import { ALL_STATS, FOOD_STATS } from './rules.js';
import { equipmentEffects } from './equipment.js';
import { passivesOf } from './skills.js';

/** 跑團胃袋提供的數值 */
export function foodEffects(stomach) {
  const out = {};
  for (const s of stomach) {
    for (const [k, v] of Object.entries(FOOD_STATS[s.food] ?? {})) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/**
 * 回傳每個屬性：{ total, parts:[{label,value}] }
 * 基礎值 state.baseStats 不含裝備與食物（GM 試算表的面板已含，匯入時要先扣掉）
 */
export function derivedStats(state) {
  const eq = equipmentEffects(state);
  const food = foodEffects(state.sessionStomach);
  const out = {};
  for (const stat of ALL_STATS) {
    const parts = [
      { label: '基礎', value: state.baseStats[stat] ?? 0 },
      { label: '裝備', value: eq[stat] ?? 0 },
      { label: '食物', value: food[stat] ?? 0 },
    ].filter((p, i) => i === 0 || p.value !== 0);
    out[stat] = { total: parts.reduce((a, p) => a + p.value, 0), parts };
  }
  // 暴徒（試算表手改公式）：物理傷害面板照留，但能量與靈魂各加 ROUNDUP(物理 ÷ 2)；攻擊時不能用物理（見 combat.js）
  if (passivesOf(state).brute) {
    const half = Math.ceil(out.物理傷害.total / 2);
    for (const stat of ['能量傷害', '靈魂傷害']) {
      out[stat].parts.push({ label: '暴徒（物理的一半）', value: half });
      out[stat].total += half;
    }
  }
  // 生生造化印：護盾存在時，額外抗性免疫（護盾被打破就消失）
  if (state.shield?.hp > 0 && state.shield.res > 0) {
    out.抗性免疫.parts.push({ label: '生生造化印', value: state.shield.res });
    out.抗性免疫.total += state.shield.res;
  }
  return out;
}

export const maxHp = (state) => derivedStats(state).生命.total;
