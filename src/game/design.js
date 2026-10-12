// ============================================================
// 敵人配置設計（模擬戰「自動配置」，純函式）。
// 為什麼要有這個：以前自動調整只縮放「血量」和「攻擊」，防禦與怪物數量固定。玩家強弱差距大的時候，
// 為了讓最弱的人打得動，所有怪都得很脆，最強的人就一次秒殺全場；而且傷害是「攻擊 − 防禦」的減法，
// 防禦對弱者最不留情，單調整血量與攻擊永遠調不平。（使用者 2026-10-12）
//
// 這裡改成「搜尋整個敵人配置」（BOSS 固定 1 隻，或沒有 BOSS）：
//   · 小怪、菁英的隻數
//   · 小怪／菁英／BOSS 各自的防禦——由玩家的傷害曲線決定能不能打穿：小怪要給最弱的人打得動，菁英給中段，BOSS 讓大多數人還打得動
//   · 小怪／菁英血量＝（對應玩家一次出手的傷害）× 倍數；BOSS 血量用來把回合數對準 2～3 回合
//   · 怪物攻擊：在「還贏得了、資源沒爆」的前提下盡量兇（傷害是門檻函式，所以用二分搜尋，不盲調）
// 每組候選都用固定種子的模擬評分（同樣的配置永遠算出同樣的結果）。
// 預設數值（TEMPLATE）：小怪與 BOSS 是 GM 2026-10-12 實際跑團的敵人（小怪血 600／攻 360／防 270，BOSS 血 2000／攻 600／防 800）；
// 菁英是我訂的（需驗證）。其餘門檻（輸出占比、倍數範圍）也是我訂的，需向 GM 確認。
// ============================================================
import { simulateBattle, summarize, seededRng } from './simulate.js';
import { measureHits, rankPlayers, capsFor, FAIR } from './fairness.js';
import { TARGET, penalty, assess, roundsOf, downMaxOf } from './tuning.js';

export const TEMPLATE = {
  mob: { atkPower: 360, defPower: 270, hp: 600 },
  elite: { atkPower: 470, defPower: 400, hp: 1200 },
  boss: { atkPower: 600, defPower: 800, hp: 2000 },
};

/** 防禦強度的候選值（總和；會隨機分到三軌）。傷害曲線就是在這些點上量的 */
export const DEF_GRID = [0, 40, 80, 120, 160, 200, 250, 300, 360, 430, 520, 620, 750, 900, 1100];
const MOB_HP_MULT = [0.6, 1, 1.5, 2.2]; // 小怪血量＝最弱玩家一次出手 × 這個倍數
const ELITE_HP_MULT = [1.2, 2, 3, 4]; // 菁英血量＝中位數玩家一次出手 × 這個倍數
const KA = [0.05, 8]; // 攻擊倍率範圍（相對 TEMPLATE 的攻擊強度）
const mid = (lo, hi) => Math.sqrt(lo * hi);

const mobProbe = (d) => [{ kind: 'mob', count: 3, atkPower: 1, defPower: d, hp: 1 }];
const stats = (hits) => {
  const v = hits.map((h) => h.perTarget).sort((a, b) => a - b);
  return { weak: v[0] ?? 0, med: v[Math.floor(v.length / 2)] ?? 0, strong: v[v.length - 1] ?? 0 };
};

/** 傷害曲線：每個防禦候選值下，每位玩家一次出手（對單一目標）打得掉多少；回傳 [{ def, hits, weak, med, strong }] */
export function damageCurve(players, { supply = null, runs = 8, grid = DEF_GRID } = {}) {
  return grid.map((def) => {
    const hits = measureHits(players, mobProbe(def), { supply, runs });
    return { def, hits, ...stats(hits) };
  });
}

/** 每位玩家的強弱排序（用傷害曲線上防禦 100 附近的點；越強越前面）。回傳 rankPlayers 的結果 */
export function rankFromCurve(curve) {
  const at = curve.reduce((a, c) => (Math.abs(c.def - 100) < Math.abs(a.def - 100) ? c : a), curve[0]);
  return rankPlayers(at.hits);
}

/**
 * 評分用的模擬（固定種子）：跑 runs 場；full 時再跑「第一名只出部分力」與（集火時）「第一名開場倒地」的情境。
 * 回傳 (specs, full) => summarize 的結果（附 rank、focus、capWin、outWin），和 simPanel 原本的評估函式一樣。
 */
export function makeEvaluator({ players, names = [], rank, supply = null, focus = 'spread', runs = 40 }) {
  const once = (specs, caps, n, downed = []) => summarize(Array.from({ length: n }, (_, i) => simulateBattle(
    players, specs.map((s) => ({ ...s })), { rng: seededRng(i + 1), supply, focus, focusOrder: rank.order, caps, downed })), names);
  return (specs, full = true) => {
    const sum = once(specs, [], runs);
    sum.rank = rank;
    sum.focus = focus;
    if (full && players.length > 1) {
      sum.capWin = once(specs, capsFor(players.length, rank.strongest), Math.max(20, Math.round(runs * 0.6))).win;
      sum.capBudget = FAIR.topBudget;
      if (focus === 'strongest') sum.outWin = once(specs, [], Math.max(20, Math.round(runs * 0.6)), [rank.strongest]).win;
    }
    return sum;
  };
}

