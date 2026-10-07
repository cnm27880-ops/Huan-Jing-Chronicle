// ============================================================
// 裝備：鑑定（骰數值）、裝備欄、換算成數值加成。純邏輯，不碰畫面。
// 規則見 GAME_RULES.md「裝備」。一件武器/防具只加一種屬性；飾品可能加一種，或「特殊」。
// ============================================================
import {
  GEAR_TIERS, GEAR_TIER_ALIAS, GEAR_SLOT_NAME, GEAR_BONUS, WEAPON_STATS, ARMOR_STATS,
  ACC_STATS, ACC_VALUES, ACC_SPECIAL_ROLL, EQUIP_SLOTS,
} from './rules.js';
import { rollDie, rollSum } from './dice.js';
import { removeItem, countOf } from './engine.js';

/** 通用裝備名稱，例如「傳說武器」。回傳 { tier, slot } 或 null（「低階」視為「初階」） */
export function parseGeneric(name) {
  const m = String(name).match(/^(初階|低階|進階|大師|傳說)(武器|防具|飾品)$/);
  if (!m) return null;
  const slot = { 武器: 'weapon', 防具: 'armor', 飾品: 'accessory' }[m[2]];
  return { tier: GEAR_TIER_ALIAS[m[1]] ?? m[1], slot };
}

/** 擲一件裝備的數值。回傳 { effects, special?, roll } 不含 id */
export function rollGear(tier, slot, rng = Math.random) {
  if (slot === 'accessory') {
    const r = rollDie(15, rng);
    const v = ACC_VALUES[tier];
    const one = (n) => { const stat = ACC_STATS[n - 1]; return { stat, value: n <= 8 ? v.attr : v[stat] }; };
    if (r !== ACC_SPECIAL_ROLL) return { effects: [one(r)], roll: { d15: r } };
    // 「特殊」：再骰兩次 D14 得到兩條屬性，不會再骰到特殊（使用者推論，未經 GM 確認）；
    // 兩次骰到同一屬性就把數值相加成一條（我的假設，需驗證）
    const extra = [rollDie(14, rng), rollDie(14, rng)];
    const effects = [];
    for (const n of extra) {
      const e = one(n);
      const hit = effects.find((x) => x.stat === e.stat);
      if (hit) hit.value += e.value; else effects.push(e);
    }
    return { effects, special: true, roll: { d15: r, extra } };
  }
  const b = GEAR_BONUS[tier];
  const base = rollSum(b.n, b.sides, rng);
  const d4 = rollDie(4, rng);
  const stat = (slot === 'weapon' ? WEAPON_STATS : ARMOR_STATS)[d4 - 1];
  return { effects: [{ stat, value: base + b.add }], roll: { base, add: b.add, d4 } };
}

export const gearName = (g) => g.name ?? `${g.tier}${GEAR_SLOT_NAME[g.slot]}`;
export const effectText = (g) =>
  g.effects.length
    ? `${g.special ? '特殊：' : ''}${g.effects.map((e) => `${e.stat}+${e.value}`).join('；')}`
    : `特殊${g.note ? `：${g.note}` : '（效果由 GM 設定）'}`;

/** 範圍文字，給畫面顯示：傳說武器 → 「1D24+12」 */
export const gearDiceText = (tier, slot) => {
  if (slot === 'accessory') return '1D15 決定屬性';
  const b = GEAR_BONUS[tier];
  return `${b.n}D${b.sides}${b.add ? `+${b.add}` : ''}`;
};

/** 背包裡可鑑定的通用裝備：[{ name, tier, slot, qty }] */
export function identifiable(state) {
  return Object.entries(state.inventory)
    .map(([name, qty]) => ({ name, qty, ...parseGeneric(name) }))
    .filter((x) => x.tier && x.qty > 0)
    .sort((a, b) => GEAR_TIERS.indexOf(b.tier) - GEAR_TIERS.indexOf(a.tier) || a.slot.localeCompare(b.slot));
}

