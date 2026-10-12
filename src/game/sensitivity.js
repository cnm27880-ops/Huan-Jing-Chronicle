// ============================================================
// 範本調整影響分析（模擬戰，純函式）。
// 為什麼這樣做：「自動配置敵人」想從零搜尋整組敵人，跑很久、數值也很怪（使用者 2026-10-12）。
// 更實用的做法是以 GM 的「範本」（實際跑團用過的 9 小怪＋BOSS）當基準點，由計算機取代 GM 手動試誤：
// 對範本的每一類敵人逐項微調——加／減幾隻、攻擊／防禦／血量 ±10%／±20%／±50%——每次只動一項，
// 用同一批固定種子重跑，告訴 GM 這個調整會讓勝率、回合數、資源消耗、剩餘生命各變多少。
// 玩家數值會越來越高時，範本不動、重新分析一次，就知道這個範本現在打起來怎樣、往哪調最有效。
// 預設數值（TEMPLATE）：小怪與 BOSS 是 GM 2026-10-12 實際跑團的敵人（小怪血 600／攻 360／防 270，BOSS 血 2000／攻 600／防 800；
// 攻擊與防禦是三軌的總和）；菁英是我訂的（需驗證）。
// ============================================================
import { simulateBattle, summarize, seededRng } from './simulate.js';
import { capsFor, FAIR } from './fairness.js';
import { TARGET, roundsOf } from './tuning.js';

export const TEMPLATE = {
  mob: { atkPower: 360, defPower: 270, hp: 600 },
  elite: { atkPower: 470, defPower: 400, hp: 1200 },
  boss: { atkPower: 600, defPower: 800, hp: 2000 },
};

/** 範本的敵人清單（9 小怪＋1 BOSS）；每次回傳新的複本 */
export const templateSpecs = () => [
  { kind: 'mob', count: 9, ...TEMPLATE.mob, absDef: 0, atkMod: '', defMod: '' },
  { kind: 'boss', count: 1, ...TEMPLATE.boss, absDef: 0, atkMod: '', defMod: '' },
];

export const KIND_NAME = { mob: '小怪', elite: '菁英', boss: 'BOSS' };
const STAT_NAME = { atkPower: '攻擊', defPower: '防禦', hp: '血量' };

/**
 * 評分用的模擬（固定種子，每次都是同一批：同樣的敵人永遠算出同樣的結果，兩組數值之間的差距才是調整造成的、不是運氣）。
 * 回傳 (specs, full = false) => summarize 的結果（附 rank、focus）；full 時再跑「第一名只出部分力」與（集火時）「第一名開場倒地」的情境。
 */
