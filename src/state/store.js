// ============================================================
// 原型階段的存檔：只存在這台裝置的瀏覽器（localStorage）
// 之後接上 Cloudflare 時，只要改這個檔案，其他程式不用動
// ============================================================
import { SAMPLE_CHARACTER } from '../data/sample/fude.js';
import { basicMove, catalogOf } from '../game/skills.js';
import { maxHp, derivedStats } from '../game/stats.js';
import { syncBadgeMade } from '../game/badges.js';
import { syncKeepsakes } from '../game/keepsakes.js';
import { fixItemAliases } from '../game/engine.js';
import { reportStorageProblem, notify } from './storageIssue.js';

const KEY = 'huanjing:character:v1'; // key 名稱不能改（舊存檔都在這裡）；存檔格式版本看內容裡的 version
/** 存檔格式版本：目前的格式就是第 1 版。之後改格式 → 這裡 +1，並在 upgrade() 加 `if (from < N) { … }` */
export const CURRENT_VERSION = 1;
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * 舊存檔升級：新增的欄位（戰鬥、裝備）舊存檔沒有，缺的就用示範角色的補上，
 * 已有的欄位一律保留，不會蓋掉玩家的資料。
 */
const NEW_FIELDS = ['baseStats', 'equipment', 'gear', 'nextGearId', 'gems', 'nextGemId', 'toxicity', 'buffs', 'moves', 'encounter', 'shield'];
function upgrade(state) {
  const hadVersion = state.version !== undefined;
  const from = Number(state.version) || 1; // 舊存檔沒有 version 欄位：一律視為第 1 版
  if (from > CURRENT_VERSION) throw new Error(`存檔版本 ${from} 比這個網站（${CURRENT_VERSION}）新`);
  // ---- 第 1 版格式（補欄位、舊存檔修正）：每次載入都跑，已有的欄位一律保留 ----
  // 暴徒加成改由程式計算：暴徒加成改由程式計算。舊存檔（階段 0 第一版）的能量/靈魂基礎值含 80 點暴徒加成，要扣掉避免重複計算
  const firstTime = state.skills === undefined;
  if (firstTime && state.baseStats?.能量傷害 === 190 && state.baseStats?.靈魂傷害 === 225) {
    state.baseStats.能量傷害 = 110;
    state.baseStats.靈魂傷害 = 145;
  }
  if (firstTime) state.skills = clone(SAMPLE_CHARACTER.skills);
  if (state.resources === undefined) state.resources = clone(SAMPLE_CHARACTER.resources);
  delete state.passives;
  // 缺的基本欄位用「空的」補（不能用示範角色的，否則會把示範角色的物品與技能等級送給玩家）；
  // 缺這些欄位的存檔以前會在升級中丟錯，整份被換成示範角色（H1）
  const zeros = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, 0]));
  state.inventory ??= {};
  state.sortOrder ??= [];
  state.restStomach ??= [];
  state.sessionStomach ??= [];
  state.keepsakes ??= {};
  state.lifeSkills ??= zeros(SAMPLE_CHARACTER.lifeSkills);
  state.arts ??= zeros(SAMPLE_CHARACTER.arts);
  state.counters ??= zeros(SAMPLE_CHARACTER.counters);
  for (const k of NEW_FIELDS) {
    if (state[k] === undefined) state[k] = clone(SAMPLE_CHARACTER[k]);
  }
  state.buffs.atkBy = state.buffs.atkBy ?? {}; // 同名藥水不疊加用的各藥水貢獻（舊存檔沒有）
  state.buffs.defBy = state.buffs.defBy ?? {};
  state.adjust = state.adjust ?? {}; // 手動調整與啟動中的技能（statMode 'skills' 的角色才用得到，見 skillTable.js）
  state.skillOn = state.skillOn ?? {};
  state.moveUse = state.moveUse ?? {}; // 招式使用紀錄（名稱 → 次數），GM 的模擬戰讀這個，見 moveUse.js
  delete state.maxHp; // 最大生命改由數值面板計算
  fixItemAliases(state); // 打錯字的物品名（代金卷 → 代金券）併回正確的
  syncKeepsakes(state); // 紀念品效果以目錄為準（新增的紀念品、舊存檔都會補上）
  syncBadgeMade(state); // 匯入的存檔已有徽章物品 → 記成做過（技能等級本來就已經含徽章的 +1）
  // 招式沒有消耗資源欄的舊存檔：依招式名稱從示範角色補上；第一次升級時補上技能庫招式
  for (const m of state.moves) {
    if (!m.cost) m.cost = clone(SAMPLE_CHARACTER.moves.find((x) => x.name === m.name)?.cost ?? {});
    // 綁定技能的攻擊招式：消耗以技能為準（舊版把「2 生命 + 3 算力」的全域響應耗用直接存進招式，現在由響應自己扣）
    const cat = m.skill ? catalogOf(m.skill) : null;
    if (cat?.kind === 'attack') m.cost = clone(cat.cost ?? {});
  }
  // 普攻：每人固定有一個（見 skills.js 的 basicMove）
  if (!state.moves.some((m) => m.id === 'basic')) state.moves.push(basicMove());
  state.migrated = state.migrated ?? {};
  state.migrated.brute ??= true; // 技能庫的招式不再自動加進招式清單（玩家自己綁定技能建立）
  // ---- 之後改格式：在這裡加 `if (from < 2) { … }`，不要再用「缺什麼補什麼」猜 ----
  // 生命與資源夾到上限以內：只在「第一次升級成有版本號的存檔」做一次，之後每次載入都不再動數值
  // （GM 專屬技能還沒載入就算上限，會把生命悄悄砍掉再存檔，見 customSkills.js）
  if (!hadVersion) {
    const stats = derivedStats(state); // 面板不看目前資源量，算一次就好
    for (const r of Object.keys(state.resources)) {
      state.resources[r] = Math.max(0, Math.min(state.resources[r], stats[r]?.total ?? Infinity));
    }
    state.hp = Math.min(Number(state.hp) || 0, maxHp(state)); // 生命可以是負數（倒扣，見 combat.js）
  }
  state.version = CURRENT_VERSION;
  state.migrated.version = CURRENT_VERSION; // 遷移記錄按版本（不再每次寫死 brute）
  return state;
}

