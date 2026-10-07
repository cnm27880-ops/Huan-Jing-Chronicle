// ============================================================
// 交易：交易大廳、黑市、特殊黑市。純邏輯，不碰畫面（規則見 GAME_RULES.md「交易」）。
// 設計目的（GM 原文）：消耗多餘金幣與無用材料、讓裝備差的玩家多刷幾次數值；不是賺錢管道。
// ============================================================
import { rollSum } from './dice.js';
import { addItem, removeItem, countOf } from './engine.js';

export const VOUCHER = '代金券';

/** 交易大廳：每人每天「原價」買＋賣合計 5 個，其餘只能用黑心價（不限次數） */
export const HALL_DAILY_LIMIT = 5;
export const HALL_BUY = {
  綠草藥: [10, 18], 寧神花: [30, 54],
  乾癟肉: [10, 18], 鮮美肉: [30, 54],
  鐵礦石: [10, 18], 秘銀礦: [30, 54],
  殘缺技能書: [50, 90],
}; // [原價, 黑心價]（金幣）
export const HALL_SELL = {
  紅藥水: [40, 32], 黃藥水: [40, 32], 綠藥水: [40, 32],
  活血藥: [180, 110], 強擊藥: [180, 110], 堅盾藥: [180, 110],
  炒飯: [60, 48], 拉麵: [60, 48],
  什錦飯: [270, 170], 大肉棒: [270, 170],
  低階武器: [120, 96], 低階防具: [120, 96], 低階飾品: [120, 96],
  進階武器: [540, 350], 進階防具: [540, 350], 進階飾品: [540, 350],
};

/** 黑市：買價（金幣）× 溢價（1D10+2 成），賣價（代金券）× 壓價（2D4+2 成） */
export const BLACK_BUY = {
  綠草藥: 10, 寧神花: 30, 日華蓮: 150,
  乾癟肉: 10, 鮮美肉: 30, 佳餚肉: 150,
  鐵礦石: 10, 秘銀礦: 30, 奧利哈鋼: 150,
  殘缺技能書: 50,
};
export const BLACK_SELL = {
  紅藥水: 24, 黃藥水: 24, 綠藥水: 24,
  活血藥: 75, 強擊藥: 75, 堅盾藥: 75,
  回春湯: 500, 狂暴湯: 500, 玄武湯: 500,
  炒飯: 35, 拉麵: 35,
  什錦飯: 110, 大肉棒: 110,
  豪華蓋飯: 750, 碳烤肉排: 750,
  低階武器: 120, 低階防具: 120, 低階飾品: 120,
  進階武器: 480, 進階防具: 480, 進階飾品: 480,
  大師武器: 3000, 大師防具: 3000, 大師飾品: 3000,
};
export const BLACK_BUY_DICE = { n: 1, sides: 10, add: 2 }; // 結果 3 → ×1.3；12 → ×2.2
export const BLACK_SELL_DICE = { n: 2, sides: 4, add: 2 }; // 結果 5 → ×0.5；10 → ×1（原文：後續劇情可能變 2D3+4）
export const LABOR_GOLD_PER_TIME = 200; // 付不出錢：強制勞動 1 時間 = 200 金幣
export const VOUCHER_EXCHANGE_DAILY = 1500; // 每天最多把 1500 代金券 1:1 換成金幣

/** 特殊黑市（只在黑市團期間）：固定價，以代金券計；每次開團每人買＋賣合計 50 個 */
export const SPECIAL_BUY = { 永恆草: 1000, 傳說肉: 1000, 隕星石: 1000, 初階技能書: 1000, 進階技能書: 5000 };
export const SPECIAL_SELL = {
  傳說武器: 9000, 傳說防具: 9000, 傳說飾品: 9000,
  生命泉: 3000, 力量泉: 3000, 抗性泉: 3000,
  滿漢全席: 4500, 傳奇盛宴: 4500,
};
export const SPECIAL_SESSION_LIMIT = 50;

const SLOT_NAME = { weapon: '武器', armor: '防具', accessory: '飾品' };
/** 已鑑定裝備的「價目表名稱」：照等級的通用名稱（初階 → 低階，原文價目表用「低階」） */
export const gearPriceName = (g) => `${g.tier === '初階' ? '低階' : g.tier}${SLOT_NAME[g.slot]}`;

/** 今天的交易紀錄；換日（登入天數改變）就歸零 */
export function marketToday(state) {
  state.market ??= {};
  const m = state.market;
  if (m.day !== state.loginDays) Object.assign(m, { day: state.loginDays, hallUsed: 0, exchanged: 0 });
  m.session ??= { open: false, used: 0 };
  return m;
}
export const hallLeft = (state) => Math.max(0, HALL_DAILY_LIMIT - marketToday(state).hallUsed);
export const exchangeLeft = (state) => Math.max(0, VOUCHER_EXCHANGE_DAILY - marketToday(state).exchanged);
export const specialLeft = (state) => Math.max(0, SPECIAL_SESSION_LIMIT - marketToday(state).session.used);

const okQty = (qty) => Number.isInteger(qty) && qty > 0;

/** 交易大廳的報價：前 hallLeft 個用原價，其餘用黑心價 */
export function hallQuote(state, side, item, qty) {
  const price = (side === 'buy' ? HALL_BUY : HALL_SELL)[item];
  if (!price || !okQty(qty)) return null;
  const normal = Math.min(qty, hallLeft(state));
  const black = qty - normal;
  return { item, qty, normal, black, unit: price, total: normal * price[0] + black * price[1] };
}

/**
 * 交易大廳買賣背包物品（或指定的已鑑定裝備 gearIds，只能賣）。
 * 回傳報價（含 total）或 { error }。
 */
