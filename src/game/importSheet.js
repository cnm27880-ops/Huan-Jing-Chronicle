// ============================================================
// 試算表角色卡（自動卡）→ 網站角色。純函式。
// 輸入是 GM 在試算表「角色永久狀態」分頁全選、複製後貼上的文字（Google 試算表複製出來是 TSV，
// 含引號與換行）。程式用「標題文字」找位置，不看固定格子，所以各版本排版不同也讀得到；
// 讀的是算好的值，不看公式。玩家改過公式也不影響讀取，結果要在預覽畫面讓 GM 確認。
//
// 只匯入：角色名稱、已學會的技能與等級、生活技能與技藝的值、胃袋的食物、目前生命與資源。
// 不匯入：玩家名稱（個資）、背包（走機器人存檔匯入）。
// 數值：網站自己用「技能 + 裝備 + 食物」算；試算表面板與網站算出來的差，存成「手動調整」
//   （自由分配、愚者對調、還沒搬到網站的裝備都在裡面），GM 之後可以改。
// ============================================================
import { ALL_STATS, RESOURCE_STATS, LIFE_SKILLS, ART_SKILLS, FOODS, STOMACH_SLOTS } from './rules.js';
import { SKILL_CATALOG, moveFromCatalog } from './skills.js';
import { inCatalog, needsActivation, MAX_SKILL_LEVEL } from './skillTable.js';
import { derivedStats } from './stats.js';
import { blankCharacter } from './importBot.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const PANEL_STATS = ALL_STATS.filter((s) => !RESOURCE_STATS.includes(s)); // 真實傷害、物理傷害…絕對防禦…精神意志
const MAX_TEXT = 3_000_000; // 貼上的文字上限（整頁約 100KB，三百萬字已經遠超）
const HEAD_ROWS = 40; // 面板在前 40 列內找

/** TSV 解析：支援引號欄位（內含換行、跳脫的 ""） */
export function parseTsv(text) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return v !== '' && v != null && Number.isFinite(n) ? n : null; };
const cellsRight = (row, c) => row.slice(c + 1);
const firstText = (row, c) => cellsRight(row, c).find((x) => x !== '') ?? '';
const firstNum = (row, c) => { for (const x of cellsRight(row, c)) { const n = num(x); if (n !== null) return n; if (x !== '') return null; } return null; };

/** 在前 HEAD_ROWS 列找第一個等於 label 的格子 */
function find(grid, label, rows = HEAD_ROWS) {
  for (let r = 0; r < Math.min(grid.length, rows); r++) {
    const c = grid[r].indexOf(label);
    if (c >= 0) return { r, c };
  }
  return null;
}

/**
 * 解析貼上的文字。回傳 { name, panel, resources, lifeSkills, arts, foods, learned, warnings }
 * learned：[{ name, level }]（等級空白 = 0，照 GM 的規則）；其餘找不到的欄位放進 warnings
 */
export function parseSheet(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: '沒有貼上內容。' };
  if (text.length > MAX_TEXT) return { error: '貼上的內容太大，不像是角色卡。' };
  const grid = parseTsv(text);
  const warnings = [];
  const at = find(grid, '角色名稱');
  const name = at ? firstText(grid[at.r], at.c).slice(0, 80) : '';
  if (!name) return { error: '找不到「角色名稱」。請在試算表的「角色永久狀態」分頁全選（Ctrl+A）、複製後貼上。' };

  const panel = {};
  for (const stat of PANEL_STATS) {
    const p = find(grid, stat);
    const v = p ? firstNum(grid[p.r], p.c) : null;
    if (v === null) warnings.push(`找不到「${stat}」`); else panel[stat] = v;
  }
  const resources = {}; // { 生命: { now, max } }
  for (const stat of RESOURCE_STATS) {
    const p = find(grid, stat, 12);
    if (!p) { warnings.push(`找不到「${stat}」`); continue; }
    const row = grid[p.r].slice(p.c + 1, p.c + 6); // 生命 | 目前 | n | 最大 | m
    const iNow = row.indexOf('目前'); const iMax = row.indexOf('最大');
    const now = iNow >= 0 ? num(row[iNow + 1]) : null; const max = iMax >= 0 ? num(row[iMax + 1]) : null;
    if (max === null) warnings.push(`找不到「${stat}」的最大值`); else resources[stat] = { now: now ?? max, max };
  }
  const pick = (labels) => {
    const out = {};
    for (const s of labels) { const p = find(grid, s, 24); const v = p ? firstNum(grid[p.r], p.c) : null; if (v !== null) out[s] = Math.max(0, Math.floor(v)); }
    return out;
  };
  const lifeSkills = pick(LIFE_SKILLS);
  const arts = pick(ART_SKILLS);

  const foods = [];
  for (let r = 0; r < Math.min(grid.length, HEAD_ROWS); r++) {
    grid[r].forEach((x, c) => { if (x === '胃袋') { const f = firstText(grid[r], c); if (FOODS[f]) foods.push(f); } });
  }

  // 已學會的技能：用表頭「技能名稱／等級」定位，往下每個有名稱的列就是一個技能，「未習得」是空位
  const learned = [];
  const head = find(grid, '技能名稱', 80);
  if (!head) warnings.push('找不到「已學會的技能」表');
  else {
    const hr = grid[head.r];
    const lvCol = hr.indexOf('等級', head.c);
    if (lvCol < 0) warnings.push('找不到技能的「等級」欄');
    const seen = new Map();
    for (let r = head.r + 1; r < grid.length; r++) {
      const n = (grid[r][head.c] ?? '').trim();
      if (!n || n === '未習得' || n.length > 40) continue;
      const lv = lvCol >= 0 ? num(grid[r][lvCol]) : null;
      const level = Math.max(0, Math.min(MAX_SKILL_LEVEL, Math.floor(lv ?? 0)));
      seen.set(n, Math.max(seen.get(n) ?? 0, level));
    }
    for (const [n, level] of seen) learned.push({ name: n, level });
  }
  return { name, panel, resources, lifeSkills, arts, foods: foods.slice(0, STOMACH_SLOTS), learned, warnings };
}

