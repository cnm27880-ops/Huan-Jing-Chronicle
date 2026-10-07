// ============================================================
// 戰鬥：A/B/C 三軌道（照搬機器人 deepseek_bot03.py）、遭遇戰、藥水。純邏輯。
//
// 機器人規則：每 1 點 = 擲 1D4；同軌道攻防各自加總後相減（最少 0）；三軌傷害相加。
// 網頁新增（試算表）：真實傷害／絕對防禦與一般傷害分開記錄，結算時「直接加進該招式的每一條軌道」
//   例：C 傷招式的 C 骰數 = 靈魂傷害 + 真實傷害 + 招式加成。（使用者 2026-10-07 口述）
//   絕對防禦：玩家防守時加進 A/B/C 三軌；怪物若有絕對防禦，則加在「該招用到的每條軌道」（使用者 2026-10-07 口述，對稱）。
// 傳說技能（使用者口述，2026-10-07）：
//   萬物歸一：A+B+C+真傷 一次對 A+B+C+絕防；大羅真仙：選定傷害+真傷 只打對方絕對防禦；
//   終焉武裝（被動）：無視對方絕對防禦（對方絕防視為 0；和大羅真仙同用＝對方沒有防禦）。
// 倒地：HP 歸零只是「倒地」，不會死亡（使用者口述）。
// ============================================================
import {
  TRACKS, TRACK_ATK_STAT, TRACK_DEF_STAT, TRUE_ATK, TRUE_DEF, POTIONS, TOXICITY_MAX,
} from './rules.js';
import { rollSum } from './dice.js';
import { derivedStats, maxHp } from './stats.js';
import { removeItem } from './engine.js';
import { passivesOf, skillLevel, moveExtra, SKILL_CATALOG, PASSIVE_RIDERS } from './skills.js';
import { actionCost, shortfall, pay, costText } from './resources.js';

/** 每 1 點 = 1 顆 D4 */
export const rollTrack = (points, rng = Math.random) => rollSum(points, 4, rng);

// ---------- A/B/C 字串（!記攻 六手 382C 的格式）----------
export function parseAbc(text) {
  const s = String(text ?? '').toUpperCase();
  const sum = (letter) =>
    [...s.matchAll(new RegExp(`(\\d+)\\s*${letter}`, 'g'))].reduce((a, m) => a + Number(m[1]), 0);
  return { A: sum('A'), B: sum('B'), C: sum('C') };
}
export function formatAbc(dice) {
  const parts = TRACKS.filter((t) => dice[t] > 0).map((t) => `${dice[t]}${t}`);
  return parts.length ? parts.join(' ') : '0';
}

// ---------- 出招與防禦的骰數 ----------
/**
 * 一招的攻擊骰數。move = { tracks:['C'], extra:{ C: 4 } }
 * 每條軌道 = 該軌道傷害 + 真實傷害 + 招式加成 + 藥水加成
 * 回傳 { dice:{A,B,C}, parts:{ C:[{label,value}] } }
 */
export function attackDice(state, move, potionBonus = 0) {
  const p = derivedStats(state);
  const brute = passivesOf(state).brute;
  const extra = moveExtra(state, move);
  const dice = { A: 0, B: 0, C: 0 };
  const parts = {};
  for (const t of move.tracks) {
    if (t === 'A' && brute) { parts[t] = [{ label: '暴徒：無法造成物理傷害', value: 0 }]; continue; }
    const list = [
      { label: TRACK_ATK_STAT[t], value: p[TRACK_ATK_STAT[t]].total },
      { label: TRUE_ATK, value: p[TRUE_ATK].total },
      { label: '招式加成', value: extra[t] ?? 0 },
      { label: '藥水', value: potionBonus },
    ];
    parts[t] = list.filter((x, i) => i < 2 || x.value !== 0);
    dice[t] = list.reduce((a, x) => a + x.value, 0);
  }
  return { dice, parts };
}

