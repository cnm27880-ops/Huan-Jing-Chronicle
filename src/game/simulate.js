// ============================================================
// 模擬戰（階段 D，純函式）：GM 選幾位玩家＋一組敵人，跑很多場，看勝率、回合數、每回合傷害、剩餘生命。
// 全部在複本上算，不碰任何真實存檔；規則都是 combat.js 的同一批函式（rng 可替換，測試用固定亂數）。
//
// 行為假設（使用者 2026-10-07 確認，標「需驗證」的是我補的細節）：
//   出招：用「續航最長」的招式（資源能放最多次的那個），資源不夠就換下一個，最後用普攻（不花資源；魔女連普攻也要多花 30 魔力，付不起就放棄行動回復魔力）
//   怪物：每隻怪物每回合隨機打一位還沒倒地的玩家；BOSS 的輕擊／重擊／絕殺由被打的玩家挑「預期傷害最低」的那種
//   藥水：自動喝，毒性滿了就不能喝；隊友倒地時，有回復藥水的隊友會餵（毒性算被救的人）；喝藥水不佔用行動；攻擊／防禦加成藥水只要身上沒有加成就喝（需驗證）
//   勝負：怪物全倒＝勝；玩家全員倒地＝敗；超過回合上限＝平手
//   每回合順序：玩家依序行動，再輪到怪物（沒有模擬先攻；需驗證）
// 2026/10 第二次更新（使用者 2026-10-10）：
//   黃／綠藥水「需要才喝」（需驗證）：攻擊藥水只在「不喝打不死、喝了打得死」眼前這隻時才喝；防禦藥水在生命低於 60% 時才喝。
//   血藥供應：假設每位玩家都備足血藥、毒性 15 都拿來喝血（opts.supply 指定哪一種；沒給就只用自己背包裡的）。
//   怪物攻擊分配（opts.focus，需驗證）：'random' 每一下隨機挑一位；'spread' 平均分散——每一下打「這場被打次數最少」的人（同數隨機），
//   等於 GM 輪流分配、不會一直打同一個人。每位玩家的被打次數與受傷占生命比例都記下來。
//   每位玩家的貢獻與消耗都記下來（perPlayer），檢驗「第一名只出部分力、隊伍也要贏」（opts.caps，見 fairness.js）。
// 2026/10 平衡更新（見 enemy.js）：
//   敵人（需驗證）：每回合開始就把 B 技能（防禦強化）用滿，玩家每打他一下消耗一次蓄力；輪到他時，血量沒滿就喝血（C），
//   再用 A 技能（攻擊強化），然後打出這一等級每回合的攻擊次數（普通 1、菁英 2、BOSS 3），每一下各隨機挑一位還沒倒地的玩家
//   玩家（需驗證）：出招時花「現有鬥氣的 1/3（進位）」加骰（付不起就不加）；生命低於 40% 時把靈氣換成生命（最多補到滿）；不用能量轉換
// ============================================================
import {
  newEncounter, addMobs, addBosses, playerAttack, monsterAttack, defenseDice, attackDice, isDowned,
  drinkPotion, giveHealPotion, monsterDef, monsterAbs, monsterAtk, pooledAttack,
} from './combat.js';
import { POTIONS, TOXICITY_MAX, TRACKS } from './rules.js';
import { maxHp } from './stats.js';
import { actionCost, restoreAllResources, resourceNow, resourceMax, witchRest, OTHER_RESOURCES, convertResource, setResource } from './resources.js';
import { passivesOf } from './skills.js';
import { countOf, addItem } from './engine.js';
import { rankInfo, useEnemySkill, spendEnemyAttack, spendEnemyB, pendingEnemyB } from './enemy.js';

export const DEFAULT_MAX_ROUNDS = 60;

/** 固定種子的亂數（mulberry32）：自動調整時每組候選都用同一批種子，結果只受敵人數值影響、不受運氣影響（不然 40 場的雜訊會蓋過調整的效果） */
export function seededRng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const isSupport = (m) => m.kind === 'heal' || m.kind === 'shield';
const sum = (o) => TRACKS.reduce((a, t) => a + (o[t] ?? 0), 0);

