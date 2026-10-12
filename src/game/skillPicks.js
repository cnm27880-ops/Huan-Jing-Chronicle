// ============================================================
// 技能的「自選屬性」（純函式）：孕育、呼吸法、工程模塊、義體防護、模塊化升級、血肉合同。
// 這幾個技能在特定等級可以自由選要加／減哪個屬性，「選定後不可更改」。
// 選擇存在 state.skillPicks[技能名][等級]；以前只能由 GM 寫在手動調整裡。
//   gain：要加的屬性（n 點，每點各自選；fixed 是固定加）
//   lose：要減的屬性（optional 的技能可以選「不使用」＝不減也不加）；不能減到負數
// 等級降低時，超過目前等級的選擇自動失效（不刪除）。
// ============================================================
import { ATK_STATS, DEF_STATS, TRUE_ATK, TRUE_DEF } from './rules.js';

/** 「除真實傷害與絕對防禦外的攻擊或防禦屬性」 */
export const FREE_STATS = [...ATK_STATS, ...DEF_STATS].filter((s) => s !== TRUE_ATK && s !== TRUE_DEF);

export const PICK_SPECS = {
  孕育: { levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], gain: { n: 5, from: FREE_STATS } },
  呼吸法: { levels: [1, 4, 7, 10], gain: { n: 1, from: FREE_STATS } },
  工程模塊: { levels: [1, 3, 5, 7, 9], optional: true, lose: { n: 1, from: ['算力'] }, gain: { n: 1, from: FREE_STATS } },
  義體防護: { levels: [1, 4, 7, 10], optional: true, lose: { n: 1, from: ['算力', '生命'] }, gain: { n: 1, from: ['體魄強韌', '抗性免疫', '精神意志'] } },
  模塊化升級: { levels: [1, 3, 5, 7, 9], optional: true, lose: { n: 2, from: ['算力'] }, gain: { n: 2, from: FREE_STATS } },
  血肉合同: { levels: [1, 3, 5, 7, 9], optional: true, lose: { n: 6, from: ['生命'] }, gain: { n: 3, fixed: '能量' } },
};

export const hasPicks = (name) => Object.hasOwn(PICK_SPECS, name);
const levelOf = (state, name) => Math.floor(Number(state.skills?.[name])) || 0;
const recorded = (state, name, m) => state.skillPicks?.[name]?.[m];

/** 已經到達、可以選的等級（不管選過沒有） */
export const pickMilestones = (state, name) => (hasPicks(name) ? PICK_SPECS[name].levels.filter((m) => m <= levelOf(state, name)) : []);
/** 到達了但還沒選的等級 */
export const pendingPicks = (state, name) => pickMilestones(state, name).filter((m) => !recorded(state, name, m));

/** 一次選擇造成的數值變動 { 屬性: 數值 }；skip 或沒有內容就是空的 */
export function pickDelta(name, pick) {
  const spec = PICK_SPECS[name];
  const out = {};
  if (!spec || !pick || pick.skip) return out;
  const add = (stat, v) => { if (stat && v) out[stat] = (out[stat] ?? 0) + v; };
  if (spec.gain.fixed) add(spec.gain.fixed, spec.gain.n);
  else (pick.gain ?? []).forEach((s) => add(s, 1));
  if (spec.lose && pick.lose) add(pick.lose, -spec.lose.n);
  return out;
}

/** 這個技能所有「已到達等級」的自選加總（算數值面板用） */
export function pickFx(state, name) {
  const out = {};
  for (const m of pickMilestones(state, name)) {
    for (const [stat, v] of Object.entries(pickDelta(name, recorded(state, name, m)))) out[stat] = (out[stat] ?? 0) + v;
  }
  return out;
}

/**
 * 記下一次選擇（選了就鎖住，玩家不能改；GM 用 resetPicks 清掉才能重選）
 * choice：{ skip: true }（可選的技能才能不使用）或 { gain: [屬性…], lose: 屬性 }
 * stats：目前的數值面板 derivedStats(state)，用來檢查減少後不能為負數
 * 回傳 { ok: true } 或 { ok: false, error }
 */
export function setPick(state, name, m, choice, stats = {}) {
  const spec = PICK_SPECS[name];
  if (!spec) return { ok: false, error: '這個技能沒有自選屬性。' };
  if (!pickMilestones(state, name).includes(m)) return { ok: false, error: `${name}還沒到 ${m} 級。` };
  if (recorded(state, name, m)) return { ok: false, error: `${name} ${m} 級已經選定，不能更改（要改請找 GM）。` };
  let pick;
  if (choice?.skip) {
    if (!spec.optional) return { ok: false, error: '這一級一定要選屬性，不能略過。' };
    pick = { skip: true };
  } else {
    pick = {};
    if (!spec.gain.fixed) {
      const gain = choice?.gain ?? [];
      if (gain.length !== spec.gain.n || gain.some((s) => !spec.gain.from.includes(s))) return { ok: false, error: `要選滿 ${spec.gain.n} 點屬性。` };
      pick.gain = [...gain];
    }
    if (spec.lose) {
      const lose = spec.lose.from.length === 1 ? spec.lose.from[0] : choice?.lose;
      if (!spec.lose.from.includes(lose)) return { ok: false, error: '要選減少哪個屬性。' };
      if ((stats[lose]?.total ?? 0) - spec.lose.n < 0) return { ok: false, error: `${lose}上限不夠減 ${spec.lose.n} 點（不能為負數）。` };
      pick.lose = lose;
    }
  }
  ((state.skillPicks ??= {})[name] ??= {})[m] = pick;
  return { ok: true, pick };
}

/** GM 用：清掉某技能全部的自選，讓玩家重選 */
export function resetPicks(state, name) {
  if (state.skillPicks) delete state.skillPicks[name];
}

export function pickText(name, pick) {
  if (!pick) return '尚未選擇';
  if (pick.skip) return '不使用';
  const spec = PICK_SPECS[name];
  const count = {};
  (pick.gain ?? []).forEach((s) => (count[s] = (count[s] ?? 0) + 1));
  const up = spec.gain.fixed ? `${spec.gain.fixed} +${spec.gain.n}` : Object.entries(count).map(([s, n]) => `${s} +${n}`).join('、');
  return pick.lose ? `${pick.lose} −${spec.lose.n}，${up}` : up;
}
