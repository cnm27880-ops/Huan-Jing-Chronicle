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

// ============================================================
// 愚者對調與技能升級
// ============================================================

/** 三個愚者：升到 1、5、10 級時，各把「防禦」與「傷害」兩項數值對調一次（技能原文） */
export const FOOL_SWAPS = {
  山脈愚者: ['體魄強韌', '物理傷害'],
  太陽愚者: ['抗性免疫', '能量傷害'],
  夢境愚者: ['精神意志', '靈魂傷害'],
};
export const FOOL_LEVELS = [1, 5, 10];

/** 基礎 + 技能 + 手動調整（不含裝備與食物）：對調用的數值 */
function bareStat(state, stat) {
  const fromSkills = (skillParts(state)[stat] ?? []).reduce((a, p) => a + p.value, 0);
  return (Number(state.baseStats?.[stat]) || 0) + fromSkills + (Number(state.adjust?.[stat]) || 0);
}

/** 愚者的門檻裡，等級 level 以下（含）的那幾級 */
export const foolLevelsUpTo = (level) => FOOL_LEVELS.filter((t) => t <= level);

/** 標記某技能 level 級以下的對調「已經做過」（匯入時用：過去的對調已含在手動調整裡） */
export function markSwapsDone(state, name, level) {
  if (!FOOL_SWAPS[name]) return;
  const done = new Set(state.swapDone?.[name] ?? []);
  for (const t of foolLevelsUpTo(level)) done.add(t);
  state.swapDone = { ...state.swapDone, [name]: [...done].sort((a, b) => a - b) };
}

/**
 * 設定技能等級（升級用）。skills 模式的愚者技能會在越過 1、5、10 級時自動對調：
 *   先加該級的屬性，再對調；差額記進手動調整；每一級只對調一次（state.swapDone）。
 *   往下調不撤銷，也不會重複對調。舊存檔（沒有 statMode）數值已含對調，只改等級。
 * 回傳這次發生的對調 [{ level, a, b }]（給畫面顯示）。
 */
export function setSkillLevel(state, name, level) {
  const next = Math.max(0, Math.min(MAX_SKILL_LEVEL, Math.floor(Number(level)) || 0));
  const prev = Number(state.skills?.[name]) || 0;
  const swaps = [];
  if (usesSkillTable(state) && FOOL_SWAPS[name]) {
    const [a, b] = FOOL_SWAPS[name];
    const done = new Set(state.swapDone?.[name] ?? []);
    for (const t of FOOL_LEVELS) {
      if (t <= prev || t > next || done.has(t)) continue;
      state.skills = { ...state.skills, [name]: t }; // 算「剛升到 t 級」的數值
      const va = bareStat(state, a); const vb = bareStat(state, b);
      state.adjust = { ...state.adjust, [a]: (Number(state.adjust?.[a]) || 0) + (vb - va), [b]: (Number(state.adjust?.[b]) || 0) + (va - vb) };
      done.add(t);
      swaps.push({ level: t, a, b });
    }
    state.swapDone = { ...state.swapDone, [name]: [...done].sort((x, y) => x - y) };
  }
  state.skills = { ...state.skills, [name]: next };
  return swaps;
}

/** 升到下一級要付的經驗（單次費用，0→1 也要付）；已滿級或目錄沒有回 null */
export function upgradeCost(state, name) {
  const lv = Number(state.skills?.[name]) || 0;
  const tier = SKILL_TABLE[name]?.tier;
  if (!tier || lv >= MAX_SKILL_LEVEL) return null;
  return EXP_TABLE[tier]?.[lv] ?? null;
}

/** 付經驗升一級（不夠就不動）。回傳 { ok, error?, cost?, level?, swaps? } */
export function upgradeSkill(state, name) {
  if (!usesSkillTable(state)) return { ok: false, error: '這是舊式存檔，請請 GM 用「匯入角色卡」更新。' };
  if (!inCatalog(name)) return { ok: false, error: '技能目錄裡沒有這個技能。' };
  const cost = upgradeCost(state, name);
  if (cost == null) return { ok: false, error: '已經滿級。' };
  if ((Number(state.exp) || 0) < cost) return { ok: false, error: `經驗不足（需要 ${cost}）。` };
  state.exp -= cost;
  state.spentExp = (Number(state.spentExp) || 0) + cost;
  const level = (Number(state.skills?.[name]) || 0) + 1;
  const swaps = setSkillLevel(state, name, level);
  return { ok: true, cost, level, swaps };
}