/** 這個招式現在最多能放幾次（資源付得起的次數；以生命付費時付完必須仍 > 0） */
export function castsAffordable(state, move) {
  const cost = actionCost(state, move);
  let casts = 1e6;
  for (const [r, v] of Object.entries(cost)) {
    if (v <= 0) continue;
    const avail = r === '生命' ? resourceNow(state, r) - 1 : resourceNow(state, r);
    casts = Math.min(casts, Math.floor(avail / v));
  }
  return casts;
}

/** 續航最長的招式；一次都放不出來就用普攻；連普攻都沒有回傳 null */
export function pickMove(state) {
  let best = null;
  for (const m of state.moves) {
    if (isSupport(m) || m.id === 'basic') continue;
    const casts = castsAffordable(state, m);
    if (casts < 1) continue;
    const power = sum(attackDice(state, m).dice);
    if (!best || casts > best.casts || (casts === best.casts && power > best.power)) best = { move: m, casts, power };
  }
  return best?.move ?? state.moves.find((m) => m.id === 'basic') ?? null;
}

/** 玩家打 BOSS 時選對自己最有利的防禦組合（這招用到的軌道上，BOSS 防禦最低的那種） */
function bestDefMode(monster, move) {
  if (monster.kind !== 'boss') return 0;
  const tracks = move.mode === 'all' ? TRACKS : move.tracks;
  let best = 0; let bestVal = Infinity;
  for (let mode = 0; mode < 3; mode++) {
    const d = monsterDef(monster, mode);
    const v = tracks.reduce((a, t) => a + d[t], 0);
    if (v < bestVal) { best = mode; bestVal = v; }
  }
  return best;
}

/** 被 BOSS 打的玩家挑預期傷害最低的攻擊（每顆 1D4，平均 2.5） */
function bestAtkMode(monster, player) {
  if (monster.kind !== 'boss') return 0;
  const def = defenseDice(player, player.buffs.def).dice;
  let best = 0; let bestVal = Infinity;
  for (let mode = 0; mode < 3; mode++) {
    const atk = monsterAtk(monster, mode);
    const v = TRACKS.reduce((a, t) => a + Math.max(0, 2.5 * (atk[t] - def[t])), 0);
    if (v < bestVal) { best = mode; bestVal = v; }
  }
  return best;
}

const healPotions = (state) => Object.keys(POTIONS).filter((n) => POTIONS[n].heal && countOf(state, n) > 0)
  .sort((a, b) => POTIONS[b].heal.n * (POTIONS[b].heal.sides + 1) - POTIONS[a].heal.n * (POTIONS[a].heal.sides + 1)); // 大瓶的在前

/** 這一招對這隻怪的預期傷害（每顆 1D4 平均 2.5；bonus = 藥水加成顆數） */
function expectedDamage(p, move, target, bonus, extraAbs) {
  const abs = (passivesOf(p).ignoreAbs ? 0 : monsterAbs(target)) + extraAbs;
  const base = monsterDef(target, bestDefMode(target, move));
  if (move.mode === 'all') return Math.max(0, 2.5 * (pooledAttack(p, move, bonus, 0).dice - (base.A + base.B + base.C + abs)));
  if (move.mode === 'abs') return Math.max(0, 2.5 * (pooledAttack(p, move, bonus, 0).dice - abs));
  const a = attackDice(p, move, bonus, 0).dice;
  return TRACKS.reduce((acc, t) => acc + Math.max(0, 2.5 * (a[t] - (base[t] + (move.tracks.includes(t) ? abs : 0)))), 0);
}

const buffPotions = (state, kind) => Object.keys(POTIONS)
  .filter((n) => POTIONS[n][kind] && countOf(state, n) > 0 && state.toxicity + POTIONS[n].toxicity <= TOXICITY_MAX)
  .sort((a, b) => POTIONS[a][kind] - POTIONS[b][kind]); // 小瓶的在前

