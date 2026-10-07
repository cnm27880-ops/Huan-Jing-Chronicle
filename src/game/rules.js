// ============================================================
// 遊戲規則資料：數值一律照搬 deepseek_bot03.py（機器人為準）
// 修改規則請同步更新 GAME_RULES.md
// ============================================================

/** 生活技能：修整日使用，加值 = 技能值 + 熟練 */
export const LIFE_SKILLS = ['釣魚', '狩獵', '採藥', '挖礦', '調劑', '烹飪', '鑄造', '書寫'];
/** 非生活技能（技藝）：跑團使用，加值 = 技能值，不加熟練 */
export const ART_SKILLS = ['運動', '盜賊', '社交', '偵查', '調查', '西幻', '科學', '神秘', '修仙'];

export const GATHER_ACTIONS = ['採藥', '狩獵', '挖礦', '釣魚'];
export const CRAFT_ACTIONS = ['調劑', '烹飪', '鑄造', '書寫'];
export const DIFFICULTIES = ['簡單', '普通', '困難', '史詩', '神級'];

const rep = (name, n) => Array(n).fill(name);

/** 採集池：抽 10 次（可重複），對應機器人 GATHERING_POOLS */
export const GATHER_POOLS = {
  採藥: {
    簡單: [...rep('綠草藥', 10), ...rep('寧神花', 1)],
    普通: [...rep('綠草藥', 7), ...rep('寧神花', 3)],
    困難: [...rep('寧神花', 7), ...rep('日華蓮', 3)],
    史詩: [...rep('日華蓮', 5), ...rep('永恆草', 5)],
    神級: [...rep('永恆草', 8), ...rep('神之血', 2)],
  },
  狩獵: {
    簡單: [...rep('乾癟肉', 10), ...rep('鮮美肉', 1)],
    普通: [...rep('乾癟肉', 7), ...rep('鮮美肉', 3)],
    困難: [...rep('鮮美肉', 7), ...rep('佳餚肉', 3)],
    史詩: [...rep('佳餚肉', 5), ...rep('傳說肉', 5)],
    神級: [...rep('傳說肉', 8), ...rep('神之肉', 2)],
  },
  挖礦: {
    簡單: [...rep('鐵礦石', 10), ...rep('秘銀礦', 1)],
    普通: [...rep('鐵礦石', 7), ...rep('秘銀礦', 3)],
    困難: [...rep('秘銀礦', 7), ...rep('奧利哈鋼', 3)],
    史詩: [...rep('奧利哈鋼', 5), ...rep('隕星石', 5)],
    神級: [...rep('隕星石', 8), ...rep('神之骨', 2)],
  },
  釣魚: {
    簡單: [...rep('綠草藥', 3), ...rep('乾癟肉', 3), ...rep('鐵礦石', 3), ...rep('殘缺技能書', 1)],
    普通: [...rep('綠草藥', 3), ...rep('乾癟肉', 3), ...rep('鐵礦石', 3), ...rep('殘缺技能書', 3)],
    困難: [...rep('寧神花', 3), ...rep('鮮美肉', 3), ...rep('秘銀礦', 3), ...rep('殘缺技能書', 3), ...rep('初階技能書', 2)],
    史詩: [
      ...rep('日華蓮', 3), ...rep('永恆草', 1), ...rep('佳餚肉', 3), ...rep('傳說肉', 1),
      ...rep('奧利哈鋼', 3), ...rep('隕星石', 1), ...rep('初階技能書', 3), ...rep('進階技能書', 3), ...rep('大師技能書', 1),
    ],
    神級: [...rep('進階技能書', 18), ...rep('大師技能書', 12), ...rep('傳說技能書', 1)],
  },
};

/** 採集評級與經驗，對應機器人 process_gathering 的判斷順序 */
export function gatherTier(total) {
  if (total < 10) return { tier: '簡單', exp: 25 };
  if (total <= 17) return { tier: '普通', exp: 50 };
  if (total <= 24) return { tier: '困難', exp: 100 };
  if (total < 40) return { tier: '史詩', exp: 200 };
  return { tier: '神級', exp: 300 };
}

