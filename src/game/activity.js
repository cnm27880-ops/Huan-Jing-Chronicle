// ============================================================
// 玩家日誌（修整、學習、物品）的內容格式與整理（純函式；前後端共用）。
// 一筆日誌：{ cat: 'rest' | 'learn' | 'item' | 'sys', text, lines[] }。伺服器另外加上 id、時間、玩家與角色名稱。
// sys ＝ 系統：GM 改玩家角色、新增專屬技能／特殊配方等（伺服器自己寫入）。
// ============================================================
export const ACTIVITY_CATS = { rest: '修整', learn: '學習', item: '物品', sys: '系統' };
export const ACT_TEXT_MAX = 120;
export const ACT_LINE_MAX = 80;
export const ACT_LINES_MAX = 10;

const q = (name, n) => `${name} ×${Number(n).toLocaleString('zh-TW')}`;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** 把「物品 → 數量」變成文字行（多的在前） */
export const lootLines = (loot) => Object.entries(loot ?? {}).sort((a, b) => b[1] - a[1]).map(([n, c]) => q(n, c));

/** 修整頁的結果卡（gather／craft／note）→ 日誌內容 { cat, text, lines } */
export function restEntry(r) {
  if (r.kind === 'note') return { cat: 'rest', text: r.text, lines: [] };
  const n = r.rolls?.length ?? 0;
  const used = (r.rolls ?? []).flatMap((x) => x.used ?? []);
  const usedLine = used.length ? [`用掉紀念品：${[...new Set(used)].map((u) => q(u, used.filter((x) => x === u).length)).join('、')}`] : [];
  if (!n) return { cat: 'rest', text: r.kind === 'gather' ? `採集 ${r.action}：時間不足，沒有採集` : `製作 ${r.action}（${r.diff}）：原料不足，沒有製作`, lines: [] };
  if (r.kind === 'gather') {
    return { cat: 'rest', text: `採集 ${r.action} ×${n}，經驗 +${Number(r.exp ?? 0).toLocaleString('zh-TW')}`, lines: [...lootLines(r.loot), ...usedLine] };
  }
  const ok = r.rolls.filter((x) => x.success).length;
  const doubled = r.rolls.some((x) => x.doubled) ? '（含產出雙倍）' : '';
  return {
    cat: 'rest',
    text: `製作 ${r.action}（${r.diff}）×${n}，成功 ${ok}/${n}${doubled}`,
    lines: ok ? [...lootLines(r.loot), ...usedLine] : ['全部失敗，原料全毀', ...usedLine],
  };
}

/** 伺服器與前端都用這個整理：不合格式回傳 null；合格回傳乾淨的 { cat, text, lines } */
export function cleanActivity(raw) {
  if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(ACTIVITY_CATS, raw.cat)) return null;
  const text = clip(raw.text, ACT_TEXT_MAX);
  if (!text) return null;
  const lines = Array.isArray(raw.lines) ? raw.lines.map((l) => clip(l, ACT_LINE_MAX)).filter(Boolean).slice(0, ACT_LINES_MAX) : [];
  return { cat: raw.cat, text, lines };
}
