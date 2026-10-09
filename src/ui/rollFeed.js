// ============================================================
// 擲骰紀錄的畫面：骰盤與戰鬥頁共用。文字一律走 textContent（防 XSS）
// ============================================================
import { h, fmt } from './dom.js';
import { parseTrackLine, parseTargetLine } from '../game/events.js';
import { TRACKS, TRACK_ATK_STAT } from '../game/rules.js';
import { getLog, subscribe } from '../state/rollLog.js';

const ICON = {
  check: '🎲', dice: '🎲', identify: '🔍', attack: '⚔️', defend: '🛡️', potion: '🧪', skill: '✨', note: '📝', audit: '📋', divider: '⚔️',
};

const clock = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const MAX_FACES = 30; // 一般檢定最多畫幾顆骰面，其餘只寫「另 N 顆」

/** 右上角的結果徽章（膠囊）文字 */
function badgeText(ev) {
  if (ev.big == null) return null;
  if (ev.kind === 'attack') return ev.tone === 'fail' ? '未破防' : `傷害 ${fmt(ev.big)}`;
  if (ev.kind === 'defend') return ev.tone === 'fail' ? `受傷 ${fmt(ev.big)}` : '無傷';
  return typeof ev.big === 'number' ? fmt(ev.big) : String(ev.big);
}

/**
 * 一般檢定的骰面：從事件文字讀出每一顆骰子（格式見 src/game/events.js 的 checkEvent／diceEvent）。
 * 回傳 { faces:[數字], sides, formula, rest:[其他說明行] }；讀不出來回傳 null。
 */
export function readFaces(ev) {
  const lines = ev.lines ?? [];
  if (ev.kind === 'check') {
    const m = String(lines[0] ?? '').match(/^1D20（(\d+)）\+ (-?\d+)$/);
    if (!m) return null;
    return { faces: [Number(m[1])], sides: 20, formula: `1D20 + ${m[2]}`, rest: lines.slice(1) };
  }
  if (ev.kind === 'dice') {
    const expr = String(ev.label).match(/^(\d+)D(\d+)/i);
    if (!expr) return null;
    const count = Number(expr[1]);
    const detail = String(lines[0] ?? '');
    let faces;
    // 「明細 3 + 4 + 1 + 2」最後可能接加減值，所以只取前 count 個數字
    if (detail.startsWith('明細 ')) faces = (detail.match(/\d+/g) ?? []).slice(0, count).map(Number);
    else if (detail.startsWith('骰面 ')) faces = [Number(detail.match(/\d+/)[0])];
    else if (!detail && count === 1) faces = [Number(ev.big)];
    else return null;
    if (faces.length !== count) return null;
    return { faces, sides: Number(expr[2]), formula: ev.label, rest: lines.slice(1) };
  }
  return null;
}

/** 六角形骰面列 */
function faceRow({ faces, sides }) {
  const shown = faces.slice(0, MAX_FACES);
  return h('div', { class: 'dice-faces', role: 'img', 'aria-label': `骰面 ${faces.join('、')}` },
    shown.map((n) => h('span', {
      class: 'die', dataset: { max: n === sides ? '1' : '0', min: n === 1 ? '1' : '0' }, text: String(n),
    })),
    faces.length > shown.length ? h('span', { class: 'dice-faces__more', text: `另 ${faces.length - shown.length} 顆` }) : null);
}

/**
 * 戰鬥擲骰：把逐軌文字行整理成「每個目標一組 A／B／C」。
 * 回傳 { groups:[{ id, tracks:[...] }], rest:[其他說明行] }；沒有軌道行回傳 null。
 */
function readTracks(ev) {
  const groups = [];
  const rest = [];
  let cur = null;
  for (const line of ev.lines ?? []) {
    const head = parseTargetLine(line);
    if (head) { cur = { id: head.id, tracks: [] }; groups.push(cur); continue; }
    const t = parseTrackLine(line);
    if (t) {
      if (!cur) { cur = { id: null, tracks: [] }; groups.push(cur); }
      cur.tracks.push(t);
      continue;
    }
    rest.push(line);
  }
  return groups.some((g) => g.tracks.length) ? { groups, rest } : null;
}

/** 一條軌道一列：軌道名｜顆數D4 = 合計｜對方防禦｜破防／未破防 */
function trackRow(t, ev) {
  if (!t) return null;
  const broke = t.damage > 0; // 破防 = 攻擊合計 > 防禦合計（該軌造成傷害，見 GAME_RULES.md）
  const name = ev.kind === 'defend' ? '敵方' : '我方';
  return h('div', { class: 'track', dataset: { track: t.track, broke: broke ? '1' : '0' } },
    h('span', { class: 'track__name' },
      h('b', { text: t.track }),
      TRACK_ATK_STAT[t.track] ? h('small', { text: TRACK_ATK_STAT[t.track].replace('傷害', '') }) : null),
    h('span', { class: 'track__atk', title: `${name}攻擊` }, h('span', { class: 'num', text: `${fmt(t.atkDice)}D4` }), ' = ', h('strong', { class: 'num', text: fmt(t.atkRoll) })),
    h('span', { class: 'track__def', title: ev.kind === 'defend' ? '我方防禦' : '對方防禦' },
      h('small', { text: '防 ' }), h('span', { class: 'num', text: `${fmt(t.defDice)}D4 = ${fmt(t.defRoll)}` })),
    // 顏色依玩家立場：我方破防＝藍（成功）；承受攻擊時被破防＝玫瑰紅（受傷），擋下＝藍
    h('span', { class: 'track__tag', dataset: { broke: broke ? '1' : '0', good: (ev.kind === 'defend' ? !broke : broke) ? '1' : '0' } },
      broke ? `${ev.kind === 'defend' ? '被破防' : '破防'} ${fmt(t.damage)}` : '未破防'));
}
const unusedRow = (track) => h('div', { class: 'track is-unused', dataset: { track } },
  h('span', { class: 'track__name' }, h('b', { text: track }), h('small', { text: TRACK_ATK_STAT[track].replace('傷害', '') })),
  h('span', { class: 'track__atk', text: '未使用' }));