/** 把伺服器上的角色資料補齊成目前格式（不存檔、不改傳進來的物件）：GM 模擬戰用 */
export function normalizeCharacter(data) {
  return upgrade(clone(data));
}

// ---------- 讀取失敗保護 ----------
// 讀到的存檔壞了（JSON 解析失敗、升級中丟錯）時：原始文字原封不動另存一份、不覆蓋原本的 key，
// 並且在玩家處理之前不再寫入本機存檔（否則畫面上的示範角色會蓋掉壞存檔）。
let brokenLoad = false;
const corruptKey = (raw) => {
  try {
    const first = localStorage.getItem(`${KEY}:corrupt`);
    if (first === null || first === raw) return `${KEY}:corrupt`;
  } catch { /* 下面照用帶時間的 key */ }
  return `${KEY}:corrupt:${Date.now()}`;
};

function markBroken(raw, err) {
  brokenLoad = true;
  console.error('[store] 角色存檔讀取失敗', err);
  let saved = false;
  try { localStorage.setItem(corruptKey(raw), raw); saved = true; } catch (e) { reportStorageProblem(e, '壞掉存檔的副本'); }
  notify(`角色存檔讀取失敗，目前顯示的是示範角色，${saved ? '原始存檔已另外保留，沒有被覆蓋' : '原始存檔仍在原位，沒有被覆蓋'}。這段期間不會存檔，請先不要操作，並聯絡 GM 協助還原。`);
}

/** 本機存檔狀態：none 完全沒存檔、ok 正常、broken 有存檔但讀壞了 */
export function savedCharacterStatus() {
  if (brokenLoad) return 'broken';
  try { return localStorage.getItem(KEY) === null ? 'none' : 'ok'; } catch { return 'none'; }
}
/** 剛剛載入時存檔讀壞了（畫面上是示範角色）：這時不能把畫面上的角色同步到伺服器 */
export function isLoadBroken() { return brokenLoad; }

export function loadCharacter() {
  brokenLoad = false; // 每次重新載入都重新判斷
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 瀏覽器不讓讀 localStorage：當作沒存檔 */ }
  if (raw) {
    try {
      const hadVersion = JSON.parse(raw)?.version !== undefined;
      const state = upgrade(JSON.parse(raw));
      brokenLoad = false;
      if (!hadVersion) saveCharacter(state); // 升級成功才補上版本號寫回
      return state;
    } catch (err) {
      markBroken(raw, err);
    }
  }
  return { ...clone(SAMPLE_CHARACTER), version: CURRENT_VERSION };
}

/** 這台裝置有沒有存過「能用」的角色（沒有或讀壞的話 loadCharacter 給的是示範角色；要分辨看 savedCharacterStatus） */
export function hasSavedCharacter() {
  return savedCharacterStatus() === 'ok';
}

/** 把從伺服器拿到的角色套用到這台裝置：走同一套舊存檔升級，並存進本機 */
export function importCharacter(data) {
  const state = upgrade(clone(data));
  brokenLoad = false; // 玩家明確採用了伺服器版：壞存檔的副本還留著，可以解除寫入保護
  saveCharacter(state);
  return state;
}

/** 回傳有沒有真的存進去 */
export function saveCharacter(state) {
  if (brokenLoad) return false; // 存檔讀壞時不寫入，保護原本的存檔
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    reportStorageProblem(err, '角色存檔'); // 不中斷遊戲，但要讓玩家知道
    return false;
  }
}

// ---------- 同一台裝置換帳號：各帳號的存檔分開收，不互相覆蓋 ----------
const stashKey = (uid) => `${KEY}:stash:${uid}`;

/** 把目前本機存檔收到某帳號名下（本機存檔清空，之後 loadCharacter 會給示範角色） */
export function stashLocalCharacter(uid) {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) localStorage.setItem(stashKey(uid), raw);
    localStorage.removeItem(KEY);
  } catch { /* 忽略 */ }
}

/** 把某帳號收起來的存檔放回本機；有放回回傳 true */
export function unstashLocalCharacter(uid) {
  try {
    const raw = localStorage.getItem(stashKey(uid));
    if (raw === null) return false;
    localStorage.setItem(KEY, raw);
    localStorage.removeItem(stashKey(uid));
    return true;
  } catch { return false; }
}

export function resetCharacter() {
  brokenLoad = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  return { ...clone(SAMPLE_CHARACTER), version: CURRENT_VERSION };
}