export const ATTACK_MODES = {
  normal: '一般',
  all: '萬物歸一（全部對全部）',
  abs: '大羅真仙（只打絕對防禦）',
};

/**
 * 單池攻擊（萬物歸一／大羅真仙）：把要用到的傷害骰數相加成一個池。
 * 萬物歸一 = 物+能+魂+真傷；大羅真仙 = 招式選定軌道 + 真傷（真傷只算一次）。
 * 回傳 { dice, parts } 其中 dice = 總骰數
 */
export function pooledAttack(state, move, potionBonus = 0) {
  const p = derivedStats(state);
  const brute = passivesOf(state).brute;
  const extra = moveExtra(state, move);
  const tracks = move.mode === 'all' ? TRACKS : move.tracks;
  const list = [
    ...tracks.map((t) => ({ label: TRACK_ATK_STAT[t], value: t === 'A' && brute ? 0 : p[TRACK_ATK_STAT[t]].total })),
    { label: TRUE_ATK, value: p[TRUE_ATK].total },
    { label: '招式加成', value: tracks.reduce((a, t) => a + (extra[t] ?? 0), 0) },
    { label: '藥水', value: potionBonus },
  ];
  const parts = list.filter((x, i) => i <= tracks.length || x.value !== 0);
  return { dice: list.reduce((a, x) => a + x.value, 0), parts };
}

/** 防守骰數：三條軌道各用對應防禦 + 絕對防禦 + 藥水加成 */
export function defenseDice(state, potionBonus = 0) {
  const p = derivedStats(state);
  const dice = { A: 0, B: 0, C: 0 };
  const parts = {};
  for (const t of TRACKS) {
    const list = [
      { label: TRACK_DEF_STAT[t], value: p[TRACK_DEF_STAT[t]].total },
      { label: TRUE_DEF, value: p[TRUE_DEF].total },
      { label: '藥水', value: potionBonus },
    ];
    parts[t] = list.filter((x, i) => i < 2 || x.value !== 0);
    dice[t] = list.reduce((a, x) => a + x.value, 0);
  }
  return { dice, parts };
}

// ---------- 結算（照機器人 calc_damage_str）----------
/** 逐軌：攻擊總和 − 防禦總和，最少 0；三軌相加 */
export function clash(atk, def, rng = Math.random) {
  const tracks = TRACKS.map((t) => {
    const atkRoll = rollTrack(atk[t], rng);
    const defRoll = rollTrack(def[t], rng);
    return { track: t, atkDice: atk[t], atkRoll, defDice: def[t], defRoll, damage: Math.max(0, atkRoll - defRoll) };
  });
  return { tracks, total: tracks.reduce((a, x) => a + x.damage, 0) };
}

/** 單池對決（萬物歸一／大羅真仙）：回傳格式與 clash 相同，只有一條「軌道」 */
export function clashPool(label, atkDice, defDice, rng = Math.random) {
  const atkRoll = rollTrack(atkDice, rng);
  const defRoll = rollTrack(defDice, rng);
  const t = { track: label, atkDice, atkRoll, defDice, defRoll, damage: Math.max(0, atkRoll - defRoll) };
  return { tracks: [t], total: t.damage };
}

// ---------- HP 與倒地 ----------
export const isDowned = (e) => e.hp <= 0;
const clampHp = (e, max) => Math.max(0, Math.min(max, e.hp));

/** 扣玩家生命；有護盾（生生造化印）時先扣護盾，護盾破了抗性加成就消失。回傳 { toShield, toHp } */
export function damagePlayer(state, dmg) {
  let toShield = 0;
  if (state.shield?.hp > 0 && dmg > 0) {
    toShield = Math.min(state.shield.hp, dmg);
    state.shield.hp -= toShield;
    if (state.shield.hp <= 0) state.shield = { hp: 0, res: 0 };
  }
  const toHp = dmg - toShield;
  state.hp = Math.max(0, state.hp - toHp);
  return { toShield, toHp };
}
export function healPlayer(state, n) {
  state.hp = clampHp({ hp: state.hp + n }, maxHp(state));
}