function trackBlock({ groups }, ev) {
  return h('div', { class: 'tracks' }, groups.map((g) => {
    // 萬物歸一／大羅真仙：只有一條「全部」或「絕防」，單列顯示
    const pooled = g.tracks.some((t) => !TRACKS.includes(t.track));
    const rows = pooled
      ? g.tracks.map((t) => trackRow(t, ev))
      : TRACKS.map((tr) => { const t = g.tracks.find((x) => x.track === tr); return t ? trackRow(t, ev) : unusedRow(tr); });
    return h('div', { class: 'tracks__group' },
      g.id ? h('p', { class: 'tracks__target', text: g.id }) : null,
      rows);
  }));
}

/** 單一事件的卡片 */
export function renderRoll(ev, { fresh = false } = {}) {
  if (ev.kind === 'divider') { // GM 開新戰鬥：紀錄裡的分隔線，只是分段，不影響任何規則
    const label = /^第 \d+ 場戰鬥$/.test(ev.label) ? `${ev.label}開始` : ev.label;
    return h('li', { class: 'roll roll--divider', dataset: { tone: '', fresh: fresh ? '1' : '0' } },
      h('div', { class: 'divider' },
        h('span', { class: 'divider__line', 'aria-hidden': 'true' }),
        h('strong', { class: 'roll__label', text: label }),
        h('span', { class: 'divider__line', 'aria-hidden': 'true' })),
      h('span', { class: 'roll__sub' },
        h('time', { class: 'roll__time', text: clock(ev.t) }),
        ev.lines?.length ? `　${ev.lines.join('　')}` : null));
  }
  const battle = ev.kind === 'attack' || ev.kind === 'defend' ? readTracks(ev) : null;
  const faces = battle ? null : readFaces(ev);
  const badge = badgeText(ev);
  const rest = battle ? battle.rest : faces ? faces.rest : ev.lines ?? [];
  return h('li', { class: `roll roll--${ev.kind}`, dataset: { tone: ev.tone ?? '', fresh: fresh ? '1' : '0' } },
    h('div', { class: 'roll__head' },
      h('span', { class: 'roll__icon', 'aria-hidden': 'true', text: ICON[ev.kind] ?? '🎲' }),
      h('span', { class: 'roll__who', text: ev.who }),
      h('span', { class: 'roll__label', text: ev.label }),
      h('time', { class: 'roll__time', text: clock(ev.t) }),
      badge ? h('span', { class: 'roll__badge', dataset: { tone: ev.tone ?? '' }, text: badge }) : null),
    faces
      ? h('div', { class: 'roll__dice' },
          faceRow(faces),
          h('p', { class: 'roll__formula' }, h('span', { text: faces.formula }), ' = ', h('strong', { class: 'num', text: fmt(ev.big) })))
      : null,
    battle ? trackBlock(battle, ev) : null,
    !faces && !battle && ev.big != null ? h('div', { class: 'roll__big', text: typeof ev.big === 'number' ? fmt(ev.big) : String(ev.big) }) : null,
    rest.length ? h('ul', { class: 'roll__lines' }, rest.map((l) => h('li', { text: l }))) : null);
}

/**
 * 把紀錄清單掛進 container，之後有新事件會自動更新。
 * 回傳 { destroy }；limit 是最多顯示幾筆，skip 是略過最新的幾筆，filter 是只留下哪些事件（沒給就全留）。
 * oldestFirst：舊的在上、新的在下（聊天室那樣），而且 container 本身會捲動：
 *   一開始捲到最底；有新紀錄時，原本就在底部附近才自動捲到底（正在往上看舊紀錄時不打擾）。
 */
export function mountFeed(container, { limit = 30, skip = 0, empty = '還沒有人擲骰。', filter = null, oldestFirst = false } = {}) {
  let first = true;
  const draw = (latest) => {
    const all = filter ? getLog().filter(filter) : getLog();
    const list = all.slice(skip, skip + limit);
    if (oldestFirst) list.reverse();
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    container.replaceChildren(
      list.length
        ? h('ol', { class: 'roll-list' }, list.map((e) => renderRoll(e, { fresh: Boolean(latest) && latest.id === e.id })))
        : h('p', { class: 'empty', text: empty }));
    if (oldestFirst && (first || nearBottom)) container.scrollTop = container.scrollHeight;
    first = false;
  };
  draw(null);
  const off = subscribe(draw);
  return { destroy: off };
}