/** 輪到 actor 時自動用藥水（不佔行動）：救倒地的隊友 → 自己血少時喝回復 → 需要才喝攻擊／防禦藥水。回傳用掉幾瓶 */
function usePotions(actor, team, enc, rng, enemyB) {
  let used = 0;
  const downed = team.filter((p) => p !== actor && isDowned(p));
  for (const t of downed) {
    const name = healPotions(actor).find((n) => t.toxicity + POTIONS[n].toxicity <= TOXICITY_MAX);
    if (name && !giveHealPotion(actor, t, name, rng).error) { used++; break; } // 一回合救一位
  }
  if (!used && actor.hp < maxHp(actor) / 2) {
    const name = healPotions(actor).find((n) => actor.toxicity + POTIONS[n].toxicity <= TOXICITY_MAX);
    if (name && !drinkPotion(actor, name, rng).error) used++;
  }
  // 防禦藥水：生命掉到 60% 以下、身上沒有防禦加成才喝（最大瓶的）
  if (actor.buffs.def <= 0 && actor.hp < maxHp(actor) * 0.6) {
    const name = buffPotions(actor, 'def').pop();
    if (name && !drinkPotion(actor, name, rng).error) used++;
  }
  // 攻擊藥水：不喝打不死眼前這隻、喝了打得死，才喝（挑剛好夠的最小瓶）
  const target = enc.monsters.find((m) => !isDowned(m));
  const move = target && actor.buffs.atk <= 0 ? pickMove(actor) : null;
  if (move && move.kind !== 'heal' && move.kind !== 'shield' && castsAffordable(actor, move) >= 1) {
    const extra = enemyB(target);
    if (expectedDamage(actor, move, target, 0, extra) < target.hp) {
      const name = buffPotions(actor, 'atk').find((n) => expectedDamage(actor, move, target, POTIONS[n].atk, extra) >= target.hp);
      if (name && !drinkPotion(actor, name, rng).error) used++;
    }
  }
  return used;
}

/** 一場模擬開始前的玩家複本：生命與資源補滿、毒性與藥水加成歸零（跟新的一場戰鬥一樣） */
export function prepPlayer(src, { supply = null, cap = 1 } = {}) {
  const p = structuredClone(src);
  restoreAllResources(p);
  p.toxicity = 0; p.buffs = { atk: 0, def: 0 }; p.shield = { hp: 0, res: 0 };
  if (supply && POTIONS[supply]?.heal) { // 假設血藥備足：毒性 15 剛好喝完（至少備到喝得滿）
    const need = Math.ceil(TOXICITY_MAX / POTIONS[supply].toxicity);
    if (countOf(p, supply) < need) addItem(p, supply, need - countOf(p, supply));
  }
  if (cap < 1) { // 這位玩家只出 cap 比例的力：資源（不含生命）只有一部分，毒性也先佔掉一部分，等於少喝幾瓶
    for (const r of OTHER_RESOURCES) setResource(p, r, Math.floor(resourceNow(p, r) * cap));
    p.toxicity = Math.ceil(TOXICITY_MAX * (1 - cap));
  }
  return p;
}

/** 依敵人設定產生一組怪物（每場各自隨機分配 A/B/C，和遊戲裡一樣） */
export function buildEncounter(specs, rng = Math.random) {
  const enc = newEncounter();
  for (const { kind, ...spec } of specs) {
    if (kind === 'boss') addBosses(enc, spec, rng);
    else addMobs(enc, kind === 'elite' ? { ...spec, rank: 'elite' } : spec, rng); // 'mob' 普通、'elite' 菁英
  }
  return enc;
}

/** 固定敵人的複本：生命補滿（不影響原本的資料） */
export function fixedEncounter(src) {
  const enc = newEncounter();
  enc.monsters = structuredClone(src.monsters ?? []).map((m) => { const x = { ...m, hp: m.maxHp }; delete x.uses; delete x.charge; delete x.usedC; return x; });
  return enc;
}

