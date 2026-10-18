// ============================================================
// 換日提醒（純顯示，不改任何狀態）：按「新的一天」前，列出玩家該做卻還沒做的事。
// 只讀現有記錄：time、xiweiTime（每次刷新惜未央加時間的次數）、market（今日原價額度）、dailyDone（每日材料）。
// 每日材料只看內建三種（南夢水、不穩定能量、福瑞毛）。沒有記錄的事（例如沒領的技能書、沒鑑定的裝備）一律不提醒。
// ============================================================
import { MAX_TIME } from './rules.js';
import { HALL_DAILY_LIMIT, HALL_SELL, gearPriceName } from './market.js';
import { DAILY_MATERIALS, dailyDone } from './special.js';

const XIWEI = '惜未央';
const XIWEI_TIME_LIMIT = 2; // 惜未央每次刷新之間最多加 2 次時間（engine.js 的 eatNow）

/** 今日已用的原價額度：market.day 不是今天就當 0（不呼叫 marketToday，免得改到存檔） */
const hallUsedToday = (state) => (state.market?.day === state.loginDays ? state.market.hallUsed ?? 0 : 0);

/** 背包裡有沒有交易大廳收的東西（一般物品，或沒鑲寶石的背包裝備） */
function hasSellable(state) {
  if (Object.keys(HALL_SELL).some((name) => (state.inventory?.[name] ?? 0) > 0)) return true;
  return (state.gear ?? []).some((g) => !g.gem && HALL_SELL[gearPriceName(g)]);
}

/** 回傳提醒清單（字串陣列）；全部做完就是空陣列 */
export function dayReminders(state) {
  const out = [];
  if (state.time > 0) out.push(`時間還剩 ${state.time} / ${MAX_TIME} 點沒用`);
  const xiwei = state.inventory?.[XIWEI] ?? 0;
  const xiweiUsed = state.xiweiTime ?? 0;
  if (xiwei > 0 && xiweiUsed < XIWEI_TIME_LIMIT) out.push(`背包有${XIWEI}，時間獎勵還能領 ${XIWEI_TIME_LIMIT - xiweiUsed} 次`);
  const hallLeft = Math.max(0, HALL_DAILY_LIMIT - hallUsedToday(state));
  if (hallLeft > 0 && hasSellable(state)) out.push(`交易大廳原價額度還剩 ${hallLeft} 個，背包有可以賣的東西`);
  const mats = Object.keys(DAILY_MATERIALS).filter((m) => !dailyDone(state, m));
  if (mats.length) out.push(`今天還沒取的特殊材料：${mats.join('、')}`);
  return out;
}
