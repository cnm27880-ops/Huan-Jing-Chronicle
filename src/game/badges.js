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
/** 預設名稱（機器人的原名；沒資料的用通用名稱） */
export const badgeName = (skill, kind) => KNOWN[`${skill}:${kind}`] ?? `${kind === '神級' ? '神級' : '500次'}${skill}徽章`;
export const BADGE_NAME_MAX = 20;
const keyOf = (skill, kind) => `${skill}:${kind}`;
/** 玩家目前用的名稱：自己改過的優先，否則預設 */
export const badgeItemName = (state, skill, kind) => state.badgeNames?.[keyOf(skill, kind)] ?? badgeName(skill, kind);

/** 某個生活技能的兩個徽章狀態：[{ kind, item, reached, made, progress }] */
export function badgeStatus(state, skill) {
  return BADGE_KINDS.map((kind) => {
    const item = badgeItemName(state, skill, kind);
    const count = Number(state.counters?.[skill]) || 0;
    return {
      kind, item,
      reached: kind === '神級' ? Boolean(state.godReached?.[skill]) : count >= BADGE_COUNT,
      made: Boolean(state.badgeMade?.[keyOf(skill, kind)]) || countOf(state, item) > 0 || countOf(state, badgeName(skill, kind)) > 0,
      progress: kind === '神級' ? null : { have: count, need: BADGE_COUNT },
    };
  });
}

/** 背包裡已經有徽章物品的（匯入的存檔）永久記成「做過」，之後把物品改名、賣掉或移除也不會再開放製作而重複 +1 */
export function syncBadgeMade(state) {
  for (const skill of LIFE_SKILLS) {
    for (const kind of BADGE_KINDS) {
      if (countOf(state, badgeItemName(state, skill, kind)) > 0 || countOf(state, badgeName(skill, kind)) > 0) {
        state.badgeMade = { ...state.badgeMade, [keyOf(skill, kind)]: true };
      }
    }
  }
}

/** 名稱檢查：1～20 字、不能和背包裡別的東西或別的徽章同名（同名會合併成同一種物品）。回傳錯誤文字或 null */
function nameError(state, skill, kind, name) {
  if (!name || name.length > BADGE_NAME_MAX) return `名稱要 1～${BADGE_NAME_MAX} 字。`;
  const mine = badgeItemName(state, skill, kind);
  if (name === mine) return null;
  const others = LIFE_SKILLS.flatMap((s) => BADGE_KINDS.map((k) => [s, k])).filter(([s, k]) => s !== skill || k !== kind);
  if (name in state.inventory || others.some(([s, k]) => badgeItemName(state, s, k) === name || badgeName(s, k) === name)) return '已經有同名的東西，換一個名字。';
  return null;
}

/** 製作徽章：達標且沒做過才行；name 不給就用預設名稱。回傳 { ok, error?, item?, level? } */
export function craftBadge(state, skill, kind, name) {
  if (!LIFE_SKILLS.includes(skill) || !BADGE_KINDS.includes(kind)) return { ok: false, error: '沒有這種徽章。' };
  const b = badgeStatus(state, skill).find((x) => x.kind === kind);
  if (b.made) return { ok: false, error: '這個徽章已經做過了。' };
  if (!b.reached) return { ok: false, error: '還沒達成條件。' };
  const item = name === undefined ? b.item : String(name).trim();
  const err = nameError(state, skill, kind, item);
  if (err) return { ok: false, error: err };
  addItem(state, item);
  state.badgeNames = { ...state.badgeNames, [keyOf(skill, kind)]: item };
  state.badgeMade = { ...state.badgeMade, [keyOf(skill, kind)]: true };
  state.lifeSkills[skill] = (Number(state.lifeSkills[skill]) || 0) + 1;
  return { ok: true, item, level: state.lifeSkills[skill] };
}

/** 幫做過的徽章改名：背包裡的徽章一起改名（沒有徽章在身上也能改，之後用新名字） */
export function renameBadge(state, skill, kind, newName) {
  const b = LIFE_SKILLS.includes(skill) && badgeStatus(state, skill).find((x) => x.kind === kind);
  if (!b || !b.made) return { ok: false, error: '還沒有這個徽章。' };
  const name = String(newName ?? '').trim();
  const err = nameError(state, skill, kind, name);
  if (err) return { ok: false, error: err };
  const old = badgeItemName(state, skill, kind);
  if (name !== old) {
    // 舊名稱可能是預設名（機器人匯入的）或上次改的名字：把背包裡所有舊名稱的數量搬到新名稱
    for (const from of new Set([old, badgeName(skill, kind)])) {
      const n = countOf(state, from);
      if (n > 0 && from !== name) {
        delete state.inventory[from];
        state.sortOrder = (state.sortOrder ?? []).filter((x) => x !== from);
        addItem(state, name, n);
      }
    }
  }
  state.badgeNames = { ...state.badgeNames, [keyOf(skill, kind)]: name };
  state.badgeMade = { ...state.badgeMade, [keyOf(skill, kind)]: true };
  return { ok: true, item: name };
}
