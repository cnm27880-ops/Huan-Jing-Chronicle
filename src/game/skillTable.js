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
import { countOf, removeItem, addItem } from './engine.js';
import { ALL_STATS, LIFE_SKILLS, ART_SKILLS } from './rules.js';
import { pickFx } from './skillPicks.js';

export { SKILL_TABLE, EXP_TABLE };
export const MAX_SKILL_LEVEL = 10;

export const inCatalog = (name) => Object.prototype.hasOwnProperty.call(SKILL_TABLE, name);

// ============================================================
// GM 新增的專屬技能（使用者 2026-10-08）：資料存在伺服器（房間），連線時送到前端、也快取在本機（見 src/state/customSkills.js），
// 用 setCustomSkills 放進 SKILL_TABLE（同一個物件，所有地方都讀得到）。內建的技能不能被改或蓋掉。
// 只能表達「每級累積的固定屬性加成」＋效果文字；要程式計算的被動（像老狗識途）要另外寫程式。
// ============================================================
export const CUSTOM_TIERS = ['初階', '進階', '大師', '傳說'];
export const CUSTOM_KINDS = ['主動', '被動', '綜合']; // 「啟動」類（武裝）要程式處理，不開放
export const CUSTOM_SCHOOLS = ['修仙', '獨特', '生活', '神秘', '科技', '西幻'];
export const MAX_CUSTOM_SKILLS = 60;
export const CUSTOM_TEXT_MAX = 600;
const CUSTOM_NAME_MAX = 20;
const BUILTIN_SKILLS = new Set(Object.keys(SKILL_TABLE)); // 載入時的目錄 = 內建
let customNames = [];

export const isBuiltinSkill = (name) => BUILTIN_SKILLS.has(name);
export const isCustomSkill = (name) => customNames.includes(name);
export const getCustomSkillNames = () => [...customNames];

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\r/g, '').trim().slice(0, max) : '');

/** 「生命+5 真實傷害+1」→ { 生命: 5, 真實傷害: 1 }；空字串 = 沒有加成。回傳 { ok, fx } 或 { ok:false, error } */
export function parseFxLine(text) {
  const out = {};
  const parts = String(text ?? '').split(/[\s,，、;；]+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(.+?)([+\-－＋]?)(\d+)$/);
    const stat = m?.[1];
    if (!m || !ALL_STATS.includes(stat)) return { ok: false, error: `看不懂「${part}」。格式：屬性名稱＋數字，例如「生命+5」。可用屬性：${ALL_STATS.join('、')}。` };
    const value = (m[2] === '-' || m[2] === '－' ? -1 : 1) * Number(m[3]);
    if (value === 0) continue;
    out[stat] = (out[stat] ?? 0) + value;
  }
  return { ok: true, fx: out };
}
/** { 生命: 5, 真實傷害: 1 } → 「生命+5 真實傷害+1」 */
export const formatFxLine = (fx) => Object.entries(fx ?? {}).map(([k, v]) => `${k}${v < 0 ? '-' : '+'}${Math.abs(v)}`).join(' ');

/**
 * 檢查並整理一個 GM 新增的技能。raw = { tier, kind, school, text, fx: [10 個「累積加成」物件] }。
 * 回傳 { ok, name, def } 或 { ok:false, error }
 */
export function validateCustomSkill(rawName, raw) {
  const name = cleanText(rawName, CUSTOM_NAME_MAX + 1);
  if (!name || name.length > CUSTOM_NAME_MAX) return { ok: false, error: `技能名稱要 1～${CUSTOM_NAME_MAX} 字。` };
  if (isBuiltinSkill(name)) return { ok: false, error: `「${name}」是內建技能，不能蓋掉，換一個名字。` };
  if (!raw || typeof raw !== 'object') return { ok: false, error: '技能資料格式錯誤。' };
  if (!CUSTOM_TIERS.includes(raw.tier)) return { ok: false, error: `位階要是：${CUSTOM_TIERS.join('、')}。` };
  if (!CUSTOM_KINDS.includes(raw.kind)) return { ok: false, error: `類型要是：${CUSTOM_KINDS.join('、')}。` };
  if (!CUSTOM_SCHOOLS.includes(raw.school)) return { ok: false, error: `系別要是：${CUSTOM_SCHOOLS.join('、')}。` };
  const text = cleanText(raw.text, CUSTOM_TEXT_MAX + 1);
  if (text.length > CUSTOM_TEXT_MAX) return { ok: false, error: `效果文字最多 ${CUSTOM_TEXT_MAX} 字。` };
  const fxIn = Array.isArray(raw.fx) ? raw.fx : [];
  if (fxIn.length > MAX_SKILL_LEVEL) return { ok: false, error: `數值表最多 ${MAX_SKILL_LEVEL} 級。` };
  const fx = [];
  for (let i = 0; i < MAX_SKILL_LEVEL; i++) {
    const src = fxIn[i];
    if (src != null && (typeof src !== 'object' || Array.isArray(src))) return { ok: false, error: `第 ${i + 1} 級的數值格式錯誤。` };
    const level = {};
    for (const [stat, v] of Object.entries(src ?? {})) {
      if (!ALL_STATS.includes(stat)) return { ok: false, error: `第 ${i + 1} 級有不認得的屬性「${stat}」。` };
      if (!Number.isInteger(v) || Math.abs(v) > 9999) return { ok: false, error: `第 ${i + 1} 級「${stat}」要是 -9999～9999 的整數。` };
      if (v !== 0) level[stat] = v;
    }
    fx.push(level);
  }
  return { ok: true, name, def: { tier: raw.tier, kind: raw.kind, school: raw.school, text, fx, personal: true, custom: true } };
}

