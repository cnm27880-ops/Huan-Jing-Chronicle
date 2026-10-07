// ============================================================
// 遊戲引擎：純邏輯，不碰畫面。所有函式直接修改傳入的 state。
// 擲骰與判定照搬機器人；熟練、胃袋、紀念品是網頁新增的規則（見 GAME_RULES.md）
// rng 可以替換，測試時用固定值。
// ============================================================
import {
  LIFE_SKILLS, GATHER_POOLS, gatherTier, RECIPES, CRAFT_COST_AMOUNT,
  FOODS, STOMACH_SLOTS, REST_FOOD_CHECKS, BASE_PROFICIENCY, MAX_TIME,
} from './rules.js';
import { rollDie } from './dice.js';
import { skillParts } from './skillTable.js';

export const d20 = (rng = Math.random) => rollDie(20, rng);
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ---------- 背包 ----------
export function countOf(state, item) {
  return state.inventory[item] ?? 0;
}
export function addItem(state, item, n = 1) {
  state.inventory[item] = countOf(state, item) + n;
  if (!state.sortOrder.includes(item)) state.sortOrder.push(item);
}
export function removeItem(state, item, n = 1) {
  const left = countOf(state, item) - n;
  if (left < 0) return false;
  if (left === 0) delete state.inventory[item];
  else state.inventory[item] = left;
  return true;
}

// ---------- 熟練與加值 ----------
/** ctx：'rest' 修整日｜'session' 跑團 */
export function proficiency(state, ctx) {
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  const parts = [{ label: '基礎', value: BASE_PROFICIENCY }];
  const fromSkills = skillParts(state).熟練 ?? []; // 新匯入的角色：技能提供的熟練
  parts.push(...fromSkills);
  stomach.forEach((s) => {
    const p = FOODS[s.food]?.proficiency;
    if (p) parts.push({ label: s.food, value: p });
  });
  return { total: parts.reduce((a, p) => a + p.value, 0), parts };
}

/** 紀念品是否適用於這次修整檢定 */
export function keepsakeApplies(def, action) {
  if (!def || def.manual) return false;
  return def.scope === 'rest' || (Array.isArray(def.scope) && def.scope.includes(action));
}

/**
 * 計算加值
 * 生活技能：技能值 + 熟練；非生活技能：技能值
 * keepsakes：本次要消耗的紀念品名稱（只在修整日適用）
 */
export function modifier(state, skill, ctx, keepsakes = []) {
  const isLife = LIFE_SKILLS.includes(skill);
  const base = isLife ? state.lifeSkills[skill] ?? 0 : state.arts[skill] ?? 0;
  const parts = [{ label: skill, value: base }];
  if (isLife) {
    const prof = proficiency(state, ctx);
    parts.push({ label: '熟練', value: prof.total });
  }
  if (ctx === 'rest') {
    keepsakes.forEach((name) => {
      const def = state.keepsakes[name];
      if (keepsakeApplies(def, skill) && countOf(state, name) > 0) {
        parts.push({ label: name, value: def.bonus });
      }
    });
  }
  return { total: parts.reduce((a, p) => a + p.value, 0), parts, isLife };
}

// ---------- 胃袋 ----------
export function eat(state, food, ctx) {
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  if (!FOODS[food]) return '這不是可以吃的食物。';
  if (stomach.length >= STOMACH_SLOTS) return '胃袋已滿，最多 3 份。';
  if (!removeItem(state, food)) return `背包裡沒有${food}。`;
  stomach.push(ctx === 'rest' ? { food, left: REST_FOOD_CHECKS } : { food });
  return null;
}

/** 每次修整檢定後呼叫：修整胃袋每份扣 1 次 */
function tickRestStomach(state) {
  state.restStomach.forEach((s) => (s.left -= 1));
  state.restStomach = state.restStomach.filter((s) => s.left > 0);
}

export function endSession(state) {
  state.sessionStomach = [];
}

export function newDay(state) {
  // 黑市付不出錢會「勞動抵債」讓時間變負的：換日時先還（-3 → 7）
  state.time = MAX_TIME + Math.min(0, state.time);
  state.loginDays += 1;
}

/** 消耗本次檢定用到的紀念品，回傳實際用掉的清單 */
function consumeKeepsakes(state, action, keepsakes) {
  const used = [];
  keepsakes.forEach((name) => {
    if (keepsakeApplies(state.keepsakes[name], action) && removeItem(state, name)) used.push(name);
  });
  return used;
}

// ---------- 採集 ----------
/** 執行 times 次採集；時間用完就停。回傳每一骰的紀錄與總戰利品 */
export function gather(state, action, times, keepsakes = [], rng = Math.random) {
  const rolls = [];
  const loot = {};
  let exp = 0;
  for (let i = 0; i < times; i++) {
    if (state.time <= 0) break;
    const mod = modifier(state, action, 'rest', keepsakes);
    const used = consumeKeepsakes(state, action, keepsakes);
    state.time -= 1;
    state.counters[action] = (state.counters[action] ?? 0) + 1;
    const roll = d20(rng);
    const total = roll + mod.total;
    const { tier, exp: gained } = gatherTier(total);
    state.exp += gained;
    exp += gained;
    const got = {};
    for (let k = 0; k < 10; k++) {
      const item = pick(GATHER_POOLS[action][tier], rng);
      addItem(state, item);
      got[item] = (got[item] ?? 0) + 1;
      loot[item] = (loot[item] ?? 0) + 1;
    }
    rolls.push({ roll, mod: mod.total, parts: mod.parts, total, tier, exp: gained, got, used });
    tickRestStomach(state);
  }
  return { rolls, loot, exp };
}

// ---------- 製作 ----------
/** 最多可以做幾次（只看原料） */
export function craftableTimes(state, action, diff) {
  return Math.floor(countOf(state, RECIPES[action][diff].cost) / CRAFT_COST_AMOUNT);
}

/** 執行 times 次製作；原料不足就停。製作不消耗時間（與機器人相同） */
export function craft(state, action, diff, times, keepsakes = [], rng = Math.random) {
  const recipe = RECIPES[action][diff];
  const rolls = [];
  const loot = {};
  for (let i = 0; i < times; i++) {
    if (!removeItem(state, recipe.cost, CRAFT_COST_AMOUNT)) break;
    const mod = modifier(state, action, 'rest', keepsakes);
    const used = consumeKeepsakes(state, action, keepsakes);
    state.counters[action] = (state.counters[action] ?? 0) + 1;
    const roll = d20(rng);
    const total = roll + mod.total;
    const success = total >= recipe.dc;
    const got = {};
    if (success) {
      for (let k = 0; k < recipe.count; k++) {
        const item = pick(recipe.rewards, rng);
        addItem(state, item);
        got[item] = (got[item] ?? 0) + 1;
        loot[item] = (loot[item] ?? 0) + 1;
      }
    }
    rolls.push({ roll, mod: mod.total, parts: mod.parts, total, dc: recipe.dc, success, got, used });
    tickRestStomach(state);
  }
  return { rolls, loot, cost: recipe.cost };
}

// ---------- 跑團檢定 ----------
/** 跑團時的技能檢定：1D20 + 加值（用跑團胃袋，不扣修整次數） */
export function sessionCheck(state, skill, rng = Math.random) {
  const mod = modifier(state, skill, 'session');
  const roll = d20(rng);
  return { skill, roll, mod: mod.total, parts: mod.parts, total: roll + mod.total, isLife: mod.isLife };
}
