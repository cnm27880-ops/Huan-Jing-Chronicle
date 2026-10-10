// ============================================================
// 公平性（模擬戰，純函式）：GM 以前都拿「第一名強度的玩家一回合全力秒殺三隻小怪」當依據來車怪，
// 結果第一名每次都得全力消耗去罩隊友、最弱的玩家又打不到東西。（使用者 2026-10-10）
// 這裡改成從「整支隊伍」出發：
//   1. 量每位玩家「一次出手」打得掉多少血（對這組敵人的防禦），排出強弱。
//   2. 小怪血量依「最弱玩家一次出手的傷害」設：最弱的人也能靠一次出手打倒一隻小怪；
//      強的人用群攻順手清幾隻，不必全力。BOSS 血量負責補足回合數。
//   3. 檢驗「第一名只出六成力（資源與毒性空間只有六成），隊伍也要贏」。
// 這些數字（六成、一次出手＝一隻小怪）是我訂的，需向 GM 確認；常數都在 FAIR。
// ============================================================
import { newEncounter } from './combat.js';
import { act, buildEncounter, fixedEncounter, prepPlayer, seededRng } from './simulate.js';
import { useEnemySkill, rankInfo } from './enemy.js';

export const FAIR = {
  topBudget: 0.6, // 第一名只出這麼多比例的力（資源與毒性空間）
  weakKills: 0.5, // 最弱的玩家平均至少打倒幾隻（低於這個，他整場幾乎沒有貢獻）
  probeRuns: 24, // 量一次出手的傷害，每位玩家跑幾次
  mobFloor: 0.25, // 最弱玩家打不穿小怪時，小怪血量至少是中位數玩家的這個比例（不然血量變 1）
};

const HUGE = 1e9; // 量傷害用的假怪物血量（不會被打死）

/** 量傷害用的敵人：自訂強度取小怪／菁英（沒有就用 BOSS）三隻，固定敵人取前三隻非 BOSS（沒有就用 BOSS），血量極大、不還手 */
function dummyEncounter(source, rng) {
  if (Array.isArray(source)) {
    const pick = source.filter((s) => (s.kind ?? 'mob') !== 'boss' && s.count > 0);
    const base = pick.length ? pick : source.filter((s) => s.count > 0);
    const spec = base[0];
    if (!spec) return null;
    return buildEncounter([{ ...spec, count: pick.length ? 3 : 1, hp: HUGE, atkPower: 1 }], rng);
  }
  const ms = source?.monsters ?? [];
  const pick = ms.filter((m) => m.kind !== 'boss').slice(0, 3);
  const use = pick.length ? pick : ms.slice(0, 1);
  if (!use.length) return null;
  const enc = fixedEncounter({ monsters: use.map((m) => ({ ...m, maxHp: HUGE, hp: HUGE })) });
  return enc;
}

/**
 * 量每位玩家一次出手的傷害（照模擬戰一樣的選招、加鬥氣、敵人 B 技能的絕對防禦）。
 * 回傳每位玩家 { perTarget（對第一隻的傷害）, total（所有目標加起來，群攻會高）}；source 是自訂強度的 specs 或固定敵人。
 */
export function measureHits(players, source, { supply = null, runs = FAIR.probeRuns } = {}) {
  return players.map((src, i) => {
    let per = 0; let tot = 0; let n = 0;
    for (let k = 0; k < runs; k++) {
      const rng = seededRng(1000 + k * 31 + i);
      const enc = dummyEncounter(source, rng);
      if (!enc) return { perTarget: 0, total: 0 };
      const p = prepPlayer(src, { supply });
      enc.round = 1;
      for (const m of enc.monsters) for (let u = 0; u < rankInfo(m).B.uses; u++) useEnemySkill(enc, m.id, 'B', rng);
      const done = act(p, enc, rng);
      if (!done) continue;
      per += done.r.hits[0]?.lost ?? 0;
      tot += done.r.hits.reduce((a, h) => a + h.lost, 0);
      n++;
    }
    return { perTarget: n ? per / n : 0, total: n ? tot / n : 0 };
  });
}

/** 強弱排序：依一次出手的總傷害（群攻算進去）。回傳 { strongest, weakest（玩家位置）, order（由強到弱）, hits（每人量到的）} */
export function rankPlayers(hits) {
  let strongest = 0; let weakest = 0;
  hits.forEach((h, i) => {
    if (h.total > hits[strongest].total) strongest = i;
    if (h.total < hits[weakest].total) weakest = i;
  });
  const order = hits.map((_, i) => i).sort((a, b) => hits[b].total - hits[a].total); // 由強到弱的玩家位置（集火用）
  return { strongest, weakest, order, hits };
}

/**
 * 建議的小怪血量：最弱玩家一次出手對單一目標的傷害。最弱的人打不穿（接近 0）時，改用中位數玩家的一定比例，並回傳 note 提醒。
 * 回傳 { mobHp, note }；沒有小怪或玩家少於 1 位回傳 null。
 */
export function suggestMobHp(hits) {
  if (!hits.length) return null;
  const sorted = hits.map((h) => h.perTarget).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const weakest = sorted[0];
  if (median <= 0) return null;
  if (weakest < median * FAIR.mobFloor) {
    return { mobHp: Math.max(1, Math.round(median * FAIR.mobFloor)), note: `最弱的玩家一次出手只打得掉 ${Math.round(weakest)}（中位數 ${Math.round(median)}），幾乎打不穿小怪的防禦；小怪血量先以中位數的 ${FAIR.mobFloor * 100}% 計。建議降低小怪防禦，否則他沒有遊戲體驗。` };
  }
  return { mobHp: Math.max(1, Math.round(weakest)), note: '' };
}

/** 第一名只出 topBudget 比例的力的 caps 陣列 */
export const capsFor = (count, strongest, budget = FAIR.topBudget) => Array.from({ length: count }, (_, i) => (i === strongest ? budget : 1));
