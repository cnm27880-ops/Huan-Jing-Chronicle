// ============================================================
// 生活技能徽章（純函式）：每個生活技能各有兩種——「初次達到神級」與「累計 500 次」。
// 達標後可以自己製作（各只能一次），製作當下該生活技能等級 +1，徽章進背包。
// 神級的定義（需驗證）：採集擲出神級評級；製作成功做出神級難度的東西（見 engine.js 的 godReached）。
// 次數用 state.counters（採集與製作按鈕各算一次，匯入機器人存檔時會帶入）。
// 已經有徽章物品的（機器人存檔匯入的）視為做過，不會重複 +1。
// ============================================================
import { LIFE_SKILLS } from './rules.js';
import { countOf, addItem } from './engine.js';

export const BADGE_COUNT = 500;
export const BADGE_KINDS = ['神級', '500次'];

// 機器人裡看得到的徽章名稱；其他技能的名稱還沒有資料，先用通用名稱（需向 GM 確認）
const KNOWN = {
  '釣魚:神級': '【垂釣諸天太虛客】神級釣魚',
  '釣魚:500次': '【寒江問道一蓑翁】500次釣魚',
  '烹飪:500次': '【五味造化鼎中仙】500次烹飪',
  '鑄造:500次': '【萬劫鍛靈度厄師】500次鑄造',
  '書寫:500次': '【妙筆生花奪造化】500次書寫',
};
export const badgeName = (skill, kind) => KNOWN[`${skill}:${kind}`] ?? `${kind === '神級' ? '神級' : '500次'}${skill}徽章`;

/** 某個生活技能的兩個徽章狀態：[{ kind, item, reached, made, progress }] */
export function badgeStatus(state, skill) {
  return BADGE_KINDS.map((kind) => {
    const item = badgeName(skill, kind);
    const count = Number(state.counters?.[skill]) || 0;
    return {
      kind, item,
      reached: kind === '神級' ? Boolean(state.godReached?.[skill]) : count >= BADGE_COUNT,
      made: Boolean(state.badgeMade?.[`${skill}:${kind}`]) || countOf(state, item) > 0,
      progress: kind === '神級' ? null : { have: count, need: BADGE_COUNT },
    };
  });
}

/** 製作徽章：達標且沒做過才行。回傳 { ok, error?, item?, level? } */
export function craftBadge(state, skill, kind) {
  if (!LIFE_SKILLS.includes(skill) || !BADGE_KINDS.includes(kind)) return { ok: false, error: '沒有這種徽章。' };
  const b = badgeStatus(state, skill).find((x) => x.kind === kind);
  if (b.made) return { ok: false, error: '這個徽章已經做過了。' };
  if (!b.reached) return { ok: false, error: '還沒達成條件。' };
  addItem(state, b.item);
  state.badgeMade = { ...state.badgeMade, [`${skill}:${kind}`]: true };
  state.lifeSkills[skill] = (Number(state.lifeSkills[skill]) || 0) + 1;
  return { ok: true, item: b.item, level: state.lifeSkills[skill] };
}
