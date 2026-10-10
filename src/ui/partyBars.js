// ============================================================
// 隊友資源條（跑團頁右欄、房間上方）：每位隊友的生命、各資源「還剩多少」、毒性（還能喝多少藥）與「已動用 %」。
// 折疊時只看摘要（有人倒地會變紅），所以不用展開也知道隊伍狀況。戰鬥中資源還很滿的人會被標 🔔。
// GM 不顯示（使用者 2026-10-10：GM 不會特意去注意）。資料是房間廣播的 vitals（src/state/vitals.js），判斷在 src/game/nudge.js。
// ============================================================
import { h, fmt } from './dom.js';
import * as defaultRoom from '../state/rollLog.js';
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

const OPEN_KEY = 'huanjing:party:open:v1';
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } };
const saveOpen = (v) => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* 存不了就算了，下次照預設 */ } };

/** 精簡列上的小頭像：環＝生命，收起來也看得到每位隊友的狀況；有 🔔 表示戰鬥中資源還很滿 */
function partyDot(v, { idle = false } = {}) {
  return h('span', { class: 'pdot', dataset: { state: hpState(v) }, style: `--hp:${Math.round(hpPct(v) * 100)}`, role: 'img',
    title: `${v.name}　生命 ${v.hp}/${v.maxHp}　動用 ${pct(usageOf(v))}${idle ? '　🔔 資源還很滿' : ''}`, 'aria-label': `${v.name} 生命 ${v.hp} / ${v.maxHp}` },
  h('span', { class: 'pdot__initial', text: [...(v.name || '?')][0] }),
  idle ? h('span', { class: 'pdot__bell', 'aria-hidden': 'true', text: '🔔' }) : null);
}

/**
 * 回傳 { node, render }：懸浮面板——常駐一條精簡列（每位隊友一個生命環），展開時浮在紀錄上方、不擠佔版面。
 * 單擊精簡列展開／收合；展開後在面板上雙擊也能收合；有人倒地或生命危急時會自動展開（只展開、不改記住的偏好），
 * 所以就算玩家收起來，出事時還是看得到。收合偏好記在這台裝置（localStorage）。
 */
export function createPartyPanel({ room = defaultRoom } = {}) {
  const { getRoomStatus, getEncounter } = room;
  const label = h('span', { class: 'sx-party__label' });
  const dots = h('span', { class: 'sx-party__dots' });
  const chips = h('span', { class: 'sx-party__chips' });
  const chevron = h('span', { class: 'sx-party__chev', 'aria-hidden': 'true', text: '▾' });
  const bar = h('button', { type: 'button', class: 'sx-party__bar', 'aria-expanded': 'true', title: '單擊展開／收合隊友資源' }, label, dots, chips, chevron);
  const pop = h('div', { class: 'sx-party__pop', title: '雙擊收合' });
  const node = h('div', { class: 'sx-party', hidden: true }, bar, pop);
  let open = readOpen();
  let lastDowned = 0;
  let lastDanger = false;

  const apply = () => {
    pop.hidden = !open;
    bar.setAttribute('aria-expanded', String(open));
    chevron.textContent = open ? '▴' : '▾';
    node.dataset.open = open ? '1' : '0';
  };
  const toggle = () => { open = !open; saveOpen(open); apply(); };
  bar.addEventListener('click', toggle);
  pop.addEventListener('dblclick', () => { open = false; saveOpen(false); apply(); });

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
    label.textContent = `隊友 ${mates.length}`;
    dots.replaceChildren(...mates.map(([, v]) => partyDot(v, { idle: inBattle && !v.downed && usageOf(v) < NUDGE.idleUsage })));
    chips.replaceChildren(...[
      d.downed ? h('span', { class: 'sx-chip', dataset: { tone: 'bad' }, text: `${d.downed} 倒地` }) : null,
      !d.downed && mates.length && d.minPct < 30 ? h('span', { class: 'sx-chip', dataset: { tone: 'bad' }, text: `最低 ${d.minPct}%` }) : null,
    ].filter(Boolean));
    pop.replaceChildren(mates.length
      ? h('ul', { class: 'party__list' }, mates.map(([uid, v]) => mateCard(v, { online: onlineIds.has(uid), inBattle })))
      : h('p', { class: 'hint', text: '隊友上線並操作過角色後，這裡會顯示他們的生命與資源。每一個膠囊都填到「還剩多少」，空了＝用光。' }));
    // 出事了就自動展開（有人新倒地、或有人生命危急）；已經展開的不動，收起來的偏好也不會被改掉
    const danger = mates.some(([, v]) => !v.downed && v.maxHp > 0 && v.hp / v.maxHp < NUDGE.danger);
    if (!open && (d.downed > lastDowned || (danger && !lastDanger))) open = true;
    lastDowned = d.downed;
    lastDanger = danger;
    apply();
  }

  apply();
  return { node, render };
}
