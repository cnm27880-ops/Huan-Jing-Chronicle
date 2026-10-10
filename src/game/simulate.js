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
// 2026/10 平衡更新（見 enemy.js）：
//   敵人（需驗證）：每回合開始就把 B 技能（防禦強化）用滿，玩家每打他一下消耗一次蓄力；輪到他時，血量沒滿就喝血（C），
//   再用 A 技能（攻擊強化），然後打出這一等級每回合的攻擊次數（普通 1、菁英 2、BOSS 3），每一下各隨機挑一位還沒倒地的玩家
//   玩家（需驗證）：出招時花「現有鬥氣的 1/3（進位）」加骰（付不起就不加）；生命低於 40% 時把靈氣換成生命（最多補到滿）；不用能量轉換
// ============================================================
import {
  newEncounter, addMobs, addBosses, playerAttack, monsterAttack, defenseDice, attackDice, isDowned,
  drinkPotion, giveHealPotion, monsterDef, monsterAbs, monsterAtk,
} from './combat.js';
import { POTIONS, TOXICITY_MAX, TRACKS } from './rules.js';
import { maxHp } from './stats.js';
import { actionCost, restoreAllResources, resourceNow, resourceMax, witchRest, OTHER_RESOURCES, convertResource } from './resources.js';
import { passivesOf } from './skills.js';
import { countOf } from './engine.js';
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

/** 輪到 actor 時自動用藥水（不佔行動）：救倒地的隊友 → 自己血少時喝回復 → 沒有加成就喝最大的攻擊／防禦藥水。回傳用掉幾瓶 */
function usePotions(actor, team, rng) {
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
  for (const kind of ['atk', 'def']) {
    if (actor.buffs[kind] > 0) continue;
    const name = Object.keys(POTIONS).filter((n) => POTIONS[n][kind] && countOf(actor, n) > 0 && actor.toxicity + POTIONS[n].toxicity <= TOXICITY_MAX)
      .sort((a, b) => POTIONS[b][kind] - POTIONS[a][kind])[0];
    if (name && !drinkPotion(actor, name, rng).error) used++;
  }
  return used;
}

/** 一場模擬開始前的玩家複本：生命與資源補滿、毒性與藥水加成歸零（跟新的一場戰鬥一樣） */
export function prepPlayer(src) {
  const p = structuredClone(src);
  restoreAllResources(p);
  p.toxicity = 0; p.buffs = { atk: 0, def: 0 }; p.shield = { hp: 0, res: 0 };
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

/**
 * 模擬一場。players = 角色存檔陣列（不會被改動）；specs = [{ kind, count, atkPower, defPower, hp, atkMod?, defMod?, absDef? }]
 * opts.encounter：固定的敵人 { monsters }（給了就不用 specs，每場都是同一組 A/B/C）
 * 回傳 { outcome: 'win' | 'lose' | 'timeout', rounds, damage, monsterHp, hpLeft, hpMax, downs: [每位玩家倒地幾次], potions,
 *        drain: { 靈氣: 0~1, 魔力: …, 毒性: … }（這場結束時，全隊平均用掉了多少比例；沒有這種資源的玩家不算）, drainAvg }
 */
export function simulateBattle(players, specs, { maxRounds = DEFAULT_MAX_ROUNDS, rng = Math.random, encounter = null } = {}) {
  const team = players.map(prepPlayer);
  // encounter：固定一組已經抽好 A/B/C 的敵人（場上的或預組），每場用全滿生命的複本；沒給就照 specs 每場重抽
  const enc = encounter ? fixedEncounter(encounter) : buildEncounter(specs, rng);
  const monsterHp = enc.monsters.reduce((a, m) => a + m.maxHp, 0);
  const downs = team.map(() => 0);
  const wasDown = team.map(() => false);
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
    for (const p of team) {
      if (isDowned(p) || !alive().length) continue;
      potions += usePotions(p, team, rng);
      if (p.hp < maxHp(p) * 0.4 && resourceNow(p, '靈氣') > 0) convertResource(p, '靈氣', '生命', resourceNow(p, '靈氣')); // 基礎用法：靈氣 1 比 1 換生命
      const target = alive()[0];
      let move = pickMove(p);
      if (move && castsAffordable(p, move) < 1) { // 連普攻都付不起（魔女每次行動多花 30 魔力）：魔女放棄行動回復魔力，其他人只能略過
        if (passivesOf(p).witch) witchRest(p);
        continue;
      }
      const extraAbs = { [target.id]: pendingEnemyB(enc, target) };
      const dou = Math.ceil(resourceNow(p, '鬥氣') / 3); // 鬥氣加骰（付不起就退回不加）
      let r = move ? playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng, { dou, extraAbs }) : { error: 'no move' };
      if (r.error && dou && move) r = playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng, { extraAbs });
      if (r.error && move?.id !== 'basic') { // 付不起（例如被魔女額外花費卡住）就退回普攻
        move = p.moves.find((m) => m.id === 'basic');
        r = move ? playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng, { extraAbs }) : r;
      }
      if (!r.error && extraAbs[target.id]) spendEnemyB(enc, target.id); // 這一下用掉他一次 B 蓄力
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
        const victim = victims[Math.floor(rng() * victims.length)];
        monsterAttack(victim, enc, m.id, bestAtkMode(m, victim), rng, { extraAtk: spent.extraAtk });
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
  };
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
    downRate: (names.length ? names : (results[0]?.downs ?? []).map((_, i) => `玩家${i + 1}`)).map((name, i) => ({ name, rate: results.filter((r) => r.downs[i] > 0).length / (n || 1) })),
  };
}

/** 全部跑完（測試與小量用；畫面用分批版本避免卡住）。回傳 summarize 的結果 */
export function runSimulations(players, specs, { runs = 500, names, ...opts } = {}) {
  return summarize(Array.from({ length: runs }, () => simulateBattle(players, specs, opts)), names);
}
