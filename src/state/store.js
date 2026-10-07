// ============================================================
// 原型階段的存檔：只存在這台裝置的瀏覽器（localStorage）
// 之後接上 Cloudflare 時，只要改這個檔案，其他程式不用動
// ============================================================
import { SAMPLE_CHARACTER } from '../data/sample/fude.js';
import { moveFromCatalog, basicMove } from '../game/skills.js';
import { maxHp, derivedStats } from '../game/stats.js';

const KEY = 'huanjing:character:v1';
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * 舊存檔升級：新增的欄位（戰鬥、裝備）舊存檔沒有，缺的就用示範角色的補上，
 * 已有的欄位一律保留，不會蓋掉玩家的資料。
 */
const NEW_FIELDS = ['baseStats', 'equipment', 'gear', 'nextGearId', 'gems', 'nextGemId', 'toxicity', 'buffs', 'moves', 'encounter', 'shield'];
function upgrade(state) {
  // v2：暴徒加成改由程式計算。舊存檔（階段 0 第一版）的能量/靈魂基礎值含 80 點暴徒加成，要扣掉避免重複計算
  const firstTime = state.skills === undefined;
  if (firstTime && state.baseStats?.能量傷害 === 190 && state.baseStats?.靈魂傷害 === 225) {
    state.baseStats.能量傷害 = 110;
    state.baseStats.靈魂傷害 = 145;
  }
  if (firstTime) state.skills = clone(SAMPLE_CHARACTER.skills);
  if (state.resources === undefined) state.resources = clone(SAMPLE_CHARACTER.resources);
  delete state.passives;
  for (const k of NEW_FIELDS) {
    if (state[k] === undefined) state[k] = clone(SAMPLE_CHARACTER[k]);
  }
  state.adjust = state.adjust ?? {}; // 手動調整與啟動中的技能（statMode 'skills' 的角色才用得到，見 skillTable.js）
  state.skillOn = state.skillOn ?? {};
  delete state.maxHp; // 最大生命改由數值面板計算
  // 招式沒有消耗資源欄的舊存檔：依招式名稱從示範角色補上；第一次升級時補上技能庫招式
  for (const m of state.moves) {
    if (!m.cost) m.cost = clone(SAMPLE_CHARACTER.moves.find((x) => x.name === m.name)?.cost ?? {});
  }
  // 普攻：每人固定有一個（見 skills.js 的 basicMove）
  if (!state.moves.some((m) => m.id === 'basic')) state.moves.push(basicMove());
  state.migrated = state.migrated ?? {};
  if (firstTime) {
    for (const m of SAMPLE_CHARACTER.moves.filter((x) => x.skill)) {
      if (!state.moves.some((x) => x.id === m.id)) state.moves.push(clone(m));
    }
    state.migrated.brute = true;
  }
  // 暴徒的主動招式（技能庫）後來才加：已學暴徒的舊存檔補一次
  if (!state.migrated.brute) {
    state.migrated.brute = true;
    if (state.skills.暴徒 && !state.moves.some((x) => x.skill === '暴徒')) state.moves.push(moveFromCatalog('暴徒'));
  }
  const stats = derivedStats(state); // 面板不看目前資源量，算一次就好
  for (const r of Object.keys(state.resources)) {
    state.resources[r] = Math.max(0, Math.min(state.resources[r], stats[r]?.total ?? Infinity));
  }
  state.hp = Math.max(0, Math.min(state.hp, maxHp(state)));
  return state;
}

/** 把伺服器上的角色資料補齊成目前格式（不存檔、不改傳進來的物件）：GM 模擬戰用 */
export function normalizeCharacter(data) {
  return upgrade(clone(data));
}

export function loadCharacter() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return upgrade(JSON.parse(raw));
  } catch {
    /* 讀不到就用示範資料 */
  }
  return clone(SAMPLE_CHARACTER);
}

/** 這台裝置有沒有存過角色（沒有的話 loadCharacter 給的是示範角色） */
export function hasSavedCharacter() {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}

/** 把從伺服器拿到的角色套用到這台裝置：走同一套舊存檔升級，並存進本機 */
export function importCharacter(data) {
  const state = upgrade(clone(data));
  saveCharacter(state);
  return state;
}

export function saveCharacter(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 儲存失敗時不中斷遊戲 */
  }
}

export function resetCharacter() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  return clone(SAMPLE_CHARACTER);
}