/** 一個候選配置 c 變成模擬用的敵人清單。kh＝血量旋鈕（有 BOSS：BOSS 血量；沒有：小怪與菁英血量的整體倍率），ka＝攻擊倍率 */
export function buildSpecs(c, kh, ka) {
  const mobHp = Math.max(1, Math.round(c.mobHp * (c.boss ? 1 : kh)));
  const eliteHp = Math.max(1, Math.round(c.eliteHp * (c.boss ? 1 : kh)));
  const atk = (kind) => Math.max(1, Math.round(TEMPLATE[kind].atkPower * ka));
  const base = { absDef: 0, atkMod: '', defMod: '' };
  const specs = [];
  if (c.nMob > 0) specs.push({ kind: 'mob', count: c.nMob, atkPower: atk('mob'), defPower: c.defMob, hp: mobHp, ...base });
  if (c.nElite > 0) specs.push({ kind: 'elite', count: c.nElite, atkPower: atk('elite'), defPower: c.defElite, hp: eliteHp, ...base });
  if (c.boss) specs.push({ kind: 'boss', count: 1, atkPower: atk('boss'), defPower: c.defBoss, hp: Math.max(Math.round(c.bossBase * kh), c.nMob > 0 ? mobHp * 2 : 1), ...base });
  return specs;
}

/** 讓怪物還能被某個人打穿的防禦候選值（對應不同強度的玩家） */
function allowedDefs(curve, key) {
  const zero = curve[0][key] || 1;
  const keep = curve.filter((c) => c[key] > 0.2 * zero);
  return (keep.length ? keep : curve.slice(0, 2)).map((c) => c.def);
}

/** 隨機（固定種子）取一個候選配置的結構：隻數、各級防禦、小怪／菁英血量倍數 */
function sampleStructure(rng, curve, { boss, players }) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const byDef = (d) => curve.find((c) => c.def === d);
  const maxMob = Math.max(2, Math.min(12, players * 3));
  const maxElite = Math.min(5, Math.max(1, Math.ceil(players)));
  let nMob = Math.floor(rng() * (maxMob + 1));
  const nElite = Math.floor(rng() * (maxElite + 1));
  if (!boss && nMob + nElite < 2) nMob = 2;
  const defMob = pick(allowedDefs(curve, 'weak'));
  const defElite = pick(allowedDefs(curve, 'med').filter((d) => d >= defMob).concat([defMob]));
  const defBoss = pick(allowedDefs(curve, 'med').filter((d) => d >= defElite).concat([defElite]));
  const mm = pick(MOB_HP_MULT);
  const me = pick(ELITE_HP_MULT);
  return {
    nMob, nElite, boss, defMob, defElite, defBoss, mm, me,
    mobHp: Math.max(1, Math.round(byDef(defMob).weak * mm)),
    eliteHp: Math.max(1, Math.round(byDef(defElite).med * me)),
    bossBase: 1000, // BOSS 血量 = bossBase × kh，kh 由二分搜尋決定
  };
}

/** 這組結果「太兇」嗎（攻擊要往下調）：勝率不夠、有人倒太多、消耗爆表 */
const tooHard = (sum, t) => sum.win < t.winMin || downMaxOf(sum) > t.downMax || sum.avgDrain > t.drain + t.drainTol;

/**
 * 找一組結構的血量與攻擊（二分搜尋）：
 *   1. 血量旋鈕 kh：讓「打贏的場次」平均回合落在目標正中間
 *   2. 攻擊倍率 ka：在還贏得了的前提下盡量兇（太兇就降、消耗不夠就升）
 *   3. 攻擊變了回合數也會變（玩家倒地、喝藥），所以在 ka 附近再校準一次血量
 */
async function fitStructure(c, evaluate, target, tick) {
  const roundsMid = (target.roundsMin + target.roundsMax) / 2;
  const khRange = c.boss ? [0.2, 60] : [0.2, 6];
  const run = async (kh, ka) => { await tick(); return evaluate(buildSpecs(c, kh, ka), false); };
  const fitKh = async (ka, lo, hi, n) => {
    let kh = mid(lo, hi);
    for (let i = 0; i < n; i++) {
      kh = mid(lo, hi);
      const sum = await run(kh, ka);
      if (roundsOf(sum) > roundsMid) hi = kh; else lo = kh;
    }
    return kh;
  };
  let ka = 1;
  let kh = await fitKh(ka, khRange[0], khRange[1], 6);
  let lo = KA[0]; let hi = KA[1];
  let best = null;
  for (let i = 0; i < 7; i++) {
    const k = mid(lo, hi);
    const sum = await run(kh, k);
    const pen = penalty(sum, target);
    if (!best || pen <= best.pen + 1e-9) best = { ka: k, pen }; // 同分選比較兇的（越後面試的攻擊越高，除非太兇分數會變差）
    // 太兇就降；沒有太兇但消耗還沒到目標中心就升（盡量兇，不是剛過下限就停）；到了中心附近就收工
    if (tooHard(sum, target)) hi = k; else if (sum.avgDrain < target.drain - 0.03) lo = k; else break;
  }
  ka = best.ka;
  kh = await fitKh(ka, Math.max(khRange[0], kh / 2), Math.min(khRange[1], kh * 2), 4);
  const sum = await run(kh, ka);
  return { kh, ka, sum, pen: penalty(sum, target) };
}

