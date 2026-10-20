// ============================================================
// 分析頁：把房間裡每位玩家回報的攻防數值與資源上限排在一起比較（玩家看自己排第幾，GM 看隊伍落差好調整怪物）。
// 資料來源是房間的「隊友狀態」（rollLog.js 的 vitals，每人存檔後自動回報，全員看得到）；GM 設為「不顯示於資源條」的玩家，
// 一般玩家看不到（和資源條一致），GM 看得到。還沒更新到新版回報的玩家，攻防欄會合併顯示「尚未同步新版攻防」。
// 版面：桌機三大群組全展開（雙層表頭）；手機（< 900px）用底線分頁一次只顯示一個群組，不用橫向滑動。
// 沒加入房間：只有自己。內容一律用 textContent。
// ============================================================
import { h, fmt } from './dom.js';
import { getRoomStatus, subscribeRoom } from '../state/rollLog.js';
import { vitalsOf } from '../state/vitals.js';
import { ATK_STATS, DEF_STATS, TRUE_ATK, TRUE_DEF } from '../game/rules.js';

const RES_COLS = ['靈氣', '魔力', '能量', '鬥氣', '算力'];
const sumOf = (v, keys) => {
  const xs = keys.map((k) => v.stats?.[k]);
  return xs.every((n) => Number.isFinite(n)) ? xs.reduce((a, b) => a + b, 0) : undefined;
};
const TOTAL_ATK = '總傷';
const TOTAL_DEF = '總防';

/** 三大群組（桌機是三段表頭、手機是三個分頁）；每個群組 5 欄 */
export const GROUPS = [
  { id: 'atk', label: '進攻傷害', cols: [...ATK_STATS.map((k) => ({ id: k, label: k.replace(/傷害$/, ''), get: (v) => v.stats?.[k] })),
    { id: TOTAL_ATK, label: TOTAL_ATK, total: true, get: (v) => sumOf(v, ATK_STATS) }], missing: 'stats' },
  { id: 'def', label: '防禦韌性', cols: [...DEF_STATS.map((k) => ({ id: k, label: k, get: (v) => v.stats?.[k] })),
    { id: TOTAL_DEF, label: TOTAL_DEF, total: true, get: (v) => sumOf(v, DEF_STATS) }], missing: 'stats' },
  { id: 'res', label: '五系資源', cols: RES_COLS.map((k) => ({ id: k, label: k, get: (v) => v.res?.[k]?.[1] })) },
];
const HP_COL = { id: 'maxHp', label: '生命', get: (v) => v.maxHp };
const ALL_COLS = [HP_COL, ...GROUPS.flatMap((g) => g.cols.map((c) => ({ ...c, group: g.id })))];
const colOf = (id) => ALL_COLS.find((c) => c.id === id);

const ARCHETYPE = {
  [TRUE_ATK]: '真實特化', 物理傷害: '物理特化', 能量傷害: '魔導', 靈魂傷害: '靈魂特化',
  [TRUE_DEF]: '絕對防禦流', 體魄強韌: '體魄流', 抗性免疫: '抗性流', 精神意志: '精神抗性流',
};

/** 流派小標籤：八項攻防裡數值最高的那一項（同分取前面的）；還沒同步或全是 0 回傳 '' */
export function archetypeOf(v) {
  let best = '';
  let max = 0;
  for (const k of [...ATK_STATS, ...DEF_STATS]) {
    const n = v?.stats?.[k];
    if (Number.isFinite(n) && n > max) { max = n; best = k; }
  }
  return ARCHETYPE[best] ?? '';
}

/** 要比較的玩家 [{ uid, name, v }]：房間裡有回報的人；一般玩家看不到被 GM 隱藏的人。沒加入房間就只有自己 */
export function analysisPlayers(room, localVitals) {
  if (room.phase !== 'online') return localVitals ? [{ uid: 'me', name: localVitals.name || '我', v: localVitals, me: true }] : [];
  const gmUids = new Set(room.gm?.uids ?? []);
  const hidden = new Set(room.hiddenVitals ?? []);
  const iAmGm = Boolean(room.me?.isGm);
  return Object.entries(room.vitals ?? {})
    .filter(([uid]) => !gmUids.has(uid) && (iAmGm || !hidden.has(uid)))
    .map(([uid, v]) => ({ uid, name: v.name || uid, v, me: uid === room.me?.uid }));
}

/** 每一欄的最高、最低（只算有數值的人；沒有人有數值回傳 null） */
export function columnStats(rows, col) {
  const xs = rows.map((r) => col.get(r.v)).filter((n) => Number.isFinite(n));
  return xs.length ? { max: Math.max(...xs), min: Math.min(...xs) } : null;
}

