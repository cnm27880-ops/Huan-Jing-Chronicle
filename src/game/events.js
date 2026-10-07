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