// ---------- 怪物（照機器人 generate_abc_split）----------
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 把總強度隨機分到 A/B/C 三軌，再加上區域補正 bonus（{A,B,C}） */
export function generateAbcSplit(total, bonus = { A: 0, B: 0, C: 0 }, rng = Math.random) {
  const stats = { A: 0, B: 0, C: 0 };
  if (total > 0) {
    const mode = ['extreme', 'dual', 'balanced'][Math.floor(rng() * 3)];
    let vals;
    if (mode === 'extreme') {
      let v1 = Math.max(1, Math.floor(total * (0.6 + 0.2 * rng())));
      if (v1 === total && total > 1) v1 -= 1;
      const rem = total - v1;
      const v2 = Math.floor(rem / 2);
      vals = [v1, v2, rem - v2];
    } else if (mode === 'dual') {
      const v1 = Math.floor(total * (0.25 * rng()));
      const rem = total - v1;
      const v2 = Math.floor(rem / 2);
      vals = [v1, v2, rem - v2];
    } else {
      vals = [Math.floor(total / 3), Math.floor(total / 3), Math.floor(total / 3)];
      for (let i = 0; i < total % 3; i++) vals[i] += 1;
    }
    shuffle(vals, rng);
    [stats.A, stats.B, stats.C] = vals;
  }
  return { A: stats.A + (bonus.A ?? 0), B: stats.B + (bonus.B ?? 0), C: stats.C + (bonus.C ?? 0) };
}

export const BOSS_ATK_MODES = ['輕擊', '重擊', '絕殺'];
export const BOSS_DEF_MODES = ['常規', '變換', '極限'];

export const newEncounter = () => ({ monsters: [], next: { mob: 1, boss: 1 } });

/** 新增小怪：power 是機器人的「強度」（會隨機分配到三軌） */
export function addMobs(enc, { count, atkPower, defPower, hp, atkMod = '', defMod = '', absDef = 0 }, rng = Math.random) {
  const added = [];
  for (let i = 0; i < count; i++) {
    const m = {
      id: `小怪${enc.next.mob++}`, kind: 'mob', hp, maxHp: hp, abs: absDef,
      atk: generateAbcSplit(atkPower, parseAbc(atkMod), rng),
      def: generateAbcSplit(defPower, parseAbc(defMod), rng),
    };
    enc.monsters.push(m);
    added.push(m);
  }
  return added;
}

/** 新增 BOSS：攻擊 3 組（輕擊/重擊/絕殺）、防禦 3 組（常規/變換/極限） */
export function addBosses(enc, { count, atkPower, defPower, hp, atkMod = '', defMod = '', absDef = 0 }, rng = Math.random) {
  const added = [];
  for (let i = 0; i < count; i++) {
    const m = {
      id: `BOSS${enc.next.boss++}`, kind: 'boss', hp, maxHp: hp, abs: absDef,
      atk: [0, 1, 2].map(() => generateAbcSplit(atkPower, parseAbc(atkMod), rng)),
      def: [0, 1, 2].map(() => generateAbcSplit(defPower, parseAbc(defMod), rng)),
    };
    enc.monsters.push(m);
    added.push(m);
  }
  return added;
}

export const removeMonster = (enc, id) => {
  enc.monsters = enc.monsters.filter((m) => m.id !== id);
};
export const monsterAtk = (m, mode = 0) => (m.kind === 'boss' ? m.atk[mode] : m.atk);
export const monsterAbs = (m) => m.abs ?? 0;
export const monsterDef = (m, mode = 0) => (m.kind === 'boss' ? m.def[mode] : m.def);

