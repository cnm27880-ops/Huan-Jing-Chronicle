// ============================================================
// 骰子基礎：所有隨機都經過這裡，rng 可替換（測試用固定值、伺服器用 crypto）
// ============================================================

/** 擲一顆 sides 面骰（1..sides） */
export const rollDie = (sides, rng = Math.random) => Math.floor(rng() * sides) + 1;

/** 擲 count 顆 sides 面骰，回傳總和（count <= 0 回傳 0） */
export function rollSum(count, sides, rng = Math.random) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += rollDie(sides, rng);
  return sum;
}

/** 擲 count 顆並回傳每一顆（只用在顆數很少的情況） */
export function rollEach(count, sides, rng = Math.random) {
  return Array.from({ length: Math.max(0, count) }, () => rollDie(sides, rng));
}

export const MAX_DICE = 100; // 與機器人 !投骰 相同：單次最多 100 顆
export const MAX_SIDES = 10000;

/**
 * 解析自訂骰式：「1D20」「2d6+3」「1D20-2」（與機器人 !投骰 格式相同）
 * 失敗回傳 { error }
 */
export function parseDiceExpr(text) {
  const clean = String(text).replace(/\s+/g, '').toUpperCase();
  const m = clean.match(/^(\d+)D(\d+)(?:([+-])(\d+))?$/);
  if (!m) return { error: '格式不對，請輸入像 1D20 或 2D6+3 這樣的骰式。' };
  const count = Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
  if (count <= 0 || sides <= 0) return { error: '骰子數量和面數必須大於 0。' };
  if (count > MAX_DICE) return { error: `單次最多只能投 ${MAX_DICE} 顆骰子。` };
  if (sides > MAX_SIDES) return { error: `面數最多 ${MAX_SIDES}。` };
  return { count, sides, mod, text: `${count}D${sides}${mod ? (mod > 0 ? '+' : '') + mod : ''}` };
}

/** 擲自訂骰式，回傳每顆明細與總和 */
export function rollExpr(expr, rng = Math.random) {
  const parsed = typeof expr === 'string' ? parseDiceExpr(expr) : expr;
  if (parsed.error) return parsed;
  const rolls = rollEach(parsed.count, parsed.sides, rng);
  return { ...parsed, rolls, base: rolls.reduce((a, b) => a + b, 0), total: rolls.reduce((a, b) => a + b, 0) + parsed.mod };
}
