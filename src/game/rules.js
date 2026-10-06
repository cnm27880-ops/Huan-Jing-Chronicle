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
