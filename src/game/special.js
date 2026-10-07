// ============================================================
// 特殊配方與特殊材料（純函式，RULES_OVERVIEW.md §9、§10；使用者 2026-10-07 要求放在修整日）
//
// 特殊配方：照一般製作的做法——1D20 + 該技能加值 ≥ DC 才成功，材料一次檢定扣一份（失敗材料全毀），
//   不花時間，成功一次得 1 個（原文沒寫數量，需驗證）。效果：
//   料理（祕製桃花酒、惜未央）＝食物（FOODS）；寧心符陣＝固定數值的進階飾品；動物春藥＝藥水（POTIONS）；
//   花雕怪味魚滴露＝「使用」後得初階技能感悟 ×10；重塑魔方、福瑞保溫針織袋＝先只產生物品（用途之後再做）。
// 特殊材料：每個修整日每種 1 次，擲 1D20 + 所選技能加值，總分多少就得多少個（使用者確認）；原文沒寫 DC，不設 DC。
// 餵肉球：材料換「徐曉迪的肉」，5 個肉收割成 1 個怪物肉。
// ============================================================
import { LIFE_SKILLS, ART_SKILLS } from './rules.js';
import { modifier, countOf, addItem, removeItem, keepsakeApplies, consumeKeepsakes, tickRestStomach, d20 } from './engine.js';

export const SPECIAL_RECIPES = {
  祕製桃花酒: { type: '進階料理', skill: '烹飪', dc: 20, materials: { 寧神花: 9, 鮮美肉: 9 }, effect: '熟練 +2，持續 1 天（10 次檢定）' },
  寧心符陣: {
    type: '進階飾品', skill: '鑄造', dc: 17, materials: { 寧神花: 6, 秘銀礦: 6 }, effect: '靈魂傷害 +2、精神意志 +2',
    gear: { tier: '進階', slot: 'accessory', effects: [{ stat: '靈魂傷害', value: 2 }, { stat: '精神意志', value: 2 }] },
  },
  惜未央: { type: '進階料理', skill: '烹飪', dc: 17, materials: { 寧神花: 9, 鮮美肉: 9, 南夢水: 9 }, effect: '熟練 +2，持續 1 天；吃下時獲得 1 時間（每次刷新最多 2 次）' },
  花雕怪味魚滴露: { type: '大師藥水', skill: '調劑', dc: 22, materials: { 怪物肉: 6, 南夢水: 6 }, effect: '使用後獲得 初階技能感悟 ×10' },
  低階重塑魔方: { type: '進階藥水', skill: '調劑', dc: 10, materials: { 不穩定能量: 4 }, effect: '把成品換成同階、同種類的不同物品（功能尚未做，先只產生物品）' },
  進階重塑魔方: { type: '進階藥水', skill: '調劑', dc: 15, materials: { 不穩定能量: 8 }, effect: '同上' },
  大師重塑魔方: { type: '進階藥水', skill: '調劑', dc: 20, materials: { 不穩定能量: 12 }, effect: '同上' },
  傳說重塑魔方: { type: '進階藥水', skill: '調劑', dc: 25, materials: { 不穩定能量: 16 }, effect: '同上（用途需另行確認）' },
  福瑞保溫針織袋: { type: '傳說裝備', skill: '鑄造', dc: 40, materials: { 福瑞毛: 20, 不穩定能量: 20 }, effect: '可裝下一個吐出來的料理（功能尚未做，先只產生物品）' },
  動物春藥: { type: '傳說藥水', skill: '調劑', dc: 37, materials: { 怪物肉: 12, 不穩定能量: 12, 福瑞毛: 12 }, effect: '回復 40% 魔力，毒性 2（戰鬥面板的藥水裡用）' },
};

/** 「使用」會有效果的特殊物品 */
export const USABLE_ITEMS = { 花雕怪味魚滴露: { gives: { 初階技能感悟: 10 } } };

export const specialMaxTimes = (state, name) =>
  Math.min(...Object.entries(SPECIAL_RECIPES[name].materials).map(([item, n]) => Math.floor(countOf(state, item) / n)));