// ---------- 一次出招／承受攻擊 ----------
/** 單一目標的出招結算（不含花費與回復），回傳該目標的結果 */
function resolveHit(state, move, target, mode, atkPlan, rng) {
  const potion = state.buffs.atk;
  const ignoreAbs = passivesOf(state).ignoreAbs;
  const abs = ignoreAbs ? 0 : monsterAbs(target);
  const base = monsterDef(target, mode);
  let def;
  let result;
  if (move.mode === 'all') {
    def = { dice: base.A + base.B + base.C + abs };
    result = clashPool('全部', atkPlan.dice, def.dice, rng);
  } else if (move.mode === 'abs') {
    def = { dice: abs };
    result = clashPool('絕防', atkPlan.dice, def.dice, rng);
  } else {
    // 怪物的絕對防禦加在這招用到的每一條軌道
    def = TRACKS.reduce((o, t) => ({ ...o, [t]: base[t] + (move.tracks.includes(t) ? abs : 0) }), {});
    result = clash(atkPlan.dice, def, rng);
  }
  const before = target.hp;
  target.hp = Math.max(0, target.hp - result.total);
  return { target, def, result, potion, abs, ignoreAbs, lost: before - target.hp, extraLines: [] };
}

/**
 * 玩家對怪物出招。流程：付資源（含魔女額外 30 魔力）→ 對每個目標結算 → 響應效果（百分比傷害、吸血）。
 * opts.yuwai：域外魔祖「花 30 靈氣，追加扣目標現有生命 10%」（只對修仙招式）。
 * 回傳 { move, target, hits[], cost, heal, ... }；失敗回傳 { error }。第一個目標的欄位也放在最外層，方便畫面使用。
 */
export function playerAttack(state, enc, moveId, monsterId, mode = 0, rng = Math.random, opts = {}) {
  const move = state.moves.find((m) => m.id === moveId);
  const first = enc.monsters.find((m) => m.id === monsterId);
  if (!move) return { error: '找不到這個招式。' };
  if (move.kind === 'heal' || move.kind === 'shield') return { error: `${move.name}是輔助技能，請用「使用」按鈕。` };
  if (!first) return { error: '找不到目標。' };
  if (isDowned(state)) return { error: '你已經倒地，無法出招。' };
  const targets = [first, ...enc.monsters.filter((m) => m !== first && !isDowned(m))].slice(0, Math.max(1, move.targets ?? 1));
  const yuwai = Boolean(opts.yuwai) && skillLevel(state, '域外魔祖') > 0 && move.school === '修仙';
  const extraCost = yuwai ? PASSIVE_RIDERS.域外魔祖.cost : {};
  const cost = actionCost(state, move, extraCost);
  const lack = shortfall(state, cost);
  if (lack) return { error: `資源不足：${lack}（需要 ${costText(cost)}）` };
  pay(state, cost);

  const potion = state.buffs.atk;
  const pooled = move.mode === 'all' || move.mode === 'abs';
  const atk = pooled ? pooledAttack(state, move, potion) : attackDice(state, move, potion);
  const hits = targets.map((t) => resolveHit(state, move, t, mode, atk, rng));
  const notes = [];

  // 響應：萬物歸一破防時，額外扣目標現有生命 %
  const cat = move.skill ? SKILL_CATALOG[move.skill] : null;
  if (cat?.bonusCurrentPct) {
    for (const h of hits) if (h.result.total > 0 && h.target.hp > 0) {
      const x = Math.floor((h.target.hp * cat.bonusCurrentPct) / 100);
      h.target.hp -= x; h.lost += x; h.bonus = x;
      notes.push(`${cat.bonusCurrentPct}% 現有生命：${h.target.id} 額外 −${x}`);
    }
  }
  // 響應：域外魔祖（修仙招式造成傷害後，直接扣現有生命 10%）
  if (yuwai) {
    for (const h of hits) if (h.result.total > 0 && h.target.hp > 0) {
      const x = Math.floor((h.target.hp * PASSIVE_RIDERS.域外魔祖.currentPct) / 100);
      h.target.hp -= x; h.lost += x; h.yuwai = x;
      notes.push(`域外魔祖：${h.target.id} 現有生命 10% = −${x}`);
    }
  }
  // 回復類：吞天噬血陣（招式內建）、不可名狀（被動，神秘招式）。回復的是「目標扣除的生命」的一半，總量有上限
  const drains = [];
  if (move.skill && SKILL_CATALOG[move.skill]?.drain) {
    const d = SKILL_CATALOG[move.skill].drain;
    drains.push({ name: move.name, ratio: d.ratio, cap: Math.floor((maxHp(state) * d.capPct) / 100) });
  }
  const lvUnn = skillLevel(state, '不可名狀');
  if (lvUnn > 0 && move.school === PASSIVE_RIDERS.不可名狀.school) {
    const r = PASSIVE_RIDERS.不可名狀;
    drains.push({ name: '不可名狀', ratio: r.ratio, cap: Math.floor((maxHp(state) * (r.capBasePct + r.capPerLevelPct * lvUnn)) / 100) });
  }
  let healed = 0;
  for (const d of drains) {
    const lost = hits.reduce((a, h) => a + h.lost, 0);
    const want = Math.min(Math.floor(lost * d.ratio), d.cap);
    const before = state.hp;
    healPlayer(state, want);
    const got = state.hp - before;
    healed += got;
    notes.push(`${d.name}：目標共損失 ${lost} 生命，回復 ${got}（上限 ${d.cap}）`);
  }

  state.buffs.atk = 0;
  const h0 = hits[0];
  return {
    move, target: h0.target, mode, atk, def: h0.def, result: h0.result, potion, ignoreAbs: h0.ignoreAbs, abs: h0.abs,
    hits, cost, healed, notes, downed: isDowned(h0.target),
  };
}