/** 結構的簡短文字（同樣隻數與防禦的候選只留一個時用） */
const keyOf = (c) => `${c.nMob}-${c.nElite}-${c.defMob}-${c.defElite}-${c.defBoss}`;

/**
 * 自動配置敵人。
 *   players／names：玩家角色（已略過沒填資料的）；boss：有沒有 1 隻 BOSS
 *   evaluate：makeEvaluator 的結果（固定種子，搜尋用，場數少）；evaluateFinal：前幾名最後重算用（場數多，沒給就用 evaluate）；target：目標（預設 TARGET，2～3 回合）
 *   candidates：隨機結構要試幾組（越多越準越慢）；top：回傳前幾名
 * 回傳 { results: [{ specs, summary, penalty, issues, structure }], notes, curve }；results 依分數由好到壞，沒有可行的配置時是空陣列。
 */
export async function designEncounter({
  players, names = [], boss = true, evaluate, evaluateFinal = evaluate, supply = null, target = TARGET, candidates = 36, top = 3,
  curve = null, onProgress = () => {}, yieldFn = () => new Promise((res) => setTimeout(res, 0)),
}) {
  const notes = [];
  const cv = curve ?? damageCurve(players, { supply });
  if (cv[0].strong <= 0) return { results: [], notes: ['所有玩家對防禦 0 的敵人都打不出傷害：角色資料可能還沒填。'], curve: cv };
  const rng = seededRng(2026);
  const per = 3 * 7 + 6; // 每組候選大約要評估幾次（只用來估進度）
  let done = 0;
  const total = candidates * per + top * 3;
  const tick = async () => { await yieldFn(); onProgress(Math.min(0.99, ++done / total)); };

  // 1. 結構（隻數與防禦）：隨機取樣，每組各自找血量與攻擊，用「不跑公平性情境」的快速評估評分
  const seen = new Set();
  const scored = [];
  for (let i = 0; i < candidates * 3 && scored.length < candidates; i++) {
    const c = sampleStructure(rng, cv, { boss, players: players.length });
    if (!c.boss && !c.nMob && !c.nElite) continue;
    const k = keyOf(c) + `-${c.mm}-${c.me}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const fit = await fitStructure(c, evaluate, target, tick);
    scored.push({ c, ...fit });
  }
  scored.sort((a, b) => a.pen - b.pen);
  if (!scored.length) return { results: [], notes: ['沒有可行的配置。'], curve: cv };

  // 2. 前幾名用完整評估（含「第一名只出六成力」「第一名開場倒地」）重新評分，再取前 top 名
  const finals = [];
  for (const s of scored.slice(0, Math.max(top * 2, 4))) {
    await tick();
    const specs = buildSpecs(s.c, s.kh, s.ka);
    const summary = evaluateFinal(specs, true); // 最後排名用場數比較多的評估
    finals.push({ specs, summary, penalty: penalty(summary, target), structure: s.c, kh: s.kh, ka: s.ka });
  }
  finals.sort((a, b) => a.penalty - b.penalty);
  const results = [];
  for (const f of finals) {
    if (results.length >= top) break;
    if (results.some((r) => r.structure.nMob === f.structure.nMob && r.structure.nElite === f.structure.nElite)) continue; // 隻數一樣的只留一個，讓三個方案有差別
    results.push({ ...f, issues: assess(f.summary).items.filter((i) => i.status !== 'ok') });
  }
  if (results[0].penalty > 0) notes.push('找不到完全符合所有目標的配置，下面是最接近的；沒達標的項目列在各方案底下。');
  const sp = stats(cv[0].hits);
  if (sp.weak > 0 && sp.strong / sp.weak > 4) notes.push(`玩家強弱差距很大（防禦 0 時，最強一次出手 ${Math.round(sp.strong)}、最弱 ${Math.round(sp.weak)}，差 ${(sp.strong / sp.weak).toFixed(1)} 倍）：配置會用「小怪給弱的人、BOSS 給強的人」去拉平，但差距這麼大時，最弱的玩家可能還是只能打小怪。`);
  onProgress(1);
  return { results, notes, curve: cv };
}