export function hallTrade(state, side, item, qty, gearIds = null) {
  const q = hallQuote(state, side, item, qty);
  if (!q) return { error: '交易大廳不收這個物品。' };
  if (side === 'buy') {
    if (state.gold < q.total) return { error: `金幣不足：需要 ${q.total}，只有 ${state.gold}。` };
    state.gold -= q.total;
    addItem(state, item, qty);
  } else {
    const err = takeGoods(state, item, qty, gearIds);
    if (err) return { error: err };
    state.gold += q.total;
  }
  marketToday(state).hallUsed += q.normal;
  return q;
}

/** 從背包拿走要賣的東西：一般物品扣數量；gearIds 則是已鑑定裝備（不能是身上的、不能鑲了寶石） */
function takeGoods(state, item, qty, gearIds) {
  if (gearIds) {
    if (gearIds.length !== qty) return '數量不對。';
    const list = gearIds.map((id) => state.gear.find((g) => g.id === id));
    if (list.some((g) => !g)) return '找不到這件裝備（身上穿的要先卸下）。';
    if (list.some((g) => g.gem)) return '鑲了寶石的裝備不能賣。';
    if (list.some((g) => gearPriceName(g) !== item)) return '裝備種類不對。';
    const set = new Set(gearIds);
    state.gear = state.gear.filter((g) => !set.has(g.id));
    return null;
  }
  if (countOf(state, item) < qty) return `${item}不足：只有 ${countOf(state, item)} 個。`;
  removeItem(state, item, qty);
  return null;
}

/** 付金幣；不夠就強制勞動：每 200 金幣 1 時間（無條件進位），時間可以變負的，換日時先還 */
export function payGold(state, cost) {
  if (state.gold >= cost) { state.gold -= cost; return { paid: cost, labor: 0 }; }
  const debt = cost - state.gold;
  const labor = Math.ceil(debt / LABOR_GOLD_PER_TIME);
  const paid = state.gold;
  state.gold = 0;
  state.time -= labor;
  return { paid, labor, debt };
}

/** 黑市買：擲 1D10+2，成交價 = 買價 × 數量 ×（1 + 結果/10）。付不出錢就勞動抵債 */
export function blackBuy(state, item, qty, rng = Math.random) {
  const unit = BLACK_BUY[item];
  if (!unit) return { error: '黑市不賣這個物品。' };
  if (!okQty(qty)) return { error: '數量不對。' };
  const d = BLACK_BUY_DICE;
  const base = rollSum(d.n, d.sides, rng);
  const roll = base + d.add;
  const total = Math.ceil((unit * qty * (10 + roll)) / 10);
  const pay = payGold(state, total);
  addItem(state, item, qty);
  return { item, qty, unit, roll, rate: (10 + roll) / 10, total, ...pay };
}

/** 黑市賣：擲 2D4+2，得到 代金券 = 賣價 × 數量 × 結果/10（無條件捨去） */
export function blackSell(state, item, qty, rng = Math.random, gearIds = null) {
  const unit = BLACK_SELL[item];
  if (!unit) return { error: '黑市不收這個物品。' };
  if (!okQty(qty)) return { error: '數量不對。' };
  const have = gearIds ? null : countOf(state, item);
  if (have !== null && have < qty) return { error: `${item}不足：只有 ${have} 個。` };
  const d = BLACK_SELL_DICE;
  const roll = rollSum(d.n, d.sides, rng) + d.add;
  const err = takeGoods(state, item, qty, gearIds);
  if (err) return { error: err };
  const total = Math.floor((unit * qty * roll) / 10);
  addItem(state, VOUCHER, total);
  return { item, qty, unit, roll, rate: roll / 10, total };
}

/** 代金券 1:1 換金幣，每天最多 1500 */
export function exchangeVouchers(state, n) {
  if (!okQty(n)) return { error: '數量不對。' };
  if (n > exchangeLeft(state)) return { error: `今天最多再換 ${exchangeLeft(state)} 張。` };
  if (countOf(state, VOUCHER) < n) return { error: `代金券不足：只有 ${countOf(state, VOUCHER)} 張。` };
  removeItem(state, VOUCHER, n);
  state.gold += n;
  marketToday(state).exchanged += n;
  return { n };
}

/** 黑市團開關：開團時把本團的交易數歸零 */
export function setBlackSession(state, open) {
  const m = marketToday(state);
  m.session = { open: Boolean(open), used: open ? 0 : m.session.used };
}

/** 特殊黑市（固定價、代金券）：只在黑市團期間；買＋賣合計每團 50 個 */
export function specialTrade(state, side, item, qty, gearIds = null) {
  const m = marketToday(state);
  if (!m.session.open) return { error: '特殊黑市只在黑市團期間開放。' };
  const unit = (side === 'buy' ? SPECIAL_BUY : SPECIAL_SELL)[item];
  if (!unit) return { error: '特殊黑市沒有這個物品。' };
  if (!okQty(qty)) return { error: '數量不對。' };
  if (qty > specialLeft(state)) return { error: `本次黑市團最多再交易 ${specialLeft(state)} 個。` };
  const total = unit * qty;
  if (side === 'buy') {
    if (countOf(state, VOUCHER) < total) return { error: `代金券不足：需要 ${total}，只有 ${countOf(state, VOUCHER)}。` };
    removeItem(state, VOUCHER, total);
    addItem(state, item, qty);
  } else {
    const err = takeGoods(state, item, qty, gearIds);
    if (err) return { error: err };
    addItem(state, VOUCHER, total);
  }
  m.session.used += qty;
  return { item, qty, unit, total };
}