/** 鑑定 times 件（會消耗通用裝備），結果存入 state.gear。回傳新產生的裝備陣列 */
export function identify(state, genericName, times, rng = Math.random) {
  const g = parseGeneric(genericName);
  if (!g) return [];
  const made = [];
  for (let i = 0; i < times; i++) {
    if (!removeItem(state, genericName)) break;
    const rolled = rollGear(g.tier, g.slot, rng);
    const inst = { id: state.nextGearId++, tier: g.tier, slot: g.slot, ...rolled };
    state.gear.push(inst);
    made.push(inst);
  }
  return made;
}

export const findGear = (state, id) => state.gear.find((g) => g.id === id) ?? null;

/** 裝備這一件：欄位可以是 weapon / armor / acc1 / acc2。回傳錯誤文字或 null */
export function equip(state, id, slotKey) {
  const g = findGear(state, id);
  if (!g) return '找不到這件裝備。';
  if (!EQUIP_SLOTS.includes(slotKey)) return '沒有這個裝備欄。';
  const want = slotKey.startsWith('acc') ? 'accessory' : slotKey;
  if (g.slot !== want) return `這件不能放進${GEAR_SLOT_NAME[want]}欄。`;
  state.gear = state.gear.filter((x) => x.id !== id);
  const old = state.equipment[slotKey];
  if (old) state.gear.push(old);
  state.equipment[slotKey] = g;
  return null;
}

export function unequip(state, slotKey) {
  const old = state.equipment[slotKey];
  if (!old) return;
  state.gear.push(old);
  state.equipment[slotKey] = null;
}

/** 丟棄（刪除）已鑑定的裝備 */
export function discard(state, ids) {
  const set = new Set(ids);
  const before = state.gear.length;
  state.gear = state.gear.filter((g) => !set.has(g.id));
  return before - state.gear.length;
}

/** 目前身上裝備提供的數值：{ 屬性: 加成 } */
export function equipmentEffects(state) {
  const out = {};
  for (const g of Object.values(state.equipment)) {
    if (!g) continue;
    for (const e of g.effects) out[e.stat] = (out[e.stat] ?? 0) + e.value;
  }
  return out;
}

/**
 * 和身上對應欄位比較：
 * 'empty' 該欄是空的｜'better' 同屬性且更高｜'worse' 同屬性且更低｜'same' 同屬性且相同｜'different' 屬性不同無法比較
 * 飾品有兩欄：和「同屬性的那件」比；都沒有同屬性就視為 different
 */
export function compareGear(state, g) {
  const slots = g.slot === 'accessory' ? ['acc1', 'acc2'] : [g.slot];
  const cur = slots.map((s) => state.equipment[s]);
  if (cur.some((c) => !c)) return 'empty';
  if (g.special || g.effects.length !== 1) return 'different';
  const same = cur.filter((c) => c.effects.length === 1 && c.effects[0].stat === g.effects[0].stat);
  if (!same.length) return 'different';
  const lowest = Math.min(...same.map((c) => c.effects[0].value));
  const v = g.effects[0].value;
  return v > lowest ? 'better' : v < lowest ? 'worse' : 'same';
}

/**
 * 找出「一定用不到」的已鑑定裝備（只含單一屬性的裝備，特殊飾品不動）：
 * 同欄位類型、同屬性的裝備只需要留下最高的幾件（武器/防具 1 件、飾品 2 件，身上穿的算在內）。
 * 回傳可丟棄的 id 陣列。身上穿著的永遠不會被列入。
 */
export function findJunk(state) {
  const groups = new Map();
  const add = (g, worn) => {
    if (g.special || g.effects.length !== 1) return;
    const key = `${g.slot}:${g.effects[0].stat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ g, worn, value: g.effects[0].value });
  };
  Object.values(state.equipment).forEach((g) => g && add(g, true));
  state.gear.forEach((g) => add(g, false));
  const junk = [];
  for (const [key, list] of groups) {
    const cap = key.startsWith('accessory') ? 2 : 1;
    list.sort((a, b) => b.value - a.value || Number(b.worn) - Number(a.worn) || a.g.id - b.g.id);
    list.slice(cap).forEach((x) => { if (!x.worn) junk.push(x.g.id); });
  }
  return junk;
}

/** 背包中通用裝備與已鑑定裝備的總數，給畫面顯示 */
export const genericCount = (state) => identifiable(state).reduce((a, x) => a + x.qty, 0);
export { countOf };
