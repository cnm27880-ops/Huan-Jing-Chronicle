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
import { isKeepsake, KEEPSAKES } from './keepsakes.js';

export const d20 = (rng = Math.random) => rollDie(20, rng);
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ---------- 背包 ----------
export function countOf(state, item) {
  return state.inventory[item] ?? 0;
}
export function addItem(state, item, n = 1) {
  state.inventory[item] = countOf(state, item) + n;
  if (isKeepsake(item)) (state.keepsakes ??= {})[item] = structuredClone(KEEPSAKES[item]); // 得到目錄裡的紀念品 → 效果跟著補上
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

/**
 * 紀念品是否適用於這次修整檢定
 * kctx：{ kind: 'gather'|'craft'|'special', diff }。有 diff 限制的紀念品只在一般製作的那幾個難度有效；不給 kctx 時不檢查難度
 */
export function keepsakeApplies(def, action, kctx) {
  if (!def || def.manual) return false;
  if (def.diff && kctx && !(kctx.kind === 'craft' && def.diff.includes(kctx.diff))) return false;
  return def.scope === 'rest' || (Array.isArray(def.scope) && def.scope.includes(action));
}

/**
 * 計算加值
 * 生活技能：技能值 + 熟練；非生活技能：技能值
 * keepsakes：本次要消耗的紀念品名稱（只在修整日適用）
 */
export function modifier(state, skill, ctx, keepsakes = [], kctx) {
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
      if (def?.bonus && keepsakeApplies(def, skill, kctx) && countOf(state, name) > 0) {
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
  // 惜未央：吃下時獲得 1 時間，每次刷新之間最多 2 次（RULES_OVERVIEW §9）
  if (food === '惜未央' && (state.xiweiTime ?? 0) < 2) { state.time += 1; state.xiweiTime = (state.xiweiTime ?? 0) + 1; }
  return null;
}

/** 每次修整檢定後呼叫：修整胃袋每份扣 1 次 */
export function tickRestStomach(state) {
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
  state.dailyDone = {}; // 特殊材料每個修整日每種 1 次（special.js）
  state.xiweiTime = 0;
}

/** 消耗本次檢定用到的紀念品，回傳實際用掉的清單 */
export function consumeKeepsakes(state, action, keepsakes, kctx) {
  const used = [];
  keepsakes.forEach((name) => {
    if (keepsakeApplies(state.keepsakes[name], action, kctx) && removeItem(state, name)) used.push(name);
  });
  return used;
}

/** 用掉的紀念品裡有沒有「產出雙倍」的 */
export const doublesOutput = (state, used) => used.some((n) => state.keepsakes[n]?.double);

/** 直接使用紀念品（旅行青蛙的禮物、加爾姆的專屬時間）。回傳 { ok, error?, gives?, time? } */
export function useKeepsake(state, name) {
  const u = state.keepsakes?.[name]?.use;
  if (!u) return { ok: false, error: '這個紀念品不能直接使用。' };
  if (!removeItem(state, name)) return { ok: false, error: `背包裡沒有${name}。` };
  for (const [item, n] of Object.entries(u.gives ?? {})) addItem(state, item, n);
  if (u.time) state.time += u.time; // 沒有上限（惜未央也一樣）；上限需向 GM 確認
  return { ok: true, gives: u.gives, time: u.time };
}

// ---------- 採集 ----------
/** 執行 times 次採集；時間用完就停。回傳每一骰的紀錄與總戰利品 */
export function gather(state, action, times, keepsakes = [], rng = Math.random) {
  const rolls = [];
  const loot = {};
  let exp = 0;
  for (let i = 0; i < times; i++) {
    if (state.time <= 0) break;
    const kctx = { kind: 'gather' };
    const mod = modifier(state, action, 'rest', keepsakes, kctx);
    const used = consumeKeepsakes(state, action, keepsakes, kctx);
    state.time -= 1;
    state.counters[action] = (state.counters[action] ?? 0) + 1;
    const roll = d20(rng);
    const total = roll + mod.total;
    const { tier, exp: gained } = gatherTier(total);
    if (tier === '神級') (state.godReached ??= {})[action] = true; // 徽章用：初次達到神級（badges.js）
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
    const kctx = { kind: 'craft', diff };
    const mod = modifier(state, action, 'rest', keepsakes, kctx);
    const used = consumeKeepsakes(state, action, keepsakes, kctx);
    state.counters[action] = (state.counters[action] ?? 0) + 1;
    const roll = d20(rng);
    const total = roll + mod.total;
    const success = total >= recipe.dc;
    const copies = doublesOutput(state, used) ? 2 : 1; // 紀念品：產出雙倍
    if (success && diff === '神級') (state.godReached ??= {})[action] = true; // 徽章用：製作出神級
    const got = {};
    if (success) {
      for (let k = 0; k < recipe.count; k++) {
        const item = pick(recipe.rewards, rng);
        addItem(state, item, copies);
        got[item] = (got[item] ?? 0) + copies;
        loot[item] = (loot[item] ?? 0) + copies;
      }
    }
    rolls.push({ roll, mod: mod.total, parts: mod.parts, total, dc: recipe.dc, success, got, used, doubled: copies > 1 });
    tickRestStomach(state);
  }
  return { rolls, loot, cost: recipe.cost };
}

// ---------- 跑團檢定 ----------
/** 跑團時的技能檢定：1D20 + 加值（用跑團胃袋，不扣修整次數） */
/** advantage：優勢骰（擲兩顆 D20 取高），rolls 是兩顆的點數 */
export function sessionCheck(state, skill, rng = Math.random, advantage = false) {
  const mod = modifier(state, skill, 'session');
  const rolls = advantage ? [d20(rng), d20(rng)] : null;
  const roll = rolls ? Math.max(...rolls) : d20(rng);
  return { skill, roll, mod: mod.total, parts: mod.parts, total: roll + mod.total, isLife: mod.isLife, ...(rolls ? { rolls } : {}) };
}
