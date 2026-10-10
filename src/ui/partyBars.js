// ============================================================
// 隊友資源條（跑團頁右欄、房間上方）：每位隊友的生命、各資源「還剩多少」、毒性（還能喝多少藥）與「已動用 %」。
// 折疊時只看摘要（有人倒地會變紅），所以不用展開也知道隊伍狀況。戰鬥中資源還很滿的人會被標 🔔。
// GM 不顯示（使用者 2026-10-10：GM 不會特意去注意）。資料是房間廣播的 vitals（src/state/vitals.js），判斷在 src/game/nudge.js。
// ============================================================
import { h, fmt } from './dom.js';
import { getRoomStatus, getEncounter } from '../state/rollLog.js';
import { usageOf, barsOf, partyDigest, NUDGE } from '../game/nudge.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const hpPct = (v) => (v.maxHp > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHp)) : 0);
/** 生命狀態：down 倒地、low 危急（< 30%）、mid（< 60%）、ok；決定圓環與生命條的顏色 */
const hpState = (v) => (v.downed ? 'down' : hpPct(v) < 0.3 ? 'low' : hpPct(v) < 0.6 ? 'mid' : 'ok');

/**
 * 資源小膠囊：底色是這種資源的顏色、填到「還剩多少」，名字在左、數字在右。
 * 毒性是「藥水空間」（還能喝多少），所以每個膠囊都是「填得越滿越有餘裕」。給隊友卡與提醒視窗共用。
 */
export function resPill({ key, now, max, left, text }) {
  return h('span', { class: `rpill${left <= 0 ? ' is-empty' : ''}`, dataset: { res: key }, title: text, role: 'img', 'aria-label': text },
    h('span', { class: 'rpill__fill', style: `width:${Math.round(left * 100)}%` }),
    h('span', { class: 'rpill__name', text: key === '毒性' ? '藥水空間' : key }),
    h('span', { class: 'rpill__val num', text: `${fmt(now)}/${fmt(max)}` }));
}

export function mateCard(v, { online = true, inBattle = false } = {}) {
  const use = usageOf(v);
  const idle = inBattle && !v.downed && use < NUDGE.idleUsage;
  const st = hpState(v);
  return h('li', { class: 'mate', dataset: { state: st, online: online ? '1' : '0' } },
    h('span', { class: 'mate__avatar', style: `--hp:${Math.round(hpPct(v) * 100)}`, role: 'img', 'aria-label': `生命 ${v.hp} / ${v.maxHp}` },
      h('span', { class: 'mate__initial', text: [...(v.name || '?')][0] })),
    h('div', { class: 'mate__main' },
      h('div', { class: 'mate__top' },
        h('span', { class: 'mate__name', text: v.name }),
        v.downed ? h('span', { class: 'mate__tag', dataset: { tone: 'down' }, text: '倒地' }) : null,
        idle ? h('span', { class: 'mate__tag', dataset: { tone: 'idle' }, title: '戰鬥中，資源幾乎沒動用', text: '🔔 資源很滿' }) : null,
        h('span', { class: 'mate__use', title: '各項資源與毒性平均用掉的比例', text: `動用 ${pct(use)}` })),
      h('div', { class: 'mate__hpline' },
        h('span', { class: 'mate__bar' }, h('span', { class: 'mate__fill', style: `width:${hpPct(v) * 100}%` })),
        h('span', { class: 'mate__hp num', text: `${fmt(v.hp)}/${fmt(v.maxHp)}${v.shield ? ` 🛡${fmt(v.shield)}` : ''}` }))),
    h('div', { class: 'mate__bars' }, barsOf(v).map(resPill)));
}

/** 折疊時的摘要列：標題＋幾個狀態小標籤 */
function renderSummary(summary, d, count) {
  summary.replaceChildren(...[
    h('strong', { class: 'sx-party__title', text: `隊友 ${count}` }),
    count ? h('span', { class: 'sx-chip', dataset: { tone: d.minPct < 30 ? 'bad' : d.minPct < 60 ? 'warn' : 'ok' }, text: `最低生命 ${d.minPct}%` }) : null,
    d.downed ? h('span', { class: 'sx-chip', dataset: { tone: 'bad' }, text: `${d.downed} 人倒地` }) : null,
    d.idle.length ? h('span', { class: 'sx-chip', dataset: { tone: 'idle' }, text: `🔔 ${d.idle.join('、')}` }) : null,
  ].filter(Boolean));
}

/** 回傳 { node, render }：node 放進版面，房間狀態變了就呼叫 render()（只重畫內容，折疊狀態不變） */
export function createPartyPanel() {
  const summary = h('summary', { class: 'sx-party__sum' });
  const body = h('div', { class: 'sx-party__body' });
  const node = h('details', { class: 'sx-party', open: true, hidden: true }, summary, body);

  function render() {
    const r = getRoomStatus();
    const gm = new Set(r.gm?.uids ?? []);
    if (r.phase !== 'online' || r.me?.isGm) { node.hidden = true; return; }
    node.hidden = false;
    const onlineIds = new Set(r.members.filter((m) => m.online).map((m) => m.uid));
    const mates = Object.entries(r.vitals ?? {}).filter(([uid]) => uid !== r.me?.uid && !gm.has(uid));
    const inBattle = Boolean(getEncounter()?.monsters?.some((m) => m.hp > 0));
    const d = partyDigest(mates.map(([, v]) => v), { inBattle });
    node.dataset.level = d.level;
    renderSummary(summary, d, mates.length);
    body.replaceChildren(mates.length
      ? h('ul', { class: 'party__list' }, mates.map(([uid, v]) => mateCard(v, { online: onlineIds.has(uid), inBattle })))
      : h('p', { class: 'hint', text: '隊友上線並操作過角色後，這裡會顯示他們的生命與資源。每一條都是「還剩多少」，空了＝用光。' }));
  }

  return { node, render };
}
