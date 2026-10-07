// ============================================================
// 物品外觀：圖示、稀有度、分類（只影響畫面，不影響規則）
// ============================================================
import { GATHER_POOLS, RECIPES, FOODS, CRAFT_ACTIONS, POTIONS as POTION_RULES } from '../game/rules.js';

export const TIERS = ['簡單', '普通', '困難', '史詩', '神級'];

const ICON = {
  綠草藥: '🌿', 寧神花: '🌸', 日華蓮: '🪷', 永恆草: '🍀', 神之血: '🩸',
  乾癟肉: '🥓', 鮮美肉: '🍖', 佳餚肉: '🥩', 傳說肉: '🍗', 神之肉: '🌟',
  鐵礦石: '🪨', 秘銀礦: '🔩', 奧利哈鋼: '⚙️', 隕星石: '☄️', 神之骨: '🦴',
  炒飯: '🍚', 拉麵: '🍜', 什錦飯: '🍛', 大肉棒: '🌭', 豪華蓋飯: '🍱', 碳烤肉排: '🥩',
  滿漢全席: '🍲', 傳奇盛宴: '🎊', 純潔聖宴: '🕊️', 汙濁饗宴: '🫕', 肉棒王宴: '👑',
  殘缺技能書: '📜', 初階技能書: '📗', 進階技能書: '📘', 大師技能書: '📙', 傳說技能書: '📕', 神級技能書: '📖',
  金幣: '🪙', 代金券: '🎫',
};

// 稀有度：配方的原料與產物依難度分級（原料優先）
const TIER_OF = {};
CRAFT_ACTIONS.forEach((a) =>
  TIERS.forEach((d, i) => {
    TIER_OF[RECIPES[a][d].cost] ??= i;
  })
);
CRAFT_ACTIONS.forEach((a) =>
  TIERS.forEach((d, i) => RECIPES[a][d].rewards.forEach((r) => (TIER_OF[r] ??= i)))
);

export function tierOf(name) {
  if (name in TIER_OF) return TIER_OF[name];
  const m = name.match(/^(初階|低階|進階|大師|傳說)(武器|防具|飾品)$/);
  if (m) return { 初階: 0, 低階: 0, 進階: 1, 大師: 2, 傳說: 3 }[m[1]];
  if (name.endsWith('寶石')) return 4;
  return null;
}

/**
 * 畫面上的稀有度（0~4 → 初階／進階／大師／傳說／神話，和製作難度 簡單～神級 一一對應）。
 * 和 tierOf 一樣，只有一處不同：技能書照名稱分級（使用者 2026-10-07 確認）。
 * tierOf 是「原料優先」，初階技能書是普通配方的原料，會被算成進階，和名稱不符。
 * 只影響顏色與標籤，不影響規則。
 */
export const RARITY_NAMES = ['初階', '進階', '大師', '傳說', '神話'];
const BOOK_RARITY = { 殘缺: 0, 初階: 0, 進階: 1, 大師: 2, 傳說: 3, 神級: 4 };
export function rarityOf(name) {
  const book = String(name).match(/^(殘缺|初階|進階|大師|傳說|神級)技能書$/);
  if (book) return BOOK_RARITY[book[1]];
  return tierOf(name);
}

export function iconOf(name) {
  if (ICON[name]) return ICON[name];
  if (/武器$/.test(name)) return '⚔️';
  if (/防具$/.test(name)) return '🛡️';
  if (/飾品$/.test(name)) return '💍';
  if (name.endsWith('寶石')) return '💎';
  if (RECIPES.調劑 && Object.values(RECIPES.調劑).some((r) => r.rewards.includes(name))) return '🧪';
  // 名稱本身以 emoji 開頭（稱號、寶寶），沿用那個 emoji
  const lead = name.match(/^\p{Extended_Pictographic}\uFE0F?/u);
  if (lead) return lead[0];
  return ''; // 自行新增的紀念品等沒有專屬圖示：不放預設 emoji，畫面會自動隱藏空圖示
}

/** 去掉名稱開頭的 emoji，避免和圖示重複 */
export const plainName = (name) => name.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');

const flat = (o) => Object.values(o).flatMap((x) => (Array.isArray(x) ? x : flat(x)));
const RECIPE_LIST = Object.values(RECIPES).flatMap((d) => Object.values(d));
const MATERIALS = new Set([...flat(GATHER_POOLS), ...RECIPE_LIST.map((r) => r.cost)].filter((x) => !x.includes('技能書')));
const POTIONS = new Set([...Object.values(RECIPES.調劑).flatMap((r) => r.rewards), ...Object.keys(POTION_RULES)]);
const MEALS = new Set([...Object.keys(FOODS), ...Object.values(RECIPES.烹飪).flatMap((r) => r.rewards)]);
const GEAR = new Set(Object.values(RECIPES.鑄造).flatMap((r) => r.rewards));

export const CATEGORIES = [
  { id: 'material', name: '生產原料', test: (n) => MATERIALS.has(n) },
  { id: 'meal', name: '料理', test: (n) => MEALS.has(n) },
  { id: 'potion', name: '藥劑', test: (n) => POTIONS.has(n) },
  { id: 'gear', name: '裝備與寶石', test: (n) => GEAR.has(n) || tierOf(n) !== null && /(武器|防具|飾品|寶石)$/.test(n) },
  { id: 'book', name: '技能書', test: (n) => n.endsWith('技能書') },
  { id: 'keepsake', name: '紀念品與收藏', test: () => true },
];

export const categoryOf = (name) => CATEGORIES.find((c) => c.test(name)).id;

/** 遊戲裡會出現的所有已知物品，給「新增物品」挑選用 */
export const KNOWN_ITEMS = [...new Set([
  ...flat(GATHER_POOLS), ...RECIPE_LIST.map((r) => r.cost), ...RECIPE_LIST.flatMap((r) => r.rewards),
])];