/** 把伺服器送來（或本機快取）的 GM 新增技能放進目錄（逐項重新檢查，壞的丟掉；先清掉上一批）；null = 清空 */
export function setCustomSkills(data) {
  for (const n of customNames) delete SKILL_TABLE[n];
  customNames = [];
  for (const [n, d] of Object.entries(data ?? {})) {
    if (customNames.length >= MAX_CUSTOM_SKILLS) break;
    const v = validateCustomSkill(n, d);
    if (v.ok && !(v.name in SKILL_TABLE)) { SKILL_TABLE[v.name] = v.def; customNames.push(v.name); }
  }
}
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
 * 目錄 fx 算不出來、要看其他技能的被動：{ 技能名: (state, level) => { 屬性: 數值 } }。
 * 浮腫之軀：每擁有一個 5 級以上的神秘技能，生命上限 +5（自己 5 級以上也算，使用者確認）。
 */
const MYSTIC_STEP = 5;
const MYSTIC_LEVEL = 5;
// 老狗識途：每個擁有的技能（含自己）達到 5 級、10 級各觸發一次（同一個技能 10 級觸發兩次），
// 第 n 次依序加 物理傷害、能量傷害、靈魂傷害、體魄強韌、抗性免疫、精神意志 各 +1，循環。「擁有」= 已學會，不看有沒有啟動。
const DOG_ORDER = ['物理傷害', '能量傷害', '靈魂傷害', '體魄強韌', '抗性免疫', '精神意志'];
const DOG_LEVELS = [5, 10];
const DYNAMIC_FX = {
  老狗識途: (state) => {
    const n = Object.entries(state.skills ?? {}).filter(([name]) => inCatalog(name))
      .reduce((sum, [, lv]) => sum + DOG_LEVELS.filter((t) => Number(lv) >= t).length, 0);
    const out = {};
    DOG_ORDER.forEach((stat, i) => { const v = Math.floor((n - i + DOG_ORDER.length - 1) / DOG_ORDER.length); if (v > 0) out[stat] = v; });
    return out;
  },
  浮腫之軀: (state) => {
    const n = Object.entries(state.skills ?? {}).filter(([name, lv]) => inCatalog(name) && SKILL_TABLE[name].school === '神秘' && skillActive(state, name) && Number(lv) >= MYSTIC_LEVEL).length;
    return n ? { 生命: n * MYSTIC_STEP } : {};
  },
};

/**
 * 這個角色所有生效技能提供的數值：{ 屬性: [{ label, value }] }（只有 skills 模式才有）。
 * 不含啟動的算力上限扣除（那個要等其他數值加完才能判斷「不能為負數」，見 activationCosts）。
 */