/** 與基準玩家的差值（任一邊沒有數值回傳 null） */
export function diffOf(col, v, baseV) {
  const a = col.get(v);
  const b = baseV ? col.get(baseV) : undefined;
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

const holders = (rows, get) => {
  const best = rows.filter((r) => Number.isFinite(get(r.v)));
  if (!best.length) return null;
  const max = Math.max(...best.map((r) => get(r.v)));
  return max > 0 ? { max, names: best.filter((r) => get(r.v) === max).map((r) => r.name) } : null;
};

/** 3 張戰力觀測摘要卡 [{ icon, title, text }]（還沒有數據時回傳空陣列） */
export function insights(rows) {
  const out = [];
  const topAtk = holders(rows, (v) => sumOf(v, ATK_STATS));
  if (topAtk) {
    const r = rows.find((x) => sumOf(x.v, ATK_STATS) === topAtk.max);
    const best = [...ATK_STATS].sort((a, b) => r.v.stats[b] - r.v.stats[a])[0];
    out.push({ icon: '⚔️', title: '進攻火力之冠', text: `${topAtk.names.join('、')} 的四傷總和 ${fmt(topAtk.max)} 全隊最高，最強的一項是${best} ${fmt(r.v.stats[best])}。` });
  }
  const topDef = holders(rows, (v) => sumOf(v, DEF_STATS));
  if (topDef) {
    const hp = holders(rows, (v) => v.maxHp);
    const res = holders(rows, (v) => v.stats?.抗性免疫);
    const extra = [hp && `生命最高是 ${hp.names.join('、')}（${fmt(hp.max)}）`, res && `抗性免疫最高是 ${res.names.join('、')}（${fmt(res.max)}）`].filter(Boolean);
    out.push({ icon: '🛡️', title: '防禦韌性之冠', text: `${topDef.names.join('、')} 的四防總和 ${fmt(topDef.max)} 全隊最高${extra.length ? `；${extra.join('，')}` : ''}。` });
  }
  const res = RES_COLS.map((k) => [k, holders(rows, (v) => v.res?.[k]?.[1])]).filter(([, t]) => t);
  if (res.length) out.push({ icon: '🔮', title: '資源領域極限', text: res.map(([k, t]) => `${k} ${t.names.join('、')}（${fmt(t.max)}）`).join('　') });
  return out;
}

export function createAnalysisView({ root, getState }) {
  const ui = { sort: 'maxHp', desc: true, active: false, tab: 'atk', diff: false, base: null };
  let unsub = null;

  function sortedRows(rows) {
    const col = colOf(ui.sort) ?? HP_COL;
    const val = (r) => { const n = col.get(r.v); return Number.isFinite(n) ? n : -Infinity; };
    return [...rows].sort((a, b) => (ui.desc ? val(b) - val(a) : val(a) - val(b)) || a.name.localeCompare(b.name));
  }

  function cell(r, col, st, baseRow) {
    const n = col.get(r.v);
    if (!Number.isFinite(n)) return h('td', { class: 'an__cell an__cell--none', dataset: { g: col.group }, text: '—' });
    const pct = st && st.max > 0 ? Math.max(0, Math.min(100, (n / st.max) * 100)) : 0;
    const top = st && st.max !== st.min && n === st.max;
    const d = ui.diff && baseRow && baseRow !== r ? diffOf(col, r.v, baseRow.v) : null;
    return h('td', { class: `an__cell num${col.total ? ' an__cell--total' : ''}`, dataset: { g: col.group, tone: top ? 'top' : '', first: col.first ? '1' : '' }, style: `--an-pct:${pct}%` },
      h('span', { class: 'an__n', text: fmt(n) }),
      d == null ? null : h('span', { class: 'an__d', dataset: { sign: d > 0 ? '+' : d < 0 ? '-' : '0' }, text: `${d > 0 ? '+' : ''}${fmt(d)}` }));
  }

  /** 一個群組整個還沒同步（攻防）：合併成一格淡色說明 */
  function mergedNone(g) {
    return h('td', { class: 'an__cell an__cell--unsynced', colspan: g.cols.length, dataset: { g: g.id, first: '1' }, text: '尚未同步新版攻防' });
  }

  function render() {
    if (!ui.active) return;
    const room = getRoomStatus();
    const rows = analysisPlayers(room, room.phase === 'online' ? null : vitalsOf(getState?.() ?? {}));
    const stats = Object.fromEntries(ALL_COLS.map((c) => [c.id, columnStats(rows, c)]));
    const baseRow = rows.find((r) => r.uid === ui.base) ?? rows.find((r) => r.me) ?? null;
    const canDiff = rows.length > 1 && Boolean(baseRow);
    const cols = (g) => g.cols.map((c, i) => ({ ...c, group: g.id, first: i === 0 }));

    const table = h('table', { class: 'an', dataset: { tab: ui.tab } },
      h('thead', {},
        h('tr', { class: 'an__groups' },
          h('th', { class: 'an__name an__ghead', scope: 'col', text: '玩家與生存' }),
          GROUPS.map((g) => h('th', { class: 'an__ghead', scope: 'colgroup', colspan: g.cols.length, dataset: { g: g.id, first: '1' }, text: g.label }))),
        h('tr', {},
          h('th', { class: 'an__name', scope: 'col', 'aria-sort': ui.sort === 'maxHp' ? (ui.desc ? 'descending' : 'ascending') : 'none' },
            h('button', { type: 'button', class: 'an__sort', onclick: () => { if (ui.sort === 'maxHp') ui.desc = !ui.desc; else { ui.sort = 'maxHp'; ui.desc = true; } render(); } },
              '玩家 · 生命', ui.sort === 'maxHp' ? (ui.desc ? ' ▼' : ' ▲') : '')),
          GROUPS.flatMap((g) => cols(g).map((c) => h('th', { scope: 'col', dataset: { g: g.id, first: c.first ? '1' : '' }, 'aria-sort': ui.sort === c.id ? (ui.desc ? 'descending' : 'ascending') : 'none' },
            h('button', { type: 'button', class: 'an__sort', onclick: () => { if (ui.sort === c.id) ui.desc = !ui.desc; else { ui.sort = c.id; ui.desc = true; } render(); } },
              c.label, ui.sort === c.id ? (ui.desc ? ' ▼' : ' ▲') : '')))))),
      h('tbody', {}, sortedRows(rows).map((r) => {
        const tag = archetypeOf(r.v);
        return h('tr', { class: r.me ? 'is-me' : '' },
          h('th', { class: 'an__name', scope: 'row' },
            h('button', { type: 'button', class: 'an__who', title: '設為比較基準', 'aria-pressed': String(baseRow === r && ui.diff),
              onclick: () => { ui.base = r.uid; ui.diff = true; render(); } },
              h('span', { class: 'an__nm', text: r.me ? `${r.name}（我）` : r.name }),
              baseRow === r && ui.diff && rows.length > 1 ? h('span', { class: 'an__base', text: '基準' }) : null),
            h('span', { class: 'an__hp num', text: Number.isFinite(r.v.maxHp) ? `❤ ${fmt(r.v.maxHp)}` : '' }),
            tag ? h('span', { class: 'an__tag', text: tag }) : null),
          GROUPS.flatMap((g) => (g.missing && !g.cols.some((c) => Number.isFinite(c.get(r.v)))
            ? [mergedNone(g)]
            : cols(g).map((c) => cell(r, c, stats[c.id], baseRow))))); // 少了個別欄位時單格顯示「—」
      })));

    const tabs = h('div', { class: 'tabs-line an__tabs', role: 'tablist', 'aria-label': '數值群組' },
      GROUPS.map((g) => h('button', { type: 'button', role: 'tab', class: 'tabs-line__tab', 'aria-selected': String(ui.tab === g.id),
        onclick: () => { ui.tab = g.id; render(); } }, `${g.label} (${g.cols.length})`)));
    const bar = h('div', { class: 'an__bar' },
      tabs,
      h('button', { type: 'button', class: 'toggle an__diff', 'aria-pressed': String(ui.diff && canDiff), disabled: !canDiff,
        title: canDiff ? '' : '要有兩位以上的玩家才能比較',
        onclick: () => { ui.diff = !ui.diff; render(); } }, '顯示與我的差值 (±)'));

    const cards = insights(rows);
    const body = rows.length
      ? [bar, h('div', { class: 'an__scroll' }, table),
        cards.length ? h('div', { class: 'an__insights' }, cards.map((c) => h('div', { class: 'an__insight' },
          h('p', { class: 'an__insight-title', text: `${c.icon} ${c.title}` }),
          h('p', { class: 'an__insight-text', text: c.text })))) : null]
      : [h('p', { class: 'notice', text: '還沒有任何玩家的數據。玩家連上房間並存檔後就會出現在這裡。' })];
    root.replaceChildren(h('section', { class: 'card analysis' },
      h('h2', { class: 'section-title', text: '數值分析' }),
      h('p', { class: 'hint', text: room.phase === 'online'
        ? '每位玩家目前的攻防數值（含裝備、食物）與資源上限，點欄位標題可以排序。金色＝該欄最高，底下的條是相對最高值的比例；點玩家名稱可設為比較基準。數值在玩家存檔後自動更新。'
        : '目前沒有加入房間，只看得到自己的數字。登入並加入房間後，就能和所有玩家比較。' }),
      body));
  }

  return {
    render() {
      ui.active = true;
      if (!unsub) unsub = subscribeRoom(() => { if (ui.active) render(); });
      render();
    },
    leave() { ui.active = false; unsub?.(); unsub = null; },
  };
}