/** 怪物這一下打誰：random 隨機；spread 打「這場被打次數最少」的人，同數的隨機挑 */
function pickVictim(victims, team, stat, focus, rng) {
  if (focus !== 'spread') return victims[Math.floor(rng() * victims.length)];
  const least = Math.min(...victims.map((p) => stat[team.indexOf(p)].hit));
  const pool = victims.filter((p) => stat[team.indexOf(p)].hit === least);
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * 玩家出一次招：挑招式、花鬥氣加骰、付不起就退回普攻；魔女付不起就放棄行動回復魔力。
 * 回傳 { r, target }（r 是 playerAttack 的結果），沒得出招回傳 null。
 */
export function act(p, enc, rng) {
  const target = enc.monsters.find((m) => !isDowned(m));
  if (!target) return null;
  let move = pickMove(p);
  if (move && castsAffordable(p, move) < 1) { // 連普攻都付不起（魔女每次行動多花 30 魔力）：魔女放棄行動回復魔力，其他人只能略過
    if (passivesOf(p).witch) witchRest(p);
    return null;
  }
  const extraAbs = { [target.id]: pendingEnemyB(enc, target) };
  const dou = Math.ceil(resourceNow(p, '鬥氣') / 3); // 鬥氣加骰（付不起就退回不加）
  let r = move ? playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng, { dou, extraAbs }) : { error: 'no move' };
  if (r.error && dou && move) r = playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng, { extraAbs });
  if (r.error && move?.id !== 'basic') { // 付不起（例如被魔女額外花費卡住）就退回普攻
    move = p.moves.find((m) => m.id === 'basic');
    r = move ? playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng, { extraAbs }) : r;
  }
  if (r.error) return null;
  if (extraAbs[target.id]) spendEnemyB(enc, target.id); // 這一下用掉他一次 B 蓄力
  return { r, target };
}

/** 這位玩家自己的資源消耗（只算他的招式真的會花到的資源＋鬥氣＋毒性），0~1 */
function ownDrain(p) {
  const vals = [];
  for (const r of OTHER_RESOURCES) {
    if (resourceMax(p, r) > 0 && (r === '鬥氣' || p.moves.some((m) => (actionCost(p, m)[r] ?? 0) > 0))) vals.push(1 - resourceNow(p, r) / resourceMax(p, r));
  }
  vals.push(Math.min(1, p.toxicity / TOXICITY_MAX));
  return vals.reduce((a, v) => a + v, 0) / vals.length;
}

/**
 * 模擬一場。players = 角色存檔陣列（不會被改動）；specs = [{ kind, count, atkPower, defPower, hp, atkMod?, defMod?, absDef? }]
 * opts.encounter：固定的敵人 { monsters }（給了就不用 specs，每場都是同一組 A/B/C）
 * opts.supply：假設每人備足這種血藥（毒性 15 喝滿）；opts.caps：每位玩家只出幾成力（陣列，1＝全力）；opts.focus：怪物怎麼挑目標（'random' 隨機｜'spread' 平均分散）
 * 回傳 { outcome: 'win' | 'lose' | 'timeout', rounds, damage, monsterHp, hpLeft, hpMax, downs: [每位玩家倒地幾次], potions,
 *        drain: { 靈氣: 0~1, 魔力: …, 毒性: … }（這場結束時，全隊平均用掉了多少比例；沒有這種資源的玩家不算）, drainAvg,
 *        perPlayer: [{ dmg 打出的傷害, kills 打倒幾隻, taken 承受的傷害, actions 出招次數, potions 喝掉的藥水, drain 自己的消耗, hpLeft 剩餘生命比例 }] }
 */