/** 輔助技能（納米醫療蜂、生生造化印）。目前單人試玩只能對自己使用；tier = 花費檔位（0~2） */
export function useSupport(state, moveId, tier = 0) {
  const move = state.moves.find((m) => m.id === moveId);
  const cat = move?.skill ? SKILL_CATALOG[move.skill] : null;
  if (!move || !cat?.tiers) return { error: '這不是輔助技能。' };
  if (isDowned(state)) return { error: '你已經倒地，無法行動。' };
  const t = cat.tiers[tier];
  if (!t) return { error: '沒有這個檔位。' };
  const cost = actionCost(state, move, t.cost);
  const lack = shortfall(state, cost);
  if (lack) return { error: `資源不足：${lack}（需要 ${costText(cost)}）` };
  pay(state, cost);
  const lv = skillLevel(state, move.skill);
  const amount = Math.floor((maxHp(state) * t.pct) / 100);
  if (cat.kind === 'heal') {
    const before = state.hp;
    healPlayer(state, amount);
    return { move, cost, pct: t.pct, amount, healed: state.hp - before, targets: cat.targetsAt(lv), kind: 'heal' };
  }
  const res = cat.resAt(lv);
  state.shield = { hp: amount, res }; // 重新施放會直接取代舊護盾（不可疊加）
  return { move, cost, pct: t.pct, amount, res, kind: 'shield' };
}

/** 怪物攻擊玩家：玩家用三軌防禦 + 絕對防禦；會消耗「下次防禦」藥水加成並扣玩家 HP */
export function monsterAttack(state, enc, monsterId, mode = 0, rng = Math.random) {
  const monster = enc.monsters.find((m) => m.id === monsterId);
  if (!monster) return { error: '找不到這隻怪物。' };
  if (isDowned(monster)) return { error: `${monster.id} 已經倒下。` };
  const potion = state.buffs.def;
  const def = defenseDice(state, potion);
  const atk = monsterAtk(monster, mode);
  const result = clash(atk, def.dice, rng);
  state.buffs.def = 0;
  const wasDowned = isDowned(state);
  const absorbed = damagePlayer(state, result.total);
  return { monster, mode, atk, def, result, potion, absorbed, downed: isDowned(state), newlyDowned: !wasDowned && isDowned(state) };
}

