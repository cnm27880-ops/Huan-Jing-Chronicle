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

export function mateCard(v, { online = true, inBattle = false } = {}) {
  const use = usageOf(v);
  const idle = inBattle && !v.downed && use < NUDGE.idleUsage;
  return h('li', { class: `mate${v.downed ? ' is-downed' : ''}`, dataset: { online: online ? '1' : '0' } },
    h('div', { class: 'mate__head' },
      h('span', { class: 'mate__name', text: v.name }),
      v.downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒地' }) : null,
      idle ? h('span', { class: 'mate__idle', title: '戰鬥中，資源幾乎沒動用', text: '🔔 還很滿' }) : null,
      h('span', { class: 'mate__use num', title: '各項資源與毒性平均用掉的比例', text: `已動用 ${pct(use)}` })),
    h('span', { class: 'mate__bar', role: 'img', 'aria-label': `生命 ${v.hp} / ${v.maxHp}` }, h('span', { class: 'mate__fill', style: `width:${hpPct(v) * 100}%` })),
    h('span', { class: 'mate__hp num', text: `生命 ${fmt(v.hp)} / ${fmt(v.maxHp)}${v.shield ? `　🛡${fmt(v.shield)}` : ''}` }),
    h('div', { class: 'mate__bars' }, barsOf(v).map((b) => h('span', { class: 'rbar', dataset: { res: b.key }, title: b.text, role: 'img', 'aria-label': b.text },
      h('b', { class: 'rbar__label', text: b.label }),
      h('span', { class: 'rbar__track' }, h('span', { class: 'rbar__fill', style: `width:${b.left * 100}%` }))))));
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
    summary.textContent = mates.length
      ? `隊友 ${d.count} 人・最低生命 ${d.minPct}%${d.downed ? `・${d.downed} 人倒地` : ''}${d.idle.length ? `・🔔 ${d.idle.join('、')} 資源還很滿` : ''}`
      : '隊友';
    body.replaceChildren(mates.length
      ? h('ul', { class: 'party__list' }, mates.map(([uid, v]) => mateCard(v, { online: onlineIds.has(uid), inBattle })))
      : h('p', { class: 'hint', text: '隊友上線並操作過角色後，這裡會顯示他們的生命與資源。每一條都是「還剩多少」，空了＝用光。' }));
  }

  return { node, render };
}
