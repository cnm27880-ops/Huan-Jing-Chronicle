// ============================================================
// 遊戲引擎：純邏輯，不碰畫面。所有函式直接修改傳入的 state。
// 擲骰與判定照搬機器人；熟練、胃袋、紀念品是網頁新增的規則（見 GAME_RULES.md）
// rng 可以替換，測試時用固定值。
// ============================================================
import {
  LIFE_SKILLS, ART_SKILLS, GATHER_POOLS, gatherTier, RECIPES, CRAFT_COST_AMOUNT,
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
/** 玩家存檔時打錯字的物品名稱 → 正確名稱（例如「代金卷」會被網站當成紀念品，認不出是代金券） */
export const ITEM_ALIASES = { 代金卷: '代金券' };

/** 把背包裡打錯字的物品併進正確的物品（數量相加、排序清單與誤建的紀念品一併處理）。有改動回傳 true */
export function fixItemAliases(state) {
  let changed = false;
  for (const [wrong, right] of Object.entries(ITEM_ALIASES)) {
    if (state.inventory?.[wrong] !== undefined) {
      const n = state.inventory[wrong];
      delete state.inventory[wrong];
      if (n > 0) addItem(state, right, n);
      changed = true;
    }
    if (state.sortOrder?.includes(wrong)) state.sortOrder = state.sortOrder.filter((x) => x !== wrong);
    if (state.keepsakes?.[wrong]) { delete state.keepsakes[wrong]; changed = true; }
  }
  return changed;
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

// 備用保險：技能值對不上時，玩家自己在裝備頁填差額（每個技能一個數字，擲骰明細會顯示「手動修正」）
export const CHECK_ADJUST_MAX = 99;
export function setCheckAdjust(state, skill, value) {
  if (!LIFE_SKILLS.includes(skill) && !ART_SKILLS.includes(skill)) return 0;
  const n = Math.max(-CHECK_ADJUST_MAX, Math.min(CHECK_ADJUST_MAX, Math.trunc(Number(value)) || 0));
  state.checkAdjust = { ...state.checkAdjust };
  if (n) state.checkAdjust[skill] = n; else delete state.checkAdjust[skill];
  return n;
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
  const fix = Number(state.checkAdjust?.[skill]) || 0; // 玩家自己填的備用修正（checkAdjustPanel.js）
  if (fix) parts.push({ label: '手動修正', value: fix });
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
/** 食物真正進胃袋（背包已先扣好）。惜未央：吃下時獲得 1 時間，每次刷新之間最多 2 次（RULES_OVERVIEW §9） */
function enterStomach(state, food, ctx) {
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  stomach.push(ctx === 'rest' ? { food, left: REST_FOOD_CHECKS } : { food });
  if (food === '惜未央' && (state.xiweiTime ?? 0) < 2) { state.time += 1; state.xiweiTime = (state.xiweiTime ?? 0) + 1; }
}

export function eat(state, food, ctx) {
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  if (!FOODS[food]) return '這不是可以吃的食物。';
  if (stomach.length >= STOMACH_SLOTS) return '胃袋已滿，最多 3 份。';
  if (!removeItem(state, food)) return `背包裡沒有${food}。`;
  enterStomach(state, food, ctx);
  return null;
}

// ---------- 修整等候佇列（預先吃料理） ----------
// 修整胃袋滿了的時候，料理先排在 restQueue 等候（背包當下就扣掉）；
// 胃袋有空格（食物用完 10 次）時，會自動從佇列依序補進去，連做 30、40 次也不會中途斷糧。
export const QUEUE_MAX = 99;
export const PRESET_MAX = 10;

export const restQueue = (state) => (state.restQueue ??= []);

/** 修整時吃：有空格直接進胃袋，滿了就排進等候佇列 */
export function eatOrQueue(state, food) {
  if (!FOODS[food]) return '這不是可以吃的食物。';
  if (state.restStomach.length < STOMACH_SLOTS) return eat(state, food, 'rest');
  if (restQueue(state).length >= QUEUE_MAX) return `等候佇列已滿，最多 ${QUEUE_MAX} 份。`;
  if (!removeItem(state, food)) return `背包裡沒有${food}。`;
  restQueue(state).push(food);
  return null;
}

/** 清空等候佇列，料理退回背包。回傳退回的份數 */
export function clearQueue(state) {
  const q = restQueue(state);
  q.forEach((f) => addItem(state, f));
  state.restQueue = [];
  return q.length;
}

/** 每次修整檢定後呼叫：修整胃袋每份扣 1 次，有空格就從佇列補上 */
export function tickRestStomach(state) {
  state.restStomach.forEach((s) => (s.left -= 1));
  state.restStomach = state.restStomach.filter((s) => s.left > 0);
  const q = restQueue(state);
  while (q.length && state.restStomach.length < STOMACH_SLOTS) enterStomach(state, q.shift(), 'rest');
}

// ---------- 菜單（一組最多 3 份，例如 1 傳奇盛宴 + 2 碳烤肉排） ----------
/** 檢查並新增菜單。foods：食物名稱陣列（1～3 份）。回傳錯誤文字或 null */
export function addPreset(state, foods) {
  const list = (state.foodPresets ??= []);
  if (!foods.length) return '至少要選 1 份料理。';
  if (foods.length > STOMACH_SLOTS) return `一組最多 ${STOMACH_SLOTS} 份。`;
  if (foods.some((f) => !FOODS[f])) return '有不是食物的東西。';
  if (list.length >= PRESET_MAX) return `菜單最多 ${PRESET_MAX} 組，先刪掉一組。`;
  if (list.some((p) => p.join() === foods.join())) return '已經有一樣的菜單了。';
  list.push([...foods]);
  return null;
}

/** 菜單的顯示名稱：同種合併，例如「傳奇盛宴 ×1＋碳烤肉排 ×2」 */
export function presetLabel(foods) {
  const count = {};
  foods.forEach((f) => (count[f] = (count[f] ?? 0) + 1));
  return Object.entries(count).map(([f, n]) => `${f} ×${n}`).join('＋');
}

/**
 * 一次吃 sets 組菜單。全有或全無：背包不夠、放不下就不動任何東西。
 * 修整：先填空格，其餘排進等候佇列；跑團：沒有佇列，只能填空格。回傳錯誤文字或 null
 */
export function eatPreset(state, foods, sets, ctx, { overwrite = false } = {}) {
  const all = Array.from({ length: sets }, () => foods).flat();
  const lost = overwrite ? overwriteLoss(state, foods, ctx) : [];
  const need = {};
  all.forEach((f) => (need[f] = (need[f] ?? 0) + 1));
  for (const [f, n] of Object.entries(need)) {
    if (!FOODS[f]) return '有不是食物的東西。';
    if (countOf(state, f) < n) return `背包裡的${f}不夠（要 ${n} 份，只有 ${countOf(state, f)} 份）。`;
  }
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  const free = STOMACH_SLOTS - stomach.length + lost.length;
  if (ctx !== 'rest' && all.length > free) return `跑團胃袋只剩 ${free} 格，吃不下 ${all.length} 份。`;
  if (ctx === 'rest' && all.length > free + QUEUE_MAX - restQueue(state).length) return `等候佇列放不下（最多 ${QUEUE_MAX} 份）。`;
  stomach.splice(0, lost.length); // 覆蓋：被蓋掉的料理直接消失，不退回
  all.forEach((f) => eatOrQueueUnchecked(state, f, ctx));
  return null;
}

/**
 * 覆蓋：胃袋空格不夠放這組菜單時，會從最舊（最前面）的料理開始蓋掉。
 * 回傳會被蓋掉的胃袋內容（畫面拿來做二次確認）。例：[惜未央, 惜未央] 再覆蓋吃 3 份肉排 → 蓋掉 2 份惜未央
 */
export function overwriteLoss(state, foods, ctx) {
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  const need = Math.min(foods.length, STOMACH_SLOTS) - (STOMACH_SLOTS - stomach.length);
  return need > 0 ? stomach.slice(0, need) : [];
}

function eatOrQueueUnchecked(state, food, ctx) {
  removeItem(state, food);
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  if (stomach.length < STOMACH_SLOTS) enterStomach(state, food, ctx);
  else restQueue(state).push(food);
}

// ---------- 福瑞保溫針織袋（特殊配方，RULES_OVERVIEW §9；使用者 2026-10-12 要求放在跑團頁「技能檢定」的跑團胃袋下方） ----------
// 原文：不需裝備、可擁有多個；可裝下一個吐出來的料理，未用完的次數保留。非熟練料理只要在語音跑團中使用過，不管吐沒吐出，跑團結束時都會消耗。
// 做法：背包有幾個袋子就有幾格（state.foodBags = [{ food }]）。跑團胃袋的料理可以「吐進袋子」（空出胃袋格子），
//   之後再「放回胃袋」（不算重新吃，惜未央不會再加時間）。結束本次跑團時：胃袋和袋子裡的料理全部清空，不分熟練（使用者 2026-10-12）。
//   袋子變少（送人、賣掉）時，多出來的料理只能拿出來、不能再放。
export const FOOD_BAG = '福瑞保溫針織袋';
export const foodBagSlots = (state) => countOf(state, FOOD_BAG);
export const foodBags = (state) => (Array.isArray(state.foodBags) ? state.foodBags : (state.foodBags = []));

/** 跑團胃袋第 index 份料理吐進保溫針織袋；回傳錯誤訊息或 null */
export function spitToBag(state, index) {
  const bags = foodBags(state);
  const s = state.sessionStomach[index];
  if (!s) return '胃袋裡沒有這份料理。';
  if (bags.length >= foodBagSlots(state)) return foodBagSlots(state) ? `${FOOD_BAG}都裝滿了（${foodBagSlots(state)} 個）。` : `背包裡沒有${FOOD_BAG}。`;
  state.sessionStomach.splice(index, 1);
  bags.push({ food: s.food });
  return null;
}

/** 保溫針織袋第 index 份料理放回跑團胃袋（胃袋要有空格）；回傳錯誤訊息或 null */
export function takeFromBag(state, index) {
  const bags = foodBags(state);
  const s = bags[index];
  if (!s) return '袋子裡沒有這份料理。';
  if (state.sessionStomach.length >= STOMACH_SLOTS) return '跑團胃袋已滿，先吐一份出來。';
  bags.splice(index, 1);
  state.sessionStomach.push({ food: s.food });
  return null;
}

/** 結束本次跑團：胃袋與保溫針織袋裡的料理全部清空（不分熟練）。回傳被清掉的袋中料理名稱 */
export function endSession(state) {
  state.sessionStomach = [];
  state.daoDunUsed = 0; // 我的刀盾：使用次數是「一次跑團」的
  const gone = foodBags(state).map((s) => s.food);
  state.foodBags = [];
  return gone;
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
