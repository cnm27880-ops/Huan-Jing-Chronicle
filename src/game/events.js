// ============================================================
// 把遊戲結果變成「擲骰事件」（格式見 src/state/rollLog.js）。純函式，伺服器也能用。
// ============================================================
const partsText = (parts) => parts.map((p) => `${p.label} ${p.value >= 0 ? '+' : ''}${p.value}`).join('　');

/** 跑團技能檢定：sessionCheck() 的結果 → 事件 */
export function checkEvent(who, r) {
  return {
    who, kind: 'check', label: `${r.skill}檢定`, big: r.total,
    lines: [`1D20（${r.roll}）+ ${r.mod}`, partsText(r.parts) || '無加值', r.isLife ? '生活技能：已加跑團熟練' : '非生活技能：不加熟練'],
  };
}

/** 自訂骰：rollExpr() 的結果 → 事件（骰盤的自訂骰；伺服器擲骰也用同一份格式） */
export function diceEvent(who, r) {
  return {
    who, kind: 'dice', label: r.text, big: r.total,
    lines: [
      r.count > 1 ? `明細 ${r.rolls.join(' + ')}${r.mod ? ` ${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)}` : ''}` : r.mod ? `骰面 ${r.base} ${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)}` : null,
    ].filter(Boolean),
  };
}

// ---------- 戰鬥逐軌結果（出招／承受攻擊）----------
// 事件只能帶文字（伺服器只收 who/kind/label/big/tone/lines），所以每條軌道寫成一行固定格式，
// 畫面再用 parseTrackLine 讀回來畫成「三軌摘要」。格式改了兩邊要一起改，舊紀錄也要讀得懂。
const num = (n) => Number(n).toLocaleString('zh-TW');
const int = (s) => Number(String(s).replace(/,/g, ''));

/** clash()／clashPool() 的一條軌道 → 「A 軌　攻 12 顆＝30　防 8 顆＝20　傷害 10」 */
export const trackLine = (t) =>
  `${t.track} 軌　攻 ${num(t.atkDice)} 顆＝${num(t.atkRoll)}　防 ${num(t.defDice)} 顆＝${num(t.defRoll)}　傷害 ${num(t.damage)}`;

/** trackLine 的反向；不是軌道行就回傳 null */
export function parseTrackLine(line) {
  const m = String(line).match(/^(\S+) 軌　攻 ([\d,]+) 顆＝([\d,]+)　防 ([\d,]+) 顆＝([\d,]+)　傷害 ([\d,]+)$/);
  if (!m) return null;
  return { track: m[1], atkDice: int(m[2]), atkRoll: int(m[3]), defDice: int(m[4]), defRoll: int(m[5]), damage: int(m[6]) };
}

/** 多目標出招時，每個目標前面的標題行：「— 小怪1（傷害 12）—」 */
export const targetLine = (id, total) => `— ${id}（傷害 ${num(total)}）—`;
export function parseTargetLine(line) {
  const m = String(line).match(/^— (.+)（傷害 ([\d,]+)）—$/);
  return m ? { id: m[1], total: int(m[2]) } : null;
}
