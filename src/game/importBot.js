// ============================================================
// 把 Discord 機器人的存檔（players_data.json 的一位玩家）轉成網站的角色。純函式，不碰網路。
//
// 機器人存檔有：名稱、天數、時間、金幣、經驗、已花經驗、背包（一個物品一筆的清單）、各生產次數、整理順序、生命。
// 機器人存檔沒有：技能等級、基礎數值、裝備、招式（在 GM 試算表「角色永久狀態」）。
// 所以匯入只會填上面那些欄位；新角色的技能與基礎數值是空白的，要之後另外補。
//   - 沒有現成角色（base = null）：用空白角色當底，最大生命取機器人的 max_hp（基礎生命 = max_hp）。
//   - 已有角色（base）：只覆蓋「機器人有的欄位」，技能、數值、裝備、招式、生命一律保留。
// ============================================================
import { SAMPLE_CHARACTER } from '../data/sample/fude.js';
import { LIFE_SKILLS, ART_SKILLS, MAX_TIME } from './rules.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const nonNeg = (v) => Math.max(0, Math.floor(Number(v)) || 0);
const MAX_KINDS = 500; // 背包最多幾種物品（防止異常資料把存檔撐爆）
const MAX_NAME = 80;
const RESOURCES = ['靈氣', '魔力', '能量', '鬥氣', '算力'];
const STAT_KEYS = Object.keys(SAMPLE_CHARACTER.baseStats);

/** 空白角色：所有欄位都有，技能與數值是 0（不能留空，不然升級存檔時會補上示範角色的資料） */
export function blankCharacter(name) {
  return {
    name, player: '', hp: 0, time: MAX_TIME, loginDays: 1, gold: 0, exp: 0, spentExp: 0,
    lifeSkills: Object.fromEntries(LIFE_SKILLS.map((s) => [s, 0])),
    arts: Object.fromEntries(ART_SKILLS.map((s) => [s, 0])),
    counters: Object.fromEntries(LIFE_SKILLS.map((s) => [s, 0])),
    restStomach: [], sessionStomach: [], keepsakes: {}, inventory: {}, sortOrder: [],
    baseStats: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])),
    equipment: { weapon: null, armor: null, acc1: null, acc2: null },
    gear: [], nextGearId: 1, gems: [], nextGemId: 1, toxicity: 0, buffs: { atk: 0, def: 0 },
    skills: {}, resources: Object.fromEntries(RESOURCES.map((r) => [r, 0])), shield: { hp: 0, res: 0 },
    moves: [], encounter: { monsters: [], next: { mob: 1, boss: 1 } }, migrated: {},
  };
}

/** 機器人的背包（一個物品一筆的清單，或已經是「名稱: 數量」）→ { 名稱: 數量 } */
export function countInventory(raw) {
  const out = {};
  const add = (name, n) => {
    const k = typeof name === 'string' ? name.trim() : '';
    if (!k || k.length > MAX_NAME || n <= 0) return;
    if (!(k in out) && Object.keys(out).length >= MAX_KINDS) return;
    out[k] = (out[k] ?? 0) + n;
  };
  if (Array.isArray(raw)) raw.forEach((name) => add(name, 1));
  else if (raw && typeof raw === 'object') Object.entries(raw).forEach(([name, n]) => add(name, nonNeg(n)));
  return out;
}

/**
 * bot：機器人存檔裡的一位玩家；base：網站上已有的角色（沒有就 null）。
 * 回傳 { data, summary } 或 { error }。不會修改傳進來的資料。
 */
export function convertBotPlayer(bot, base = null) {
  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) return { error: '不是玩家資料。' };
  const name = typeof bot.name === 'string' ? bot.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return { error: '缺少角色名稱。' };
  const data = base ? clone(base) : blankCharacter(name);
  const inventory = countInventory(bot.inventory);

  data.loginDays = Math.max(1, nonNeg(bot.login_days));
  data.time = Math.min(MAX_TIME, nonNeg(bot.time));
  data.gold = nonNeg(bot.gold);
  data.exp = nonNeg(bot.exp);
  data.spentExp = nonNeg(bot.spent_exp);
  data.inventory = inventory;
  data.sortOrder = Array.isArray(bot.sort_order)
    ? [...new Set(bot.sort_order.filter((n) => typeof n === 'string' && n in inventory))]
    : [];
  if (bot.counters && typeof bot.counters === 'object') {
    for (const s of LIFE_SKILLS) if (s in bot.counters) data.counters[s] = nonNeg(bot.counters[s]);
  }
  // 紀念品效果：機器人存檔沒有，沿用示範角色已知的（名稱相同就是同一個紀念品）
  data.keepsakes = { ...(data.keepsakes ?? {}) };
  for (const n of Object.keys(inventory)) if (SAMPLE_CHARACTER.keepsakes[n] && !data.keepsakes[n]) data.keepsakes[n] = clone(SAMPLE_CHARACTER.keepsakes[n]);

  if (!base) { // 新角色：最大生命照機器人；目前生命夾在 0～最大之間（倒地 = 0）
    const maxHp = Math.max(1, nonNeg(bot.max_hp));
    data.baseStats.生命 = maxHp;
    data.hp = Math.min(maxHp, Math.max(0, Math.floor(Number(bot.hp)) || 0));
  }
  return {
    data,
    summary: { name, kinds: Object.keys(inventory).length, items: Object.values(inventory).reduce((a, b) => a + b, 0), gold: data.gold, exp: data.exp, loginDays: data.loginDays },
  };
}
