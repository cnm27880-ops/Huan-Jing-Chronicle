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
import { countOf, removeItem } from './engine.js';

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

/** 學新技能（0→1）要 3 本「同名」技能書（物品名 = 技能名，需驗證）；升到 N 級要 N 本「同階」技能書 */
export const LEARN_BOOKS = 3;
export const bookOf = (name) => `${SKILL_TABLE[name].tier}技能書`;

/**
 * 從現在的等級一次升到 target 級要付的東西（不改任何資料）。
 * 回傳 { from, to, exp, books: { 物品名: 數量 }, haveExp, missing: { 經驗?, 物品名? }, ok }；不能升回 null。
 * 每一級各付一次：經驗 = EXP_TABLE 該級；書 = 0→1 付 3 本同名，其他級付「該級數」本同階。
 */
export function upgradePlan(state, name, target) {
  const tier = SKILL_TABLE[name]?.tier;
  const from = Number(state.skills?.[name]) || 0;
  const to = Math.min(MAX_SKILL_LEVEL, Math.floor(Number(target)) || 0);
  if (!tier || !EXP_TABLE[tier] || to <= from) return null;
  let exp = 0;
  const books = {};
  for (let lv = from + 1; lv <= to; lv++) {
    exp += EXP_TABLE[tier][lv - 1] ?? 0;
    const [item, n] = lv === 1 ? [name, LEARN_BOOKS] : [bookOf(name), lv];
    books[item] = (books[item] ?? 0) + n;
  }
  const haveExp = Number(state.exp) || 0;
  const missing = {};
  if (haveExp < exp) missing.經驗 = exp - haveExp;
  for (const [item, n] of Object.entries(books)) if (countOf(state, item) < n) missing[item] = n - countOf(state, item);
  return { from, to, exp, books, haveExp, missing, ok: Object.keys(missing).length === 0 };
}

/** 目前資源最多能升到幾級（一級都升不了回現在的等級） */
export function maxAffordableLevel(state, name) {
  let best = Number(state.skills?.[name]) || 0;
  for (let t = best + 1; t <= MAX_SKILL_LEVEL; t++) {
    if (!upgradePlan(state, name, t)?.ok) break;
    best = t;
  }
  return best;
}

/** 一次升到 target 級：扣經驗與技能書（不夠就一樣都不動）。回傳 { ok, error?, exp?, books?, level?, swaps? } */
export function upgradeSkillTo(state, name, target) {
  if (!usesSkillTable(state)) return { ok: false, error: '這是舊式存檔，請請 GM 用「匯入角色卡」更新。' };
  if (!inCatalog(name)) return { ok: false, error: '技能目錄裡沒有這個技能。' };
  const plan = upgradePlan(state, name, target);
  if (!plan) return { ok: false, error: '已經滿級，或目標等級沒有比現在高。' };
  if (!plan.ok) return { ok: false, error: `材料不夠：${Object.entries(plan.missing).map(([k, n]) => `${k} 還差 ${n}`).join('、')}` };
  state.exp -= plan.exp;
  state.spentExp = (Number(state.spentExp) || 0) + plan.exp;
  for (const [item, n] of Object.entries(plan.books)) removeItem(state, item, n);
  const swaps = setSkillLevel(state, name, plan.to);
  return { ok: true, exp: plan.exp, books: plan.books, from: plan.from, level: plan.to, swaps };
}

/** 升一級（等於 upgradeSkillTo 目前等級 + 1） */
export const upgradeSkill = (state, name) => upgradeSkillTo(state, name, (Number(state.skills?.[name]) || 0) + 1);
