// ============================================================
// 分析頁：把房間裡每位玩家回報的攻防數值與資源上限排在一起比較（玩家看自己排第幾，GM 看隊伍落差好調整怪物）。
// 資料來源是房間的「隊友狀態」（rollLog.js 的 vitals，每人存檔後自動回報，全員看得到）；GM 設為「不顯示於資源條」的玩家，
// 一般玩家看不到（和資源條一致），GM 看得到。還沒更新到新版回報的玩家，攻防欄會顯示「—」。
// 沒加入房間：只有自己。內容一律用 textContent。
// ============================================================
import { h, fmt } from './dom.js';
import { getRoomStatus, subscribeRoom } from '../state/rollLog.js';
import { vitalsOf } from '../state/vitals.js';
import { ATK_STATS, DEF_STATS } from '../game/rules.js';

const STAT_COLS = [...ATK_STATS, ...DEF_STATS];
const RES_COLS = ['靈氣', '魔力', '能量', '鬥氣', '算力'];
const COLS = [
  { id: 'maxHp', label: '生命', get: (v) => v.maxHp },
  ...STAT_COLS.map((k) => ({ id: k, label: k, get: (v) => v.stats?.[k] })),
  ...RES_COLS.map((k) => ({ id: k, label: k, get: (v) => v.res?.[k]?.[1] })),
];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

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

/** 每一欄的最高、最低、平均、中位數（只算有數值的人；少於 1 人回傳 null） */
export function columnStats(rows, col) {
  const xs = rows.map((r) => col.get(r.v)).filter((n) => Number.isFinite(n));
  if (!xs.length) return null;
  return { max: Math.max(...xs), min: Math.min(...xs), avg: xs.reduce((a, b) => a + b, 0) / xs.length, mid: median(xs) };
}

export function createAnalysisView({ root, getState }) {
  const ui = { sort: 'maxHp', desc: true, active: false };
  let unsub = null;

  function sortedRows(rows) {
    const col = COLS.find((c) => c.id === ui.sort) ?? COLS[0];
    const val = (r) => { const n = col.get(r.v); return Number.isFinite(n) ? n : -Infinity; };
    return [...rows].sort((a, b) => (ui.desc ? val(b) - val(a) : val(a) - val(b)) || a.name.localeCompare(b.name));
  }

  function cell(r, col, st) {
    const n = col.get(r.v);
    if (!Number.isFinite(n)) return h('td', { class: 'an__cell an__cell--none', text: '—' });
    const pct = st && st.max > 0 ? Math.max(0, Math.min(100, (n / st.max) * 100)) : 0;
    const tone = st && st.max !== st.min ? (n === st.max ? 'top' : n === st.min ? 'low' : '') : '';
    return h('td', { class: 'an__cell num', dataset: { tone }, style: `--an-pct:${pct}%`, text: fmt(n) });
  }

  function render() {
    if (!ui.active) return;
    const room = getRoomStatus();
    const rows = analysisPlayers(room, room.phase === 'online' ? null : vitalsOf(getState?.() ?? {}));
    const stats = Object.fromEntries(COLS.map((c) => [c.id, columnStats(rows, c)]));
    const body = rows.length
      ? h('div', { class: 'an__scroll' }, h('table', { class: 'an' },
        h('thead', {}, h('tr', {},
          h('th', { class: 'an__name', scope: 'col', text: '玩家' }),
          COLS.map((c) => h('th', { scope: 'col', 'aria-sort': ui.sort === c.id ? (ui.desc ? 'descending' : 'ascending') : 'none' },
            h('button', { type: 'button', class: 'an__sort', onclick: () => { if (ui.sort === c.id) ui.desc = !ui.desc; else { ui.sort = c.id; ui.desc = true; } render(); } },
              c.label, ui.sort === c.id ? (ui.desc ? ' ▼' : ' ▲') : ''))))),
        h('tbody', {}, sortedRows(rows).map((r) => h('tr', { class: r.me ? 'is-me' : '' },
          h('th', { class: 'an__name', scope: 'row', text: r.me ? `${r.name}（我）` : r.name }),
          COLS.map((c) => cell(r, c, stats[c.id]))))),
        rows.length > 1
          ? h('tfoot', {}, [['最高', 'max'], ['平均', 'avg'], ['中位數', 'mid'], ['最低', 'min']].map(([label, key]) => h('tr', {},
            h('th', { class: 'an__name', scope: 'row', text: label }),
            COLS.map((c) => h('td', { class: 'an__cell num', text: stats[c.id] ? fmt(Math.round(stats[c.id][key])) : '—' })))))
          : null))
      : h('p', { class: 'notice', text: '還沒有任何玩家的數據。玩家連上房間並存檔後就會出現在這裡。' });
    root.replaceChildren(h('section', { class: 'card analysis' },
      h('h2', { class: 'section-title', text: '數值分析' }),
      h('p', { class: 'hint', text: room.phase === 'online'
        ? '每位玩家目前的攻防數值（含裝備、食物）與資源上限，點欄位標題可以排序。金色＝該欄最高、紅色＝該欄最低，底下的條是相對最高值的比例。數值在玩家存檔後自動更新；「—」代表那位玩家還沒更新到新版。'
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