/**
 * 把解析結果轉成網站角色。
 * base：伺服器上已有的角色（沒有就 null，會用空白角色）。
 * opts.activated：Set，這些啟動類技能在試算表上已經啟動（面板數值已含它們）。
 * 回傳 { data, report }：
 *   report.dropped 目錄裡沒有的技能（直接丟掉）、report.zero 等級 0 的技能、report.adjust 算出的手動調整、
 *   report.negative 調整為負的屬性（網站算出來比試算表面板還高，常見原因：玩家改過公式、試算表漏算了某些技能）、
 *   report.fractional 試算表面板是小數的屬性（玩家改掉了「無條件進位」的公式；網站依 GM 的規則進位，差不到 1）
 */
export function convertSheet(parsed, base = null, { activated = new Set() } = {}) {
  if (!parsed || parsed.error) return { error: parsed?.error ?? '沒有資料。' };
  const data = base ? clone(base) : blankCharacter(parsed.name);
  if (!base) data.name = parsed.name;
  const dropped = []; const zero = [];
  const skills = {};
  for (const { name, level } of parsed.learned) {
    if (!inCatalog(name)) { dropped.push(name); continue; }
    skills[name] = level;
    if (level === 0) zero.push(name);
  }
  data.skills = skills;
  data.statMode = 'skills';
  data.baseStats = Object.fromEntries(ALL_STATS.map((s) => [s, 0]));
  data.adjust = {};
  data.skillOn = Object.fromEntries([...activated].filter((n) => n in skills && needsActivation(n)).map((n) => [n, true]));
  Object.assign(data.lifeSkills, parsed.lifeSkills);
  Object.assign(data.arts, parsed.arts);
  data.sessionStomach = parsed.foods.map((food) => ({ food })); // 面板已含這些食物，所以也放進胃袋，網站才會一起算
  for (const n of Object.keys(skills)) { // 技能庫的招式（有等級才給）
    if (skills[n] > 0 && SKILL_CATALOG[n] && !data.moves.some((m) => m.skill === n)) data.moves.push(moveFromCatalog(n));
  }
  // 手動調整 = 試算表面板 − 網站用技能、裝備、食物算出來的值。
  // 暴徒（物理的一半）與啟動的算力扣除都會跟著調整後的數值變，所以反覆修正到面板完全吻合
  const target = { ...parsed.panel, ...Object.fromEntries(Object.entries(parsed.resources).map(([s, v]) => [s, v.max])) };
  const adjust = {};
  data.adjust = adjust;
  for (let round = 0; round < 8; round++) {
    const mine = derivedStats(data);
    let changed = false;
    for (const [stat, want] of Object.entries(target)) {
      const diff = Math.round(want - mine[stat].total);
      if (diff !== 0) { adjust[stat] = (adjust[stat] ?? 0) + diff; changed = true; }
    }
    if (!changed) break;
  }
  for (const stat of Object.keys(adjust)) if (adjust[stat] === 0) delete adjust[stat];
  const after = derivedStats(data);
  data.resources = { ...(data.resources ?? {}) };
  for (const stat of RESOURCE_STATS) {
    const r = parsed.resources[stat];
    if (!r) continue;
    const now = Math.max(0, Math.min(Math.floor(r.now), after[stat].total));
    if (stat === '生命') data.hp = now; else data.resources[stat] = now;
  }
  data.migrated = { ...(data.migrated ?? {}), brute: true };
  return {
    data,
    report: {
      name: parsed.name, learned: Object.keys(skills).length, dropped, zero, adjust,
      activation: Object.keys(skills).filter(needsActivation),
      negative: Object.keys(adjust).filter((s) => adjust[s] < 0),
      fractional: Object.keys(target).filter((s) => !Number.isInteger(target[s])),
      missing: parsed.warnings,
    },
  };
}
