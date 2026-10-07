// ============================================================
// 技能目錄與技能數值（純函式）。資料在 src/data/skills.js（由 tools/extract-skills.py 產生）。
//
// 數值模式 statMode === 'skills'（新匯入的角色）：
//   數值 = 基礎 + 技能（依已學會的等級查表） + 手動調整 + 裝備 + 食物
//   手動調整 state.adjust 放試算表手打的常數：自由分配、愚者對調、尚未搬到網站的裝備。GM 可以改。
// 舊存檔（沒有 statMode）維持原本：baseStats 已含技能，不重複計算。
//
// 啟動類技能（武裝）：一次性被動「減少 N 點算力上限，不能為負數，永久獲得啟動能力」。
//   要把 state.skillOn[名稱] 打開才會有技能數值，同時扣算力上限（扣到 0 為止）。
// ============================================================
import { SKILL_TABLE, EXP_TABLE } from '../data/skills.js';

export { SKILL_TABLE, EXP_TABLE };
export const MAX_SKILL_LEVEL = 10;

export const inCatalog = (name) => Object.prototype.hasOwnProperty.call(SKILL_TABLE, name);
export const needsActivation = (name) => Boolean(SKILL_TABLE[name]?.activate);
export const usesSkillTable = (state) => state.statMode === 'skills';

/** 技能在這個角色身上有沒有生效：一般技能學會就生效，啟動類要打開 */
export const skillActive = (state, name) => !needsActivation(name) || Boolean(state.skillOn?.[name]);

/** 技能 level 級時累積的數值加成 { 屬性: 數值 }；0 級或目錄沒有就是空的 */
export function skillFx(name, level) {
  const lv = Math.min(MAX_SKILL_LEVEL, Math.floor(Number(level)) || 0);
  return lv >= 1 && inCatalog(name) ? SKILL_TABLE[name].fx[lv - 1] ?? {} : {};
}

/**
 * 這個角色所有生效技能提供的數值：{ 屬性: [{ label, value }] }（只有 skills 模式才有）。
 * 不含啟動的算力上限扣除（那個要等其他數值加完才能判斷「不能為負數」，見 activationCosts）。
 */
export function skillParts(state) {
  const out = {};
  if (!usesSkillTable(state)) return out;
  for (const [name, level] of Object.entries(state.skills ?? {})) {
    if (!inCatalog(name) || !skillActive(state, name)) continue;
    for (const [stat, value] of Object.entries(skillFx(name, level))) (out[stat] ??= []).push({ label: name, value });
  }
  return out;
}

/** 已啟動的技能：[{ name, cost }]，依學習順序 */
export function activeActivations(state) {
  if (!usesSkillTable(state)) return [];
  return Object.keys(state.skills ?? {}).filter((n) => needsActivation(n) && state.skillOn?.[n]).map((n) => ({ name: n, cost: SKILL_TABLE[n].activate }));
}
