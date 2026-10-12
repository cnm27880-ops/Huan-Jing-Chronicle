// ============================================================
// 友方 NPC（使用者 2026-10-12：「加入友方 NPC 輔助玩家戰鬥（攻防血量＋輔助能力）」；純函式，伺服器與前端共用）。
// 存在遭遇戰的 enc.allies（只在房間模式；本機模式沒有）：
//   { id: '友軍1', name, hp, maxHp, atk: {A,B,C}, def: {A,B,C}, abs, support: { kind: 'heal'|'shield', pct } | null, owner?, ownerName? }
// 操作的人：GM（GM 建立的 NPC），或擁有者（玩家的「初階寶寶」）。規則比照怪物與玩家（每 1 點 = 1D4，同軌相減，三軌相加）：
//   攻擊：NPC 的 A/B/C 攻擊對怪物的 A/B/C 防禦；怪物的絕對防禦（含 B 技能蓄力）加在 NPC 有攻擊骰的每一軌（和玩家出招一樣）。
//   被打：怪物的攻擊（BOSS 選輕擊／重擊／絕殺，A 技能蓄力多加骰）對 NPC 的三軌防禦＋絕對防禦。算怪物這回合的攻擊次數。
//   生命和玩家一樣會倒扣成負數，回到正數才站得起來（倒地的 NPC 不能行動，先攻輪到時自動跳過）。
//   輔助：GM 設定「補血 N%」或「護盾 N%」，對玩家施放＝走信箱（和納米醫療蜂、生生造化印一樣，百分比照對方自己的最大生命）。
// 玩家的「初階寶寶」（獨特技能）：花 500 金幣放出，血 10、攻防 1A1B1C，一人一隻，戰鬥中（GM 開打後）不能放出；
//   打倒前一直留著（GM 結束戰鬥清空敵人時，活著的寶寶留下）。可以裝備武器與防具的部分還沒做。
// ============================================================
import { TRACKS } from './rules.js';
import { clash, monsterAtk, monsterDef, monsterAbs, isDowned, parseAbc } from './combat.js';
import { spendEnemyB } from './enemy.js';

export const MAX_ALLIES = 12;
export const BABY = { skill: '初階寶寶', gold: 500, hp: 10, atk: { A: 1, B: 1, C: 1 }, def: { A: 1, B: 1, C: 1 } };
export const SUPPORT_KINDS = { heal: '補血', shield: '護盾' };

export const alliesOf = (enc) => (Array.isArray(enc?.allies) ? enc.allies : []);
export const findAlly = (enc, id) => alliesOf(enc).find((a) => a.id === id) ?? null;
const cleanAbc = (o) => Object.fromEntries(TRACKS.map((t) => [t, Math.max(0, Math.floor(Number(o?.[t]) || 0))]));

/**
 * 檢查並整理 GM 輸入的 NPC：raw = { name, hp, atk: '10A 5B' 或 {A,B,C}, def, abs, support: { kind, pct } }。
 * 回傳 { ok, ally（還沒有 id） } 或 { error }
 */
export function validateAlly(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'NPC 資料格式錯誤。' };
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 20) : '';
  if (!name) return { error: '請輸入 NPC 名稱（最多 20 字）。' };
  const hp = Number(raw.hp);
  if (!Number.isInteger(hp) || hp < 1 || hp > 10_000_000) return { error: 'NPC 血量要是 1～10,000,000 的整數。' };
  const atk = cleanAbc(typeof raw.atk === 'string' ? parseAbc(raw.atk) : raw.atk);
  const def = cleanAbc(typeof raw.def === 'string' ? parseAbc(raw.def) : raw.def);
  if ([...Object.values(atk), ...Object.values(def)].some((v) => v > 100_000)) return { error: '攻擊或防禦每一軌最多 100,000。' };
  const abs = Math.floor(Number(raw.abs) || 0);
  if (abs < 0 || abs > 100_000) return { error: '絕對防禦要是 0～100,000。' };
  let support = null;
  if (raw.support && raw.support.kind) {
    const pct = Number(raw.support.pct);
    if (!SUPPORT_KINDS[raw.support.kind] || !Number.isInteger(pct) || pct < 1 || pct > 100) return { error: '輔助能力：種類要是補血或護盾，百分比 1～100。' };
    support = { kind: raw.support.kind, pct };
  }
  return { ok: true, ally: { name, hp, maxHp: hp, atk, def, abs, support } };
}

