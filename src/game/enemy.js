// ============================================================
// 敵人的等級與技能（2026/10 平衡更新；純函式，伺服器與前端共用同一份）。
// 等級：普通（不用特別準備）、菁英 2 打、BOSS 3 打。雜魚不用戰鬥扮演（秒殺），不在這裡。
// 技能（每回合各有使用次數；回合數 enc.round 變了，次數與蓄力就自動清掉）：
//   A 攻擊強化：用一次＝下一次攻擊，這招用到的每一軌各加 20 顆攻擊骰（使用者 2026-10-10 確認）
//   B 防禦強化：用一次＝下一次被打時，絕對防禦 +20 顆（BOSS +30），加在被打的那招用到的每一軌（和原本的絕對防禦一樣）
//   C 喝血：只能在他自己的回合用，回復 ND16 生命（普通 10、菁英 20、BOSS 30 顆）
// 每回合攻擊次數：普通 1、菁英 2、BOSS 3（使用者 2026-10-10 確認）。
// 「A、B 蓄力」留到被用掉為止（同一回合內）是我的解讀，需驗證。
// ============================================================
import { rollSum } from './dice.js';

export const ENEMY_RANKS = {
  normal: { label: '普通', attacks: 1, A: { uses: 1, dice: 20 }, B: { uses: 1, dice: 20 }, C: { uses: 1, n: 10 } },
  elite: { label: '菁英', attacks: 2, A: { uses: 1, dice: 20 }, B: { uses: 2, dice: 20 }, C: { uses: 1, n: 20 } },
  boss: { label: 'BOSS', attacks: 3, A: { uses: 1, dice: 20 }, B: { uses: 2, dice: 30 }, C: { uses: 1, n: 30 } },
};
export const HEAL_SIDES = 16;
export const SKILL_NAMES = { A: '攻擊強化', B: '防禦強化', C: '喝血' };

export const rankOf = (m) => (m?.kind === 'boss' ? 'boss' : m?.rank === 'elite' ? 'elite' : 'normal');
export const rankInfo = (m) => ENEMY_RANKS[rankOf(m)];

const NONE = { atk: 0, A: 0, B: 0, C: 0 };
/** 這一回合的使用次數與蓄力（不改動怪物）；回合數不同＝新的一回合，全部歸零 */
function current(enc, m) {
  const round = enc.round ?? 0;
  const fresh = m.uses && m.uses.round === round;
  return { uses: fresh ? m.uses : { round, ...NONE }, charge: fresh && m.charge ? m.charge : { A: 0, B: 0 } };
}
/** 會改動怪物時用：確保 m.uses／m.charge 是這一回合的 */
function touch(enc, m) {
  const { uses, charge } = current(enc, m);
  m.uses = uses; m.charge = charge;
  return m;
}

/** 剩餘次數：{ atk, A, B, C, chargeA, chargeB, rank } */
export function enemyLeft(enc, m) {
  const info = rankInfo(m);
  const { uses, charge } = current(enc, m);
  return {
    rank: rankOf(m),
    atk: Math.max(0, info.attacks - uses.atk), A: Math.max(0, info.A.uses - uses.A), B: Math.max(0, info.B.uses - uses.B), C: Math.max(0, info.C.uses - uses.C),
    chargeA: charge.A, chargeB: charge.B,
  };
}

const findAlive = (enc, id) => {
  const m = enc.monsters.find((x) => x.id === id);
  return !m ? { error: '找不到這隻敵人。' } : m.hp <= 0 ? { error: `${m.id} 已經倒下。` } : { m };
};

/** 是不是輪到這隻敵人（還沒開打、沒有先攻順序時不限制） */
export function isEnemyTurn(enc, m) {
  if (!enc.locked || !enc.order?.length) return true;
  const cur = enc.order[enc.turn];
  return cur?.kind === 'monster' && cur.id === m.id;
}

/**
 * 敵人使用技能（GM 操作）：skill = 'A' | 'B' | 'C'。A、B 是蓄力（下一次攻擊／被打時生效）；C 立刻回血。
 * 回傳 { ok, skill, ... } 或 { error }
 */
export function useEnemySkill(enc, id, skill, rng = Math.random) {
  if (!['A', 'B', 'C'].includes(skill)) return { error: '沒有這個敵人技能。' };
  const f = findAlive(enc, id);
  if (f.error) return f;
  const { m } = f;
  const info = rankInfo(m);
  touch(enc, m);
  if (m.uses[skill] >= info[skill].uses) return { error: `${m.id} 這回合的${SKILL_NAMES[skill]}（${skill}）用完了（每回合 ${info[skill].uses} 次）。` };
  if (skill === 'C') {
    if (!isEnemyTurn(enc, m)) return { error: `${m.id} 的喝血只能在他自己的回合使用。` };
    const rolled = rollSum(info.C.n, HEAL_SIDES, rng);
    const before = m.hp;
    m.hp = Math.min(m.maxHp, m.hp + rolled);
    m.uses.C += 1;
    return { ok: true, skill, dice: `${info.C.n}D${HEAL_SIDES}`, rolled, healed: m.hp - before };
  }
  m.uses[skill] += 1;
  m.charge[skill] += 1;
  return { ok: true, skill, dice: info[skill].dice };
}

/**
 * 敵人發動一次攻擊（玩家按「承受攻擊」時）：扣掉這回合的攻擊次數；有 A 蓄力就消耗一次並回傳 extraAtk。
 * 回傳 { ok, extraAtk, left } 或 { error }
 */
export function spendEnemyAttack(enc, id) {
  const f = findAlive(enc, id);
  if (f.error) return f;
  const { m } = f;
  const info = rankInfo(m);
  touch(enc, m);
  if (m.uses.atk >= info.attacks) return { error: `${m.id} 這回合已經攻擊 ${info.attacks} 次了（等 GM 進到下一回合）。` };
  m.uses.atk += 1;
  let extraAtk = 0;
  if (m.charge.A > 0) { m.charge.A -= 1; extraAtk = info.A.dice; }
  return { ok: true, extraAtk, left: info.attacks - m.uses.atk };
}

/** 敵人被打時：有 B 蓄力就消耗一次，回傳多出來的絕對防禦骰數（沒有就 0） */
export function spendEnemyB(enc, id) {
  const m = enc.monsters.find((x) => x.id === id);
  if (!m) return 0;
  touch(enc, m);
  if (m.charge.B <= 0) return 0;
  m.charge.B -= 1;
  return rankInfo(m).B.dice;
}

/** 這隻敵人下一次被打時會多幾顆絕對防禦骰（有蓄力才有；不消耗） */
export const pendingEnemyB = (enc, m) => (enemyLeft(enc, m).chargeB > 0 ? rankInfo(m).B.dice : 0);

/** 新的一回合（沒有先攻順序時，GM 手動進下一回合）：只要把回合數 +1，次數與蓄力就自動歸零 */
export const nextRound = (enc) => { enc.round = (enc.round ?? 0) + 1; return enc.round; };