/** 製作配方：消耗 6 個原料，成功時從 rewards 抽 count 次（可重複） */
export const RECIPES = {
  調劑: {
    簡單: { cost: '綠草藥', dc: 10, rewards: ['紅藥水', '黃藥水', '綠藥水'], count: 3 },
    普通: { cost: '寧神花', dc: 15, rewards: ['活血藥', '強擊藥', '堅盾藥'], count: 3 },
    困難: { cost: '日華蓮', dc: 20, rewards: ['回春湯', '狂暴湯', '玄武湯'], count: 3 },
    史詩: { cost: '永恆草', dc: 25, rewards: ['生命泉', '力量泉', '抗性泉'], count: 3 },
    神級: { cost: '神之血', dc: 45, rewards: ['神怒滴露', '神皮滴露', '神愛滴露'], count: 3 },
  },
  烹飪: {
    簡單: { cost: '乾癟肉', dc: 10, rewards: ['炒飯', '拉麵'], count: 2 },
    普通: { cost: '鮮美肉', dc: 15, rewards: ['什錦飯', '大肉棒'], count: 2 },
    困難: { cost: '佳餚肉', dc: 20, rewards: ['豪華蓋飯', '碳烤肉排'], count: 2 },
    史詩: { cost: '傳說肉', dc: 25, rewards: ['滿漢全席', '傳奇盛宴'], count: 2 },
    神級: { cost: '神之肉', dc: 45, rewards: ['純潔聖宴', '汙濁饗宴', '肉棒王宴'], count: 2 },
  },
  鑄造: {
    簡單: { cost: '鐵礦石', dc: 10, rewards: ['低階武器', '低階防具', '低階飾品'], count: 1 },
    普通: { cost: '秘銀礦', dc: 15, rewards: ['進階武器', '進階防具', '進階飾品'], count: 1 },
    困難: { cost: '奧利哈鋼', dc: 20, rewards: ['大師武器', '大師防具', '大師飾品'], count: 1 },
    史詩: { cost: '隕星石', dc: 25, rewards: ['傳說武器', '傳說防具', '傳說飾品'], count: 1 },
    神級: {
      cost: '神之骨', dc: 45, count: 1,
      rewards: ['物理傷害寶石', '能量傷害寶石', '靈魂傷害寶石', '體魄強韌寶石', '抗性免疫寶石', '精神意志寶石', '生命寶石', '魔力寶石', '靈氣寶石', '鬥氣寶石', '算力寶石'],
    },
  },
  書寫: {
    簡單: { cost: '殘缺技能書', dc: 10, rewards: ['初階技能書'], count: 1 },
    普通: { cost: '初階技能書', dc: 15, rewards: ['進階技能書'], count: 1 },
    困難: { cost: '進階技能書', dc: 20, rewards: ['大師技能書'], count: 1 },
    史詩: { cost: '大師技能書', dc: 25, rewards: ['傳說技能書'], count: 1 },
    神級: { cost: '傳說技能書', dc: 45, rewards: ['神級技能書'], count: 1 },
  },
};
export const CRAFT_COST_AMOUNT = 6;

/**
 * 食物：proficiency = 熟練加值（只有熟練食物有）
 * 持續時間依吃的場合：修整胃袋 10 次修整檢定；跑團胃袋到本次跑團結束
 * effect 文字取自 GM 試算表「生產表」
 */
export const FOODS = {
  炒飯: { effect: '真實傷害與絕對防禦 +1' },
  拉麵: { effect: '熟練 +1', proficiency: 1 },
  什錦飯: { effect: '生命上限 +10' },
  大肉棒: { effect: '熟練 +2', proficiency: 2 },
  豪華蓋飯: { effect: '生命上限 +20，真實傷害與絕對防禦 +2' },
  碳烤肉排: { effect: '熟練 +3', proficiency: 3 },
  滿漢全席: { effect: '生命上限 +40，真實傷害與絕對防禦 +4' },
  傳奇盛宴: { effect: '熟練 +4', proficiency: 4 },
};
export const STOMACH_SLOTS = 3;
export const REST_FOOD_CHECKS = 10;
export const BASE_PROFICIENCY = 1;
export const MAX_TIME = 10;

// ============================================================
// 戰鬥與裝備規則（來源：GM 試算表「角色永久狀態」「生產表」）
// 機器人沒有這些內容。標「待確認」者尚未經 GM 驗證，見 GAME_RULES.md
// ============================================================

/** 傷害軌道：A 物理、B 能量、C 靈魂（試算表「物能魂真」順序；與機器人 A/B/C 對應） */
export const TRACKS = ['A', 'B', 'C'];
export const TRACK_ATK_STAT = { A: '物理傷害', B: '能量傷害', C: '靈魂傷害' };
export const TRACK_DEF_STAT = { A: '體魄強韌', B: '抗性免疫', C: '精神意志' };
export const TRUE_ATK = '真實傷害';
export const TRUE_DEF = '絕對防禦';
export const RESOURCE_STATS = ['生命', '靈氣', '魔力', '能量', '鬥氣', '算力'];
export const ATK_STATS = [TRUE_ATK, ...TRACKS.map((t) => TRACK_ATK_STAT[t])];
export const DEF_STATS = [TRUE_DEF, ...TRACKS.map((t) => TRACK_DEF_STAT[t])];
export const ALL_STATS = [...ATK_STATS, ...DEF_STATS, ...RESOURCE_STATS];