/** 放進遭遇戰（給編號）；回傳放進去的 NPC */
export function addAlly(enc, ally) {
  enc.allies = alliesOf(enc);
  enc.next = enc.next ?? {};
  enc.next.ally = enc.next.ally ?? 1;
  const a = { ...ally, id: `友軍${enc.next.ally++}` };
  enc.allies.push(a);
  return a;
}

export function removeAlly(enc, id) {
  enc.allies = alliesOf(enc).filter((a) => a.id !== id);
  if (Array.isArray(enc.order)) {
    const idx = enc.order.findIndex((o) => o.kind === 'ally' && o.id === id);
    if (idx >= 0) {
      enc.order.splice(idx, 1);
      if (idx < enc.turn) enc.turn -= 1;
      enc.turn = enc.order.length ? Math.min(enc.turn, enc.order.length - 1) : 0;
    }
  }
}

/**
 * NPC 攻擊一隻怪物：mode = BOSS 的防禦模式（0～2）。會改怪物生命（不低於 0）、用掉怪物的 B 技能蓄力。
 * 回傳 { ally, monster, result, def, abs, extraAbs, lost } 或 { error }
 */
export function allyAttack(enc, allyId, monsterId, mode = 0, rng = Math.random) {
  const ally = findAlly(enc, allyId);
  if (!ally) return { error: '找不到這位友方 NPC。' };
  if (isDowned(ally)) return { error: `${ally.name} 倒地了，無法行動。` };
  const monster = enc.monsters.find((m) => m.id === monsterId);
  if (!monster) return { error: '找不到目標。' };
  if (isDowned(monster)) return { error: `${monster.id} 已經倒下。` };
  const extraAbs = spendEnemyB(enc, monster.id);
  const abs = monsterAbs(monster) + extraAbs;
  const base = monsterDef(monster, mode);
  const def = Object.fromEntries(TRACKS.map((t) => [t, base[t] + (ally.atk[t] > 0 ? abs : 0)]));
  const result = clash(ally.atk, def, rng);
  const before = monster.hp;
  monster.hp = Math.max(0, monster.hp - result.total);
  return { ally, monster, result, def, abs, extraAbs, lost: before - monster.hp };
}

/**
 * 怪物攻擊 NPC（攻擊次數要先用 enemy.js 的 spendEnemyAttack 扣掉）：mode = BOSS 的攻擊模式；extraAtk = A 技能蓄力的加骰。
 * 回傳 { ally, monster, result, atk, def, newlyDowned } 或 { error }
 */
export function monsterHitsAlly(enc, monsterId, allyId, mode = 0, rng = Math.random, extraAtk = 0) {
  const ally = findAlly(enc, allyId);
  if (!ally) return { error: '找不到這位友方 NPC。' };
  const monster = enc.monsters.find((m) => m.id === monsterId);
  if (!monster) return { error: '找不到這隻怪物。' };
  if (isDowned(monster)) return { error: `${monster.id} 已經倒下。` };
  const base = monsterAtk(monster, mode);
  const atk = Object.fromEntries(TRACKS.map((t) => [t, base[t] > 0 ? base[t] + extraAtk : base[t]]));
  const def = Object.fromEntries(TRACKS.map((t) => [t, ally.def[t] + (ally.abs ?? 0)]));
  const result = clash(atk, def, rng);
  const wasDowned = isDowned(ally);
  ally.hp -= result.total; // 倒扣（和玩家一樣）
  return { ally, monster, result, atk, def, newlyDowned: !wasDowned && isDowned(ally) };
}

/** 直接設定 NPC 生命（GM；可以是負數，不超過最大生命） */
export function setAllyHp(enc, allyId, hp) {
  const ally = findAlly(enc, allyId);
  if (!ally) return { error: '找不到這位友方 NPC。' };
  const n = Math.floor(Number(hp));
  if (!Number.isInteger(n) || n < -10_000_000) return { error: '生命要是整數。' };
  const before = ally.hp;
  ally.hp = Math.min(ally.maxHp, n);
  return { ally, before };
}

/** 新的先攻位置：把一個參與者插進順序的隨機位置（已開打時插在目前輪到的位置之前的，下一回合才輪到；輪到的人不變） */
export function insertRandom(enc, entry, rng) {
  const n = enc.order.length + 1;
  const at = typeof rng.int === 'function' ? rng.int(n) - 1 : Math.floor(rng() * n); // 0～length（伺服器用 rng.int）
  enc.order.splice(at, 0, entry);
  if (enc.locked && at <= enc.turn) enc.turn += 1;
  return at;
}