export function skillParts(state) {
  const out = {};
  if (!usesSkillTable(state)) return out;
  for (const [name, level] of Object.entries(state.skills ?? {})) {
    if (!inCatalog(name) || !skillActive(state, name)) continue;
    const fx = { ...skillFx(name, level) };
    if (DYNAMIC_FX[name] && Number(level) >= 1) for (const [stat, value] of Object.entries(DYNAMIC_FX[name](state))) fx[stat] = (fx[stat] ?? 0) + value;
    for (const [stat, value] of Object.entries(pickFx(state, name))) fx[stat] = (fx[stat] ?? 0) + value; // 自選屬性（skillPicks.js）
    for (const [stat, value] of Object.entries(fx)) (out[stat] ??= []).push({ label: name, value });
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
  // 升級讓生活技能／技藝增加（例如尋脈探靈手 +採藥）：技能值是匯入的總值，不會自動由技能加總，所以升級時把增加的差額直接加上去
  for (const [skill, gain] of Object.entries(checkSkillGain(state, name, prev, next))) {
    const bucket = LIFE_SKILLS.includes(skill) ? 'lifeSkills' : 'arts';
    state[bucket] = { ...state[bucket], [skill]: (Number(state[bucket]?.[skill]) || 0) + gain };
  }
  // 記下「這個技能的生活技能加成已經算到幾級」，GM 補算（lifeBackfill）才不會重複加；只有真的算進去（技能目錄內、已生效）才記
  if (usesSkillTable(state) && inCatalog(name) && skillActive(state, name) && next > prev) state.lifeGainDone = { ...state.lifeGainDone, [name]: next };
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

/**
 * 技能從 from 級升到 to 級時，會讓生活技能／技藝增加多少：{ 技能名: 增加量 }（只算往上升，往下調不扣；沒生效的啟動類技能不算）。
 * 技能目錄的 fx 除了面板屬性，也會有「採藥+1」這種生活技能加成。
 */
export function checkSkillGain(state, name, from, to) {
  if (!usesSkillTable(state) || !inCatalog(name) || !skillActive(state, name) || !(to > from)) return {};
  const a = skillFx(name, from);
  const b = skillFx(name, to);
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!LIFE_SKILLS.includes(k) && !ART_SKILLS.includes(k)) continue;
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

/**
 * GM 補算用：哪些技能的生活技能／技藝加成還沒算進去，回傳 [{ name, level, from, gains }]。
 * from = 已經算到幾級（state.lifeGainDone；沒記錄＝0）。注意：匯入的角色卡，生活技能數字本來就含技能加成，
 * 沒記錄不代表沒加過——所以只能由 GM 逐一確認後再補（applyLifeBackfill），不能自動補。
 */
export function lifeBackfill(state) {
  if (!usesSkillTable(state)) return [];
  return Object.entries(state.skills ?? {})
    .map(([name, lv]) => { const level = Number(lv) || 0; const from = Math.min(level, Number(state.lifeGainDone?.[name]) || 0); return { name, level, from, gains: checkSkillGain(state, name, from, level) }; })
    .filter((x) => Object.keys(x.gains).length);
}

/** 補上 names 這幾個技能缺的生活技能／技藝加成並記錄；回傳實際補了什麼 { 技能名: gains } */
export function applyLifeBackfill(state, names) {
  const done = {};
  for (const x of lifeBackfill(state)) {
    if (!names.includes(x.name)) continue;
    for (const [skill, gain] of Object.entries(x.gains)) {
      const bucket = LIFE_SKILLS.includes(skill) ? 'lifeSkills' : 'arts';
      state[bucket] = { ...state[bucket], [skill]: (Number(state[bucket]?.[skill]) || 0) + gain };
    }
    state.lifeGainDone = { ...state.lifeGainDone, [x.name]: x.level };
    done[x.name] = x.gains;
  }
  return done;
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
/** 學新技能（0→1）要「累計花費過」的經驗（RULES_OVERVIEW 5.2）；升級不看門檻 */
export const LEARN_GATE = { 初階: 0, 進階: 3000, 大師: 13000, 傳說: 33000 };
export const bookOf = (name) => `${SKILL_TABLE[name].tier}技能書`;

/** 保留名單（state.keepBooks）：打算學的技能，它的書就算湊滿 3 本也不會被當肥料 */
export const isKeptBook = (state, name) => Boolean(state.keepBooks?.[name]);
export function toggleKeepBook(state, name) {
  const keep = { ...state.keepBooks };
  if (keep[name]) delete keep[name]; else keep[name] = true;
  state.keepBooks = keep;
  return Boolean(keep[name]);
}

/** 技能感悟：升級專用肥料，1 個抵 1 本同階通用技能書（最優先用）；不能拿來學新技能 */
export const INSIGHT_TIERS = { 初階技能感悟: '初階', 進階技能感悟: '進階', 大師技能感悟: '大師', 傳說技能感悟: '傳說' };
export const isInsight = (name) => Object.hasOwn(INSIGHT_TIERS, name);

/** 感悟升階（使用者 2026-10-26）：每階 6 個合成 1 個高一階的，不擲骰、不花時間（傳說已是最高階，不能合） */
export const INSIGHT_COMBINE = 6;
const INSIGHT_ORDER = Object.keys(INSIGHT_TIERS);
export const insightUpgradeOf = (name) => INSIGHT_ORDER[INSIGHT_ORDER.indexOf(name) + 1] ?? null;
/** 合成 times 次；回傳 { ok, error?, gives, cost }，材料不夠就一樣都不扣 */
export function combineInsight(state, name, times = 1) {
  const to = isInsight(name) ? insightUpgradeOf(name) : null;
  const n = Math.floor(Number(times));
  if (!to) return { ok: false, error: '這個物品不能合成升階。' };
  if (!(n >= 1)) return { ok: false, error: '數量要至少 1。' };
  const cost = n * INSIGHT_COMBINE;
  if (countOf(state, name) < cost) return { ok: false, error: `${name} 不夠：要 ${cost} 個，只有 ${countOf(state, name)} 個。` };
  removeItem(state, name, cost);
  addItem(state, to, n);
  return { ok: true, gives: { [to]: n }, cost: { [name]: cost } };
}

/**
 * 升級時可以當「肥料」的抽出書（物品名＝技能名），1 本抵 1 本「同階」通用技能書；抽出書不能變回通用書（會無限抽）。
 * 優先順序：0 同階技能感悟　1 已學會技能的多餘書　2 還沒學、已湊滿 3 本、且不在保留名單的書
 *          3 還沒學、沒湊滿 3 本、不在保留名單的書（使用者 2026-10-12：這些也可以當肥料，排最後）。保留中的不動。
 * learning = 這次正要從 0 級學起的技能：它的 3 本同名書要留給學習，只有超出的才算多餘。
 * 回傳 [{ name, n, rank }]（依優先順序）
 */
export function fodderBooks(state, tier, learning = null) {
  const out = [];
  for (const [item, have] of Object.entries(state.inventory ?? {})) {
    if (INSIGHT_TIERS[item] === tier && have > 0) { out.push({ name: item, n: have, rank: 0 }); continue; }
    if (SKILL_TABLE[item]?.tier !== tier || !(have > 0)) continue;
    const learned = (Number(state.skills?.[item]) || 0) > 0 || item === learning;
    const n = item === learning ? have - LEARN_BOOKS : have;
    if (n <= 0) continue;
    if (learned) out.push({ name: item, n, rank: 1 });
    else if (!isKeptBook(state, item)) out.push({ name: item, n, rank: have >= LEARN_BOOKS ? 2 : 3 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'zh-Hant'));
}

/**
 * 從現在的等級一次升到 target 級要付的東西（不改任何資料）。
 * 回傳 { from, to, exp, books: { 物品名: 數量 }, fodder: { 技能名: 數量 }, haveExp, missing: { 經驗?, 物品名? }, ok }；不能升回 null。
 * 每一級各付一次：經驗 = EXP_TABLE 該級；書 = 0→1 付 3 本同名，其他級付「該級數」本同階。
 * 同階通用書的需求先用肥料書抵（fodderBooks，1 比 1），抵不完的才留在 books 裡（要用通用書付）。
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
  const fodder = {}; // 通用書不夠時優先用肥料抵，1 比 1，同階
  const generic = bookOf(name);
  let need = books[generic] ?? 0;
  for (const f of need ? fodderBooks(state, tier, from === 0 ? name : null) : []) {
    const take = Math.min(need, f.n);
    fodder[f.name] = take;
    need -= take;
    if (!need) break;
  }
  if (generic in books) { if (need) books[generic] = need; else delete books[generic]; }
  const haveExp = Number(state.exp) || 0;
  const missing = {};
  const gate = from === 0 ? { need: LEARN_GATE[tier] ?? 0, have: Number(state.spentExp) || 0 } : null;
  if (gate && gate.have < gate.need) missing['累計花費經驗門檻'] = gate.need - gate.have;
  if (haveExp < exp) missing.經驗 = exp - haveExp;
  for (const [item, n] of Object.entries(books)) if (countOf(state, item) < n) missing[item] = n - countOf(state, item);
  return { from, to, exp, books, fodder, haveExp, gate, missing, ok: Object.keys(missing).length === 0 };
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
  for (const [item, n] of Object.entries(plan.fodder)) removeItem(state, item, n);
  const gains = checkSkillGain(state, name, plan.from, plan.to);
  const swaps = setSkillLevel(state, name, plan.to);
  return { ok: true, exp: plan.exp, books: plan.books, fodder: plan.fodder, from: plan.from, level: plan.to, swaps, gains };
}

/** 升一級（等於 upgradeSkillTo 目前等級 + 1） */
export const upgradeSkill = (state, name) => upgradeSkillTo(state, name, (Number(state.skills?.[name]) || 0) + 1);
