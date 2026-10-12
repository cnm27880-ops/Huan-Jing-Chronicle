// ============================================================
// 範本版本（模擬戰，GM 專用）的驗證與整理（純函式）。
// 範本＝一份敵人清單（例如 9 小怪＋BOSS）；GM 迭代調整後存成一個個版本（v1、v2…），之後可以載入、比較（比較在前端用現在的玩家重新模擬）。
// 存在房間的 meta 表（key = sim_templates，JSON 陣列），只有 GM 讀寫，不廣播、不放進 hello；每日備份會一起備份。
// ============================================================
const KINDS = new Set(['mob', 'elite', 'boss']);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const num = (v, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

export const MAX_TEMPLATE_GROUPS = 12; // 一個版本最多幾組敵人

/** 整理敵人清單（只留已知欄位；數字要是整數且在範圍內）。回傳 { ok: true, specs } 或 { error } */
export function cleanSpecs(specs) {
  if (!Array.isArray(specs) || specs.length < 1 || specs.length > MAX_TEMPLATE_GROUPS) return { error: `敵人清單格式錯誤（要 1～${MAX_TEMPLATE_GROUPS} 組）。` };
  const out = [];
  for (const s of specs) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: '敵人清單格式錯誤。' };
    const kind = s.kind ?? 'mob';
    if (!KINDS.has(kind)) return { error: '敵人等級只能是小怪、菁英或 BOSS。' };
    if (!isInt(s.count, 1, kind === 'boss' ? 3 : 20)) return { error: `「${kind === 'boss' ? 'BOSS' : kind === 'elite' ? '菁英' : '小怪'}」的數量不合理。` };
    if (!isInt(s.atkPower, 1, 1_000_000) || !isInt(s.defPower, 0, 1_000_000) || !isInt(s.hp, 1, 10_000_000)) return { error: '攻擊／防禦／血量的數值不合理（要是整數）。' };
    const absDef = s.absDef === undefined ? 0 : s.absDef;
    if (!isInt(absDef, 0, 1_000_000)) return { error: '絕對防禦的數值不合理。' };
    out.push({ kind, count: s.count, atkPower: s.atkPower, defPower: s.defPower, hp: s.hp, absDef, atkMod: str(s.atkMod, 40), defMod: str(s.defMod, 40) });
  }
  return { ok: true, specs: out };
}

/** 存檔當時的成績（只是歷史參考，標註日期與玩家；之後比較版本一律用現在的玩家重新模擬）。沒給或格式不對回傳 null */
export function cleanSnap(snap) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
  const win = num(snap.win, 0, 1); const rounds = num(snap.rounds, 0, 1000); const drain = num(snap.drain, 0, 1); const hpLeft = num(snap.hpLeft, 0, 1);
  if (win === null || rounds === null || drain === null || hpLeft === null) return null;
  const players = Array.isArray(snap.players) ? snap.players.slice(0, 12).map((n) => str(n, 40)).filter(Boolean) : [];
  return { at: isInt(snap.at, 0, 8_640_000_000_000_000) ? snap.at : 0, runs: isInt(snap.runs, 0, 100_000) ? snap.runs : 0, win, rounds, drain, hpLeft, players };
}