/** 製作特殊配方 times 次；材料不足就停。回傳 { rolls, loot, name }（格式跟一般製作的結果卡相同） */
export function craftSpecial(state, name, times, keepsakes = [], rng = Math.random) {
  const r = SPECIAL_RECIPES[name];
  const rolls = [];
  const loot = {};
  for (let i = 0; i < times; i++) {
    if (specialMaxTimes(state, name) < 1) break;
    for (const [item, n] of Object.entries(r.materials)) removeItem(state, item, n);
    const mod = modifier(state, r.skill, 'rest', keepsakes);
    const used = consumeKeepsakes(state, r.skill, keepsakes);
    state.counters[r.skill] = (state.counters[r.skill] ?? 0) + 1; // 製作按鈕的次數也算進 500 次徽章
    const roll = d20(rng);
    const total = roll + mod.total;
    const success = total >= r.dc;
    const got = {};
    if (success) {
      if (r.gear) state.gear.push({ id: state.nextGearId++, name, ...structuredClone(r.gear) }); // 固定數值的裝備，直接是已鑑定的
      else addItem(state, name);
      got[name] = 1;
      loot[name] = (loot[name] ?? 0) + 1;
    }
    rolls.push({ roll, mod: mod.total, parts: mod.parts, total, dc: r.dc, success, got, used });
    tickRestStomach(state);
  }
  return { rolls, loot };
}

/** 使用特殊物品（花雕怪味魚滴露等）。回傳 { ok, error?, gives? } */
export function useSpecialItem(state, name) {
  const u = USABLE_ITEMS[name];
  if (!u) return { ok: false, error: '這個東西不能在這裡使用。' };
  if (!removeItem(state, name)) return { ok: false, error: `背包裡沒有${name}。` };
  for (const [item, n] of Object.entries(u.gives)) addItem(state, item, n);
  return { ok: true, gives: u.gives };
}

// ---------- 特殊材料（每個修整日每種 1 次） ----------
export const ALL_CHECK_SKILLS = [...LIFE_SKILLS, ...ART_SKILLS];
export const DAILY_MATERIALS = {
  南夢水: { hint: '用任意「可以不污染水取到」的技能檢定', skills: ALL_CHECK_SKILLS },
  不穩定能量: { hint: '找微光玩，用任意「可以取悅她」的技能檢定', skills: ALL_CHECK_SKILLS },
  福瑞毛: { hint: '找銀心王國的福瑞們玩，用社交技能檢定', skills: ['社交'] },
};

export const dailyDone = (state, material) => Boolean(state.dailyDone?.[material]);

/** 取一種材料：擲 1D20 + 技能加值，總分多少得多少個。回傳 { ok, error?, roll, mod, parts, total } */
export function gatherDaily(state, material, skill, rng = Math.random) {
  const m = DAILY_MATERIALS[material];
  if (!m) return { ok: false, error: '沒有這種材料。' };
  if (!m.skills.includes(skill)) return { ok: false, error: `${material}要用${m.skills.join('、')}檢定。` };
  if (dailyDone(state, material)) return { ok: false, error: `今天已經取過${material}了，下個修整日再來。` };
  const mod = modifier(state, skill, 'rest');
  const roll = d20(rng);
  const total = Math.max(0, roll + mod.total);
  addItem(state, material, total);
  state.dailyDone = { ...state.dailyDone, [material]: true };
  return { ok: true, roll, mod: mod.total, parts: mod.parts, total };
}

// ---------- 餵肉球 ----------
export const MEAT = '徐曉迪的肉';
export const MONSTER_MEAT = '怪物肉';
export const MEAT_PER_HARVEST = 5;
const TIERS_FEED = [
  [1, ['綠草藥', '乾癟肉', '鐵礦石']],
  [3, ['寧神花', '鮮美肉', '秘銀礦']],
  [15, ['日華蓮', '佳餚肉', '奧利哈鋼']],
  [75, ['永恆草', '傳說肉', '隕星石']],
];
export const MEAT_FEED = Object.fromEntries(TIERS_FEED.flatMap(([n, items]) => items.map((i) => [i, n])));

/** 餵 n 個材料給肉球，得到徐曉迪的肉（數量依材料階級） */
export function feedMeatball(state, item, n) {
  const per = MEAT_FEED[item];
  const q = Math.floor(Number(n)) || 0;
  if (!per) return { ok: false, error: '肉球不吃這個。' };
  if (q < 1 || countOf(state, item) < q) return { ok: false, error: `${item}不夠。` };
  removeItem(state, item, q);
  addItem(state, MEAT, per * q);
  return { ok: true, meat: per * q };
}

/** 收割 times 次：5 個徐曉迪的肉 → 1 個怪物肉 */
export function harvestMeat(state, times) {
  const t = Math.floor(Number(times)) || 0;
  if (t < 1 || countOf(state, MEAT) < MEAT_PER_HARVEST * t) return { ok: false, error: `${MEAT}不夠（每次要 ${MEAT_PER_HARVEST} 個）。` };
  removeItem(state, MEAT, MEAT_PER_HARVEST * t);
  addItem(state, MONSTER_MEAT, t);
  return { ok: true, got: t };
}
