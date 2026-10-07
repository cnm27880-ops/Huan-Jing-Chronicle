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
// ============================================================
import {
  newEncounter, addMobs, addBosses, playerAttack, monsterAttack, defenseDice, attackDice, isDowned,
  drinkPotion, giveHealPotion, monsterDef, monsterAbs, monsterAtk,
} from './combat.js';
import { POTIONS, TOXICITY_MAX, TRACKS } from './rules.js';
import { maxHp } from './stats.js';
import { actionCost, restoreAllResources, resourceNow, witchRest } from './resources.js';
import { passivesOf } from './skills.js';
import { countOf } from './engine.js';

export const DEFAULT_MAX_ROUNDS = 60;
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
  for (const { kind, ...spec } of specs) (kind === 'boss' ? addBosses : addMobs)(enc, spec, rng);
  return enc;
}

/**
 * 模擬一場。players = 角色存檔陣列（不會被改動）；specs = [{ kind, count, atkPower, defPower, hp, atkMod?, defMod?, absDef? }]
 * 回傳 { outcome: 'win' | 'lose' | 'timeout', rounds, damage, monsterHp, hpLeft, hpMax, downs: [每位玩家倒地幾次], potions }
 */
export function simulateBattle(players, specs, { maxRounds = DEFAULT_MAX_ROUNDS, rng = Math.random } = {}) {
  const team = players.map(prepPlayer);
  const enc = buildEncounter(specs, rng);
  const monsterHp = enc.monsters.reduce((a, m) => a + m.maxHp, 0);
  const downs = team.map(() => 0);
  const wasDown = team.map(() => false);
  let potions = 0;
  let rounds = 0;
  let outcome = 'timeout';
  const alive = () => enc.monsters.filter((m) => !isDowned(m));
  const markDowns = () => team.forEach((p, i) => { const d = isDowned(p); if (d && !wasDown[i]) downs[i]++; wasDown[i] = d; });

  while (rounds < maxRounds) {
    rounds++;
    for (const p of team) {
      if (isDowned(p) || !alive().length) continue;
      potions += usePotions(p, team, rng);
      const target = alive()[0];
      let move = pickMove(p);
      if (move && castsAffordable(p, move) < 1) { // 連普攻都付不起（魔女每次行動多花 30 魔力）：魔女放棄行動回復魔力，其他人只能略過
        if (passivesOf(p).witch) witchRest(p);
        continue;
      }
      let r = move ? playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng) : { error: 'no move' };
      if (r.error && move?.id !== 'basic') { // 付不起（例如被魔女額外花費卡住）就退回普攻
        move = p.moves.find((m) => m.id === 'basic');
        r = move ? playerAttack(p, enc, move.id, target.id, bestDefMode(target, move), rng) : r;
      }
    }
    markDowns();
    if (!alive().length) { outcome = 'win'; break; }
    for (const m of alive()) {
      const victims = team.filter((p) => !isDowned(p));
      if (!victims.length) break;
      const victim = victims[Math.floor(rng() * victims.length)];
      monsterAttack(victim, enc, m.id, bestAtkMode(m, victim), rng);
      markDowns();
    }
    if (team.every(isDowned)) { outcome = 'lose'; break; }
  }
  return {
    outcome, rounds, monsterHp,
    damage: monsterHp - enc.monsters.reduce((a, m) => a + m.hp, 0),
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
    avgRounds: avg((r) => r.rounds), avgDamagePerRound: avg((r) => r.damage / r.rounds), avgPotions: avg((r) => r.potions),
    avgHpLeft: avg((r) => r.hpLeft / r.hpMax),
    roundHist, hpHist,
    downRate: (names.length ? names : (results[0]?.downs ?? []).map((_, i) => `玩家${i + 1}`)).map((name, i) => ({ name, rate: results.filter((r) => r.downs[i] > 0).length / (n || 1) })),
  };
}

/** 全部跑完（測試與小量用；畫面用分批版本避免卡住）。回傳 summarize 的結果 */
export function runSimulations(players, specs, { runs = 500, names, ...opts } = {}) {
  return summarize(Array.from({ length: runs }, () => simulateBattle(players, specs, opts)), names);
}
