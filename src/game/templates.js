// ============================================================
// 範本版本的比較（純函式，模擬戰用）。
// 範本＝一份敵人清單；GM 迭代調整後存成版本（v1、v2…，存在伺服器，見 worker/src/templates.js），這裡負責：
//   · 版本命名與簡短描述
//   · 兩個版本的「數值差異」（拿掉／新增哪一組、隻數、攻擊、防禦、血量怎麼變）
//   · 兩個版本的「結果差異」：用「現在的玩家」把兩個版本同時重跑一次（同一批固定種子），不拿存檔當時的成績比
//     ——玩家數值會越來越高，不同時間的成績不是同一把尺，比出來會誤導（存檔當時的成績只當歷史參考，標註日期）
// ============================================================
import { roundsOf, downMaxOf } from './tuning.js';

export const KIND_LABEL = { mob: '小怪', elite: '菁英', boss: 'BOSS' };
const kindOf = (s) => s.kind ?? 'mob';
const STATS = [['atkPower', '攻擊'], ['defPower', '防禦'], ['hp', '血量'], ['absDef', '絕對防禦']];

/** 簡短描述：小怪 ×9・BOSS ×1 */
export const describeSpecs = (specs) => (specs ?? []).map((s) => `${KIND_LABEL[kindOf(s)]} ×${s.count}`).join('・');

/** 下一個版本的預設名稱：範本 v{最大的版本號 + 1}（名稱裡找不到 v 數字就用清單長度 + 1） */
export function nextVersionName(list) {
  const nums = (list ?? []).map((x) => Number(/v(\d+)/i.exec(x.name ?? '')?.[1])).filter(Number.isFinite);
  return `範本 v${nums.length ? Math.max(...nums) + 1 : (list?.length ?? 0) + 1}`;
}

const signed = (v) => `${v > 0 ? '＋' : '－'}${Math.abs(v)}`;

/**
 * 兩份敵人清單的數值差異（文字陣列）。同一種等級的組按順序配對（第 1 組小怪對第 1 組小怪…），
 * 多出來的算「新增」、少掉的算「拿掉」；完全一樣回傳 []。
 */
export function diffSpecs(a, b) {
  const out = [];
  const kinds = [...new Set([...(a ?? []).map(kindOf), ...(b ?? []).map(kindOf)])];
  for (const kind of kinds) {
    const ga = (a ?? []).filter((s) => kindOf(s) === kind);
    const gb = (b ?? []).filter((s) => kindOf(s) === kind);
    const name = (i, n) => (n > 1 ? `${KIND_LABEL[kind]} ${i + 1}` : KIND_LABEL[kind]);
    for (let i = 0; i < Math.max(ga.length, gb.length); i++) {
      const x = ga[i]; const y = gb[i];
      const label = name(i, Math.max(ga.length, gb.length));
      if (x && !y) { out.push(`拿掉 ${label} ×${x.count}（攻 ${x.atkPower}・防 ${x.defPower}・血 ${x.hp}）`); continue; }
      if (!x && y) { out.push(`新增 ${label} ×${y.count}（攻 ${y.atkPower}・防 ${y.defPower}・血 ${y.hp}）`); continue; }
      if (x.count !== y.count) out.push(`${label} 隻數 ${x.count} → ${y.count}（${signed(y.count - x.count)}）`);
      for (const [k, n] of STATS) {
        const va = x[k] ?? 0; const vb = y[k] ?? 0;
        if (va !== vb) out.push(`${label} ${n} ${va} → ${vb}（${signed(vb - va)}${va ? `，${signed(Math.round(((vb - va) / va) * 100))}%` : ''}）`);
      }
    }
  }
  return out;
}

/** 這一次模擬的指標（比較用）：[{ key, label, type: 'pct' | 'num' | 'int', value }] */
export function metricsOf(sum) {
  const m = [
    { key: 'win', label: '勝率', type: 'pct', value: sum.win },
    { key: 'rounds', label: '平均回合（打贏的場次）', type: 'num', value: roundsOf(sum) },
    { key: 'drain', label: '資源消耗', type: 'pct', value: sum.avgDrain },
    { key: 'hpLeft', label: '剩餘生命', type: 'pct', value: sum.avgHpLeft },
    { key: 'potions', label: '用掉藥水（瓶）', type: 'num', value: sum.avgPotions },
    { key: 'dmg', label: '全隊每回合傷害', type: 'int', value: sum.avgDamagePerRound },
    { key: 'downMax', label: '最容易倒地的人，倒地機率', type: 'pct', value: downMaxOf(sum) },
  ];
  for (const k of ['mob', 'elite', 'boss']) if (sum.hitPct?.[k] != null) m.push({ key: `hit_${k}`, label: `${KIND_LABEL[k]}一下打掉玩家生命`, type: 'pct', value: sum.hitPct[k] });
  return m;
}

/**
 * 比較兩個版本：evaluate 是 makeEvaluator 的結果（固定種子，所以兩邊用同一批骰點、差距是版本造成的不是運氣）。
 * 回傳 { diff（數值差異文字）, rows: [{ key, label, type, a, b, d }], a, b（兩邊的 summarize 結果）, se（勝率誤差，約）}
 * 只有一邊有的指標（例如只有 A 有菁英）b 當 null，不算差。
 */
export function compareVersions({ a, b, evaluate }) {
  const sa = evaluate(a, false);
  const sb = evaluate(b, false);
  const ma = new Map(metricsOf(sa).map((m) => [m.key, m]));
  const mb = new Map(metricsOf(sb).map((m) => [m.key, m]));
  const rows = [...new Set([...ma.keys(), ...mb.keys()])].map((key) => {
    const x = ma.get(key); const y = mb.get(key);
    return { key, label: (x ?? y).label, type: (x ?? y).type, a: x?.value ?? null, b: y?.value ?? null, d: x && y ? y.value - x.value : null };
  });
  const se = Math.sqrt(Math.max(sa.win * (1 - sa.win), 0.01) / Math.max(1, sa.runs));
  return { diff: diffSpecs(a, b), rows, a: sa, b: sb, se, runs: sa.runs };
}

/** 存版本時順便記的「當時成績」（只是歷史參考）：{ at, runs, win, rounds, drain, hpLeft, players } */
export const snapshotOf = (sum, names, at = Date.now()) => ({
  at, runs: sum.runs, win: sum.win, rounds: roundsOf(sum), drain: sum.avgDrain, hpLeft: sum.avgHpLeft, players: names,
});
