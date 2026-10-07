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