export function makeEvaluator({ players, names = [], rank, supply = null, focus = 'spread', runs = 100 }) {
  const once = (specs, caps, n, downed = []) => summarize(Array.from({ length: n }, (_, i) => simulateBattle(
    players, specs.map((s) => ({ ...s })), { rng: seededRng(i + 1), supply, focus, focusOrder: rank.order, caps, downed })), names);
  return (specs, full = false) => {
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

/** 範本每一組敵人的名字：同一種等級有好幾組時加編號（小怪、小怪 2） */
function groupNames(specs) {
  const seen = {};
  return specs.map((s) => {
    const kind = s.kind ?? 'mob';
    seen[kind] = (seen[kind] ?? 0) + 1;
    const same = specs.filter((x) => (x.kind ?? 'mob') === kind).length;
    return same > 1 ? `${KIND_NAME[kind]} ${seen[kind]}` : KIND_NAME[kind];
  });
}

export const COUNT_STEPS = [-2, -1, 1, 2]; // 加減幾隻
export const STAT_STEPS = [-0.5, -0.2, -0.1, 0.1, 0.2, 0.5]; // 攻擊／防禦／血量調整的比例（±50% 是大幅度，玩家太強／太弱時小幅調整看不出差別，要靠它找方向）

/**
 * 範本的所有「單項微調」：每一項只動一個地方。
 * 回傳 [{ group（敵人組名）, kind, label（給人看的標題）, specs（調整後的敵人清單，不改原本的）, change: { type, ... } }]
 * BOSS 固定 1 隻，不調隻數；調整後場上沒有任何怪物的項目會略過。
 */
export function variations(specs) {
  const names = groupNames(specs);
  const out = [];
  specs.forEach((s, i) => {
    if (!(s.count > 0)) return;
    const kind = s.kind ?? 'mob';
    const put = (patch) => specs.map((x, j) => (j === i ? { ...x, ...patch } : { ...x }));
    if (kind !== 'boss') {
      for (const d of COUNT_STEPS) {
        const n = s.count + d;
        if (n < 0 || n > 20) continue;
        const next = put({ count: n });
        if (!next.some((x) => x.count > 0)) continue;
        out.push({ group: names[i], kind, label: `${d > 0 ? '＋' : '－'}${Math.abs(d)} 隻（${s.count} → ${n} 隻）`, specs: next, change: { type: 'count', delta: d } });
      }
    }
    for (const stat of ['atkPower', 'defPower', 'hp']) {
      for (const pct of STAT_STEPS) {
        const v = Math.max(stat === 'defPower' ? 0 : 1, Math.round(s[stat] * (1 + pct)));
        if (v === s[stat]) continue;
        out.push({
          group: names[i], kind, label: `${STAT_NAME[stat]} ${s[stat]} → ${v}（${pct > 0 ? '＋' : '－'}${Math.round(Math.abs(pct) * 100)}%，${v - s[stat] > 0 ? '＋' : '－'}${Math.abs(v - s[stat])} 點）`,
          specs: put({ [stat]: v }), change: { type: stat, pct },
        });
      }
    }
  });
  return out;
}

/** 這組結果達不達標：回合落在目標範圍、勝率夠高、資源消耗落在合理範圍（只看這三項，最基本的） */
export function meetsTarget(sum, t = TARGET) {
  const r = roundsOf(sum);
  return r >= t.roundsMin && r <= t.roundsMax && sum.win >= t.winMin && Math.abs(sum.avgDrain - t.drain) <= t.drainTol;
}

/**
 * 分析：先算範本本身（base），再逐項算每個微調，回傳每項相對範本的變化。
 *   evaluate：makeEvaluator 的結果；onProgress(0~1)；yieldFn 讓畫面喘口氣
 * 回傳 { base, rows: [{ ...variation, summary, d: { win, rounds, drain, hpLeft, potions }, meets, noticeable }], se, runs }
 *   d.*：相對範本的差（正＝變大）；noticeable＝差距大到不像只是運氣（勝率差超過 1.5 倍標準誤，或回合差 ≥ 0.3、資源消耗差 ≥ 3%）
 */
export async function analyzeSensitivity({ specs, evaluate, onProgress = () => {}, yieldFn = () => new Promise((res) => setTimeout(res, 0)) }) {
  const list = variations(specs);
  const base = evaluate(specs, false);
  const se = Math.sqrt(Math.max(base.win * (1 - base.win), 0.01) / Math.max(1, base.runs));
  const rows = [];
  for (const [i, v] of list.entries()) {
    await yieldFn();
    onProgress((i + 1) / (list.length + 1));
    const summary = evaluate(v.specs, false);
    const d = {
      win: summary.win - base.win, rounds: roundsOf(summary) - roundsOf(base), drain: summary.avgDrain - base.avgDrain,
      hpLeft: summary.avgHpLeft - base.avgHpLeft, potions: summary.avgPotions - base.avgPotions,
    };
    rows.push({ ...v, summary, d, meets: meetsTarget(summary), noticeable: Math.abs(d.win) > 1.5 * se || Math.abs(d.rounds) >= 0.3 || Math.abs(d.drain) >= 0.03 });
  }
  onProgress(1);
  return { base, rows, se, runs: base.runs, baseMeets: meetsTarget(base) };
}

/** 影響力排行：勝率變化最大的幾項（只看看得出差別的），回傳 rows 的子集（依 |勝率變化| 由大到小） */
export const topImpact = (rows, n = 5) => rows.filter((r) => r.noticeable && Math.abs(r.d.win) > 0).sort((a, b) => Math.abs(b.d.win) - Math.abs(a.d.win)).slice(0, n);