/** 食物的戰鬥數值（試算表「生產表」）；熟練食物的熟練見 FOODS */
export const FOOD_STATS = {
  炒飯: { [TRUE_ATK]: 1, [TRUE_DEF]: 1 },
  什錦飯: { 生命: 10 },
  豪華蓋飯: { 生命: 20, [TRUE_ATK]: 2, [TRUE_DEF]: 2 },
  滿漢全席: { 生命: 40, [TRUE_ATK]: 4, [TRUE_DEF]: 4 },
};

/**
 * 藥水（試算表「生產表」）。toxicity = 累積毒性；
 * heal = 回復 NdM 生命；atk / def = 下次攻擊（防禦）骰加成
 * 神級滴露（神怒/神皮/神愛）試算表沒有效果，尚未收錄。
 */
export const POTIONS = {
  紅藥水: { toxicity: 2, heal: { n: 2, sides: 10 } },
  黃藥水: { toxicity: 1, atk: 1 },
  綠藥水: { toxicity: 1, def: 1 },
  活血藥: { toxicity: 2, heal: { n: 4, sides: 10 } },
  強擊藥: { toxicity: 1, atk: 3 },
  堅盾藥: { toxicity: 1, def: 3 },
  回春湯: { toxicity: 2, heal: { n: 8, sides: 10 } },
  狂暴湯: { toxicity: 1, atk: 5 },
  玄武湯: { toxicity: 1, def: 5 },
  生命泉: { toxicity: 2, heal: { n: 10, sides: 16 } },
  力量泉: { toxicity: 1, atk: 7 },
  抗性泉: { toxicity: 1, def: 7 },
};
export const TOXICITY_MAX = 15;

/** 裝備：鍛造得到通用物品，「鑑定」時才骰數值（試算表「生產表」第 99–123 列） */
export const GEAR_TIERS = ['初階', '進階', '大師', '傳說'];
export const GEAR_TIER_ALIAS = { 低階: '初階' }; // 機器人的鍛造獎勵叫「低階」，試算表叫「初階」
export const GEAR_SLOT_NAME = { weapon: '武器', armor: '防具', accessory: '飾品' };
/** 武器/防具：加值 = n D sides + add，另擲 1D4 決定屬性 */
export const GEAR_BONUS = {
  初階: { n: 1, sides: 3, add: 0 },
  進階: { n: 1, sides: 6, add: 3 },
  大師: { n: 1, sides: 12, add: 6 },
  傳說: { n: 1, sides: 24, add: 12 },
};
export const WEAPON_STATS = [...TRACKS.map((t) => TRACK_ATK_STAT[t]), TRUE_ATK]; // 1D4：1物 2能 3魂 4真
export const ARMOR_STATS = [...TRACKS.map((t) => TRACK_DEF_STAT[t]), TRUE_DEF]; // 1D4：1體 2抗 3精 4絕
/** 飾品：1D15 決定屬性，數值固定（不另擲）。15 = 特殊（由 GM 設定） */
export const ACC_STATS = [...WEAPON_STATS, ...ARMOR_STATS, '生命', '能量', '魔力', '鬥氣', '算力', '靈氣'];
export const ACC_VALUES = {
  初階: { attr: 1, 生命: 5, 能量: 1, 魔力: 5, 鬥氣: 1, 算力: 2, 靈氣: 3 },
  進階: { attr: 3, 生命: 10, 能量: 2, 魔力: 10, 鬥氣: 2, 算力: 4, 靈氣: 6 },
  大師: { attr: 6, 生命: 20, 能量: 4, 魔力: 20, 鬥氣: 4, 算力: 8, 靈氣: 12 },
  傳說: { attr: 12, 生命: 40, 能量: 8, 魔力: 40, 鬥氣: 8, 算力: 16, 靈氣: 24 },
};
export const ACC_SPECIAL_ROLL = 15;
export const EQUIP_SLOTS = ['weapon', 'armor', 'acc1', 'acc2'];
export const EQUIP_SLOT_LABEL = { weapon: '武器', armor: '防具', acc1: '飾品 1', acc2: '飾品 2' };