export function simulateBattle(players, specs, { maxRounds = DEFAULT_MAX_ROUNDS, rng = Math.random, encounter = null, supply = null, caps = [], focus = 'random' } = {}) {
  const team = players.map((src, i) => prepPlayer(src, { supply, cap: caps[i] ?? 1 }));
  // encounter：固定一組已經抽好 A/B/C 的敵人（場上的或預組），每場用全滿生命的複本；沒給就照 specs 每場重抽
  const enc = encounter ? fixedEncounter(encounter) : buildEncounter(specs, rng);
  const monsterHp = enc.monsters.reduce((a, m) => a + m.maxHp, 0);
  const downs = team.map(() => 0);
  const wasDown = team.map(() => false);
  const stat = team.map(() => ({ dmg: 0, kills: 0, taken: 0, actions: 0, potions: 0, hit: 0 }));
  let potions = 0;
  let healed = 0; // 敵人喝血回復的總量（算每回合傷害時要加回去）
  let rounds = 0;
  let outcome = 'timeout';
  const alive = () => enc.monsters.filter((m) => !isDowned(m));
  const markDowns = () => team.forEach((p, i) => { const d = isDowned(p); if (d && !wasDown[i]) downs[i]++; wasDown[i] = d; });

  while (rounds < maxRounds) {
    rounds++;
    enc.round = rounds; // 回合數一變，敵人的技能次數與蓄力就自動歸零
    for (const m of alive()) for (let i = 0; i < rankInfo(m).B.uses; i++) useEnemySkill(enc, m.id, 'B', rng); // B 技能：每回合開始就蓄滿
    for (const [i, p] of team.entries()) {
      if (isDowned(p) || !alive().length) continue;
      const used = usePotions(p, team, enc, rng, (m) => pendingEnemyB(enc, m));
      potions += used; stat[i].potions += used;
      if (p.hp < maxHp(p) * 0.4 && resourceNow(p, '靈氣') > 0) convertResource(p, '靈氣', '生命', resourceNow(p, '靈氣')); // 基礎用法：靈氣 1 比 1 換生命
      const done = act(p, enc, rng);
      if (!done) continue;
      stat[i].actions++;
      for (const h of done.r.hits) { stat[i].dmg += h.lost; if (h.lost > 0 && h.target.hp <= 0) stat[i].kills++; }
    }
    markDowns();
    if (!alive().length) { outcome = 'win'; break; }
    for (const m of alive()) {
      if (m.hp < m.maxHp) { const c = useEnemySkill(enc, m.id, 'C', rng); if (c.ok) healed += c.healed; } // C 喝血
      useEnemySkill(enc, m.id, 'A', rng); // A 技能：蓄力，下一次攻擊每一軌 +20
      for (let k = 0; k < rankInfo(m).attacks; k++) { // 普通 1、菁英 2、BOSS 3 次攻擊
        const victims = team.filter((p) => !isDowned(p));
        if (!victims.length) break;
        const spent = spendEnemyAttack(enc, m.id);
        if (spent.error) break;
        const victim = pickVictim(victims, team, stat, focus, rng);
        stat[team.indexOf(victim)].hit++;
        const before = victim.hp;
        monsterAttack(victim, enc, m.id, bestAtkMode(m, victim), rng, { extraAtk: spent.extraAtk });
        stat[team.indexOf(victim)].taken += before - victim.hp;
        markDowns();
      }
    }
    if (team.every(isDowned)) { outcome = 'lose'; break; }
  }
  // 資源消耗：每種資源（只算這位玩家的招式真的會花到的、加上有基礎用法的鬥氣；沒有任何用途的資源不算，不然永遠是 0）＋毒性（占上限 15 的比例），全隊平均；
  // drainAvg = 各項平均（毒性算一項）
  const drain = {};
  for (const r of OTHER_RESOURCES) {
    const owners = team.filter((p) => resourceMax(p, r) > 0 && r === '鬥氣' || p.moves.some((m) => (actionCost(p, m)[r] ?? 0) > 0)); // 鬥氣有基礎用法（加骰），一律算
    if (owners.length) drain[r] = owners.reduce((a, p) => a + (1 - resourceNow(p, r) / resourceMax(p, r)), 0) / owners.length;
  }
  drain.毒性 = team.reduce((a, p) => a + Math.min(1, p.toxicity / TOXICITY_MAX), 0) / (team.length || 1);
  const drainVals = Object.values(drain);
  return {
    outcome, rounds, monsterHp, monsterCount: enc.monsters.length, playerCount: team.length,
    drain, drainAvg: drainVals.reduce((a, v) => a + v, 0) / (drainVals.length || 1),
    damage: monsterHp - enc.monsters.reduce((a, m) => a + m.hp, 0) + healed, healed,
    hpLeft: team.reduce((a, p) => a + p.hp, 0), hpMax: team.reduce((a, p) => a + maxHp(p), 0),
    downs, potions,
    perPlayer: team.map((p, i) => ({ ...stat[i], takenPct: stat[i].taken / maxHp(p), drain: ownDrain(p), hpLeft: p.hp / maxHp(p) })),
  };
}

