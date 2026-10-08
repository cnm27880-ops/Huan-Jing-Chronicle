// ============================================================
// 異動紀錄（純函式）：GM 替玩家寫入角色時，比對「寫入前」與「寫入後」，列出誰看得懂的變更。
// 只比對會影響玩法的欄位（名稱、金幣、經驗、手動調整、技能等級、啟動、生活技能、背包）；
// 其他欄位（生命、資源、招式……）不記，免得玩家自己存檔造成的小變動淹沒紀錄。
// ============================================================

export const MAX_AUDIT_LINES = 12;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** 兩個「名稱 → 數字」物件的差異行：prefix 技能 X a → b */
function diffMap(prefix, before, after, out, fmt = (v) => String(v)) {
  const a = obj(before); const b = obj(after);
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    const x = num(a[k]); const y = num(b[k]);
    if (x !== y) out.push(`${prefix}${k}　${fmt(x)} → ${fmt(y)}`);
  }
}

const onOff = (v) => (v ? '開' : '關');
const flags = (o) => Object.fromEntries(Object.entries(obj(o)).map(([k, v]) => [k, v ? 1 : 0]));

/**
 * 回傳 { lines, total }：lines 最多 MAX_AUDIT_LINES 行，total 是實際變更項數（多出來的在最後一行說明）。
 * before 是 null = 這位玩家原本沒有存檔（新建）。
 */
export function describeCharChange(before, after) {
  const lines = [];
  if (!before) lines.push(`新建角色「${String(after?.name ?? '')}」`);
  const b = obj(before); const a = obj(after);
  if (before && b.name !== a.name) lines.push(`名稱　${String(b.name ?? '')} → ${String(a.name ?? '')}`);
  if (num(b.gold) !== num(a.gold)) lines.push(`金幣　${num(b.gold)} → ${num(a.gold)}`);
  if (num(b.exp) !== num(a.exp)) lines.push(`經驗　${num(b.exp)} → ${num(a.exp)}`);
  diffMap('手動調整 ', b.adjust, a.adjust, lines);
  diffMap('技能 ', b.skills, a.skills, lines);
  diffMap('啟動 ', flags(b.skillOn), flags(a.skillOn), lines, onOff);
  diffMap('生活技能 ', b.lifeSkills, a.lifeSkills, lines);
  diffMap('背包 ', b.inventory, a.inventory, lines);
  const total = lines.length;
  if (!total) return { lines: ['沒有數值變更'], total: 0 };
  if (total <= MAX_AUDIT_LINES) return { lines, total };
  return { lines: [...lines.slice(0, MAX_AUDIT_LINES), `…另外還有 ${total - MAX_AUDIT_LINES} 項變更`], total };
}