// ---------- 藥水 ----------
/**
 * 喝藥水：消耗 1 個、累積毒性、回血或加成「下次攻擊／防禦」。
 * 毒性上限 15：加上這瓶會超過 15 就不能喝；戰鬥結束時清零（見 endBattle）。
 * 黃/綠藥水 = 暫時的真傷／絕防骰數（真傷只加在用到的軌道，絕防加在三軌）；多瓶相加。
 */
export function drinkPotion(state, name, rng = Math.random) {
  const def = POTIONS[name];
  if (!def) return { error: `${name}不是藥水。` };
  // 毒性不會超過 15：加上這瓶會超過就不能喝（使用者 2026-10-07：毒性 14 時不能喝 +2 的，只能喝 +1 的）
  if (state.toxicity + def.toxicity > TOXICITY_MAX) {
    return { error: `毒性 ${state.toxicity}，喝${name}（毒性 +${def.toxicity}）會超過 ${TOXICITY_MAX}，不能喝。戰鬥結束後毒性歸零。` };
  }
  if (!removeItem(state, name)) return { error: `背包裡沒有${name}。` };
  state.toxicity += def.toxicity;
  const out = { name, toxicity: state.toxicity, atLimit: state.toxicity >= TOXICITY_MAX };
  if (def.heal) {
    const rolled = rollSum(def.heal.n, def.heal.sides, rng);
    const before = state.hp;
    healPlayer(state, rolled);
    out.rolled = rolled;
    out.healed = state.hp - before;
    out.dice = `${def.heal.n}D${def.heal.sides}`;
  }
  if (def.restore) {
    out.restored = {};
    for (const [res, pct] of Object.entries(def.restore)) {
      const max = derivedStats(state)[res]?.total ?? 0;
      const before = state.resources[res] ?? 0;
      state.resources[res] = Math.min(max, before + Math.floor((max * pct) / 100));
      out.restored[res] = state.resources[res] - before;
    }
  }
  if (def.atk) { state.buffs.atk += def.atk; out.atk = def.atk; }
  if (def.def) { state.buffs.def += def.def; out.def = def.def; }
  return out;
}

/**
 * 把回復藥水餵給隊友（倒地也可以，等於把對方拉起來）：藥水從 giver 的背包扣；
 * 回復量照藥水的骰數，毒性算在「被救的人」身上（使用者 2026-10-07），超過 15 就不能餵。
 * 只能是回復藥水；黃／綠藥水是自己的下次攻擊／防禦加成，不能給別人。
 */
export function giveHealPotion(giver, target, name, rng = Math.random) {
  const def = POTIONS[name];
  if (!def?.heal) return { error: `${name}不是回復藥水。` };
  if (target.toxicity + def.toxicity > TOXICITY_MAX) {
    return { error: `${target.name} 毒性 ${target.toxicity}，喝${name}（毒性 +${def.toxicity}）會超過 ${TOXICITY_MAX}，不能餵。` };
  }
  if (!removeItem(giver, name)) return { error: `背包裡沒有${name}。` };
  const wasDowned = isDowned(target);
  target.toxicity += def.toxicity;
  const rolled = rollSum(def.heal.n, def.heal.sides, rng);
  const before = target.hp;
  healPlayer(target, rolled);
  return { name, rolled, healed: target.hp - before, toxicity: target.toxicity, revived: wasDowned && !isDowned(target) };
}

/** 結束戰鬥：毒性歸零、藥水加成清除、清空遭遇戰（使用者口述：戰鬥結束毒性清零） */
export function endBattle(state) {
  const out = { toxicity: state.toxicity, monsters: state.encounter.monsters.length };
  state.toxicity = 0;
  state.buffs = { atk: 0, def: 0 };
  state.shield = { hp: 0, res: 0 };
  state.encounter = newEncounter();
  return out;
}

export { maxHp };