/** 每位玩家的平均表現：輸出占比、打倒幾隻、承受傷害、資源消耗、倒地機率 */
function perPlayerSummary(results, names) {
  const n = results.length;
  const k = results[0]?.perPlayer?.length ?? 0;
  if (!k) return [];
  const avg = (f) => (n ? results.reduce((a, r) => a + f(r), 0) / n : 0);
  const total = avg((r) => r.perPlayer.reduce((a, x) => a + x.dmg, 0));
  return Array.from({ length: k }, (_, i) => ({
    name: names[i] ?? `玩家${i + 1}`,
    dmg: avg((r) => r.perPlayer[i].dmg), share: total > 0 ? avg((r) => r.perPlayer[i].dmg) / total : 0,
    kills: avg((r) => r.perPlayer[i].kills), taken: avg((r) => r.perPlayer[i].taken), takenPct: avg((r) => r.perPlayer[i].takenPct ?? 0), hit: avg((r) => r.perPlayer[i].hit ?? 0), actions: avg((r) => r.perPlayer[i].actions),
    potions: avg((r) => r.perPlayer[i].potions), drain: avg((r) => r.perPlayer[i].drain), hpLeft: avg((r) => r.perPlayer[i].hpLeft),
    downRate: n ? results.filter((r) => r.downs[i] > 0).length / n : 0,
  }));
}

/** 把很多場的結果整理成圖表要的數字 */
export function summarize(results, names = []) {
  const n = results.length;
  const count = (o) => results.filter((r) => r.outcome === o).length;
  const maxRound = Math.max(1, ...results.map((r) => r.rounds));
  const roundHist = Array.from({ length: maxRound }, (_, i) => ({ round: i + 1, win: 0, lose: 0, timeout: 0 }));
  for (const r of results) roundHist[r.rounds - 1][r.outcome]++;
  const hpHist = Array(10).fill(0); // 勝利時玩家剩餘生命比例：0~10%、10~20%、…、90~100%
  for (const r of results) if (r.outcome === 'win') hpHist[Math.min(9, Math.floor((r.hpLeft / r.hpMax) * 10))]++;
  const avg = (f) => (n ? results.reduce((a, r) => a + f(r), 0) / n : 0);
  return {
    runs: n, win: count('win') / (n || 1), lose: count('lose') / (n || 1), timeout: count('timeout') / (n || 1),
    avgRounds: avg((r) => r.rounds),
    // 只算打贏的場次：輸掉的場次是被團滅才結束，回合短不代表打得快（不分開看，勝率低時回合數會被拉低）
    avgRoundsWin: results.some((r) => r.outcome === 'win') ? results.filter((r) => r.outcome === 'win').reduce((a, r) => a + r.rounds, 0) / count('win') : avg((r) => r.rounds),
    avgMonsters: avg((r) => r.monsterCount ?? 0), playerCount: results[0]?.playerCount ?? 0,
    avgDamagePerRound: avg((r) => r.damage / r.rounds), avgPotions: avg((r) => r.potions),
    avgHpLeft: avg((r) => r.hpLeft / r.hpMax),
    avgMonsterHp: avg((r) => r.monsterHp), avgDrain: avg((r) => r.drainAvg ?? 0),
    drainBy: Object.fromEntries([...new Set(results.flatMap((r) => Object.keys(r.drain ?? {})))].map((k) => [k, avg((r) => r.drain?.[k] ?? 0)])),
    roundHist, hpHist,
    perPlayer: perPlayerSummary(results, names),
    downRate: (names.length ? names : (results[0]?.downs ?? []).map((_, i) => `玩家${i + 1}`)).map((name, i) => ({ name, rate: results.filter((r) => r.downs[i] > 0).length / (n || 1) })),
  };
}

/** 全部跑完（測試與小量用；畫面用分批版本避免卡住）。回傳 summarize 的結果 */
export function runSimulations(players, specs, { runs = 500, names, ...opts } = {}) {
  return summarize(Array.from({ length: runs }, () => simulateBattle(players, specs, opts)), names);
}
