// ============================================================
// 暗影斗篷（我要把朋友賣掉的專屬技能，西幻、初階、主動；原文見 src/data/skills.js）：
//   主動：花 1 點鬥氣，立刻聚集能量傷害，進入隱身（無法被優先指定、不能用其他攻擊），持續 3 回合；隱身中每回合開始時再聚集。
//   主動：現身並對目標造成能量傷害，爆發所有聚集的能量傷害。
//   響應：每 2 級，每回合開始時聚集的能量傷害 +1。
// 純函式，狀態放在 state.buffs.shadow（戰鬥結束 endBattle 會清掉）：{ hidden, gathered, rounds, lastRound }
//   hidden = 隱身中；gathered = 已聚集的能量傷害骰；rounds = 已經歷的回合開始次數（最多 STEALTH_ROUNDS）；lastRound = 上次處理到第幾回合
// 解讀（使用者 2026-10-12 確認：聚集點數照等級算、回合跟遭遇戰自動走、現身用專屬招式；其餘需驗證）：
//   - 「立刻聚集」和「每回合開始聚集」同樣是 2 + 等級÷2（無條件捨去）；等級 10 = 7。
//   - 「持續 3 回合」＝ 施放後的 3 次回合開始各聚集一次；第 4 個回合開始時隱身結束。隱身結束後已聚集的點數保留到戰鬥結束，仍可現身爆發（需驗證）。
//   - 遭遇戰回合數倒退（新戰鬥）視為戰鬥已結束，清掉。
// ============================================================
import { skillLevel } from './skills.js';
import { shortfall, pay } from './resources.js';

export const SHADOW_SKILL = '暗影斗篷';
export const STEALTH_COST = { 鬥氣: 1 };
export const STEALTH_ROUNDS = 3;

export const shadowOf = (state) => state.buffs?.shadow ?? null;
export const isHidden = (state) => Boolean(shadowOf(state)?.hidden);
export const gatheredOf = (state) => shadowOf(state)?.gathered ?? 0;

/** 每次聚集的能量傷害骰：2 + 等級 ÷ 2（無條件捨去） */
export const gainPerRound = (state) => 2 + Math.floor(skillLevel(state, SHADOW_SKILL) / 2);

/** 進入隱身：花 1 鬥氣，立刻聚集一次。round = 目前遭遇戰回合（沒有就 0）。回傳 { ok, gain, gathered } 或 { error } */
export function enterStealth(state, round = 0) {
  if (skillLevel(state, SHADOW_SKILL) < 1) return { error: '還沒學會暗影斗篷。' };
  if (isHidden(state)) return { error: '已經在隱身中。' };
  const lack = shortfall(state, STEALTH_COST);
  if (lack) return { error: `資源不足：${lack}` };
  pay(state, STEALTH_COST);
  const gain = gainPerRound(state);
  state.buffs.shadow = { hidden: true, gathered: (gatheredOf(state) || 0) + gain, rounds: 0, lastRound: Math.max(0, Math.floor(round) || 0) };
  return { ok: true, gain, gathered: state.buffs.shadow.gathered };
}

/**
 * 遭遇戰回合變了：隱身中每個新回合開始聚集一次（最多 STEALTH_ROUNDS 次），之後隱身結束。
 * 回傳 null（沒事）或 { gains:[{round,gain}], gathered, ended, cleared }；呼叫端有變就存檔、發紀錄。
 */
export function advanceShadow(state, round) {
  const sh = shadowOf(state);
  if (!sh) return null;
  const now = Math.max(0, Math.floor(round) || 0);
  if (now < sh.lastRound) { delete state.buffs.shadow; return { gains: [], gathered: 0, ended: false, cleared: true }; }
  if (now === sh.lastRound) return null;
  const out = { gains: [], gathered: sh.gathered, ended: false, cleared: false };
  const gain = gainPerRound(state);
  for (let r = sh.lastRound + 1; r <= now; r++) {
    if (!sh.hidden) break;
    if (sh.rounds < STEALTH_ROUNDS) { sh.rounds += 1; sh.gathered += gain; out.gains.push({ round: r, gain }); } else { sh.hidden = false; out.ended = true; }
  }
  sh.lastRound = now;
  out.gathered = sh.gathered;
  if (!sh.hidden && sh.gathered <= 0) delete state.buffs.shadow;
  return out;
}

/** 現身爆發後：隱身解除，聚集的點數歸零 */
export function clearShadow(state) {
  if (state.buffs) delete state.buffs.shadow;
}

/** 手動補一個回合（沒連房間、沒有遭遇戰回合可看時用） */
export const manualRound = (state) => advanceShadow(state, (shadowOf(state)?.lastRound ?? 0) + 1);
