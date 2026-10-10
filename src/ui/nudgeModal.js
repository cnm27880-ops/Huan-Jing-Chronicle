// ============================================================
// 戰鬥提醒（玩家端，GM 不顯示）：戰鬥中「出事了」才跳出，擋住畫面、必須按「我知道了」才能關（背景與 Esc 都不能關）。
// 事件：隊友倒地、隊友生命危急、全隊吃緊（判斷在 src/game/nudge.js）。內容是你手上實際能做的事：
// 直接餵藥的按鈕、還很滿的資源與可用的藥水，不是通用的叮嚀。同一個人同一種提醒隔 15 秒才會再跳，救回來後再出事才會再提醒。
// 文字一律走 textContent。
// ============================================================
import { h, fmt } from './dom.js';
import { toast } from './controls.js';
import * as defaultRoom from '../state/rollLog.js';
import { takeItems, refundItems } from '../game/mail.js';
import { detectEvents, createNudgeGate, canFeed, myOptions } from '../game/nudge.js';
import { resPill } from './partyBars.js';

const LOCK_MS = 1000; // 「我知道了」要等一下才能按（不是故意刁難：避免連點把提醒直接關掉）
const pctOf = (v) => (v.maxHp > 0 ? Math.round((v.hp / v.maxHp) * 100) : 0);

/** room：房間介面（預設是 rollLog.js；測試與預覽時可以換成假的）。回傳 { show }：直接跳出提醒（預覽用） */
export function mountNudges({ getState, commit, room = defaultRoom }) {
  const { getRoomStatus, subscribeRoom, getEncounter, sendMail } = room;
  const gate = createNudgeGate();
  let prev = null;
  let vitals = {};
  let modal = null; // { events, node, backdrop, fed: Set }

  const snapshot = (r) => {
    const gm = new Set(r.gm?.uids ?? []);
    return Object.fromEntries(Object.entries(r.vitals ?? {}).filter(([uid]) => !gm.has(uid)));
  };

  /** 要救誰：倒地／危急的那位；全隊吃緊就救最危險的那位隊友（不含自己） */
  function targetOf(ev) {
    if (ev.uid) return ev.uid;
    const me = getRoomStatus().me?.uid;
    return (ev.uids ?? []).filter((u) => u !== me && vitals[u]).sort((a, b) => pctOf(vitals[a]) - pctOf(vitals[b]))[0] ?? null;
  }

  async function feed(uid, potion, btn) {
    const state = getState();
    if (!takeItems(state, { [potion]: 1 })) return toast(`背包裡沒有${potion}。`);
    commit();
    btn.disabled = true;
    try {
      const res = await sendMail({ to: uid, kind: 'potion', potion });
      toast(`已餵出${potion}（回復 ${res.heal}），紀錄會顯示在戰鬥紀錄裡。`);
      modal?.fed.add(`${uid}:${potion}`);
    } catch (e) {
      refundItems(state, { [potion]: 1 });
      commit();
      toast(`沒有餵出去：${e.message}`);
    }
    draw();
  }

  /** 事件的圖示、標題、副標（目前的生命與毒性） */
  function metaOf(ev) {
    const uid = ev.uid ?? targetOf(ev);
    const v = uid ? vitals[uid] : null;
    const sub = v ? `生命 ${fmt(v.hp)}/${fmt(v.maxHp)}${typeof v.tox === 'number' ? `・毒性 ${v.tox}/15` : ''}` : '';
    if (ev.kind === 'downed') return { icon: '✚', title: `${ev.name} 倒地了`, sub, v };
    if (ev.kind === 'danger') return { icon: '!', title: `${ev.name} 生命危急`, sub, v };
    return { icon: '≋', title: '全隊吃緊', sub: `${(ev.uids ?? []).map((u) => vitals[u]?.name).filter(Boolean).join('、')} 都有麻煩`, v: null };
  }

  /** 一個事件的卡片；同一位隊友只在第一個事件出現餵藥選項（covered），喝得下的藥水最多列 3 瓶，全都喝不下就改成一句話 */
  function eventBlock(ev, opts, covered) {
    const uid = targetOf(ev);
    const mate = uid ? vitals[uid] : null;
    const meta = metaOf(ev);
    const rows = [];
    if (mate && !covered.has(uid)) {
      covered.add(uid);
      const fit = opts.heals.filter((p) => canFeed(mate, p.name) || modal.fed.has(`${uid}:${p.name}`)).slice(0, 3);
      if (fit.length) {
        rows.push(h('div', { class: 'nudge__acts' }, fit.map((p) => {
          const done = modal.fed.has(`${uid}:${p.name}`);
          return h('button', { type: 'button', class: 'nudge__potion', disabled: done ? true : null, onclick: (e) => feed(uid, p.name, e.currentTarget) },
            h('span', { class: 'nudge__pname', text: p.name }),
            h('span', { class: 'nudge__pdesc', text: `約回復 ${fmt(Math.round(p.avg))}・剩 ${fmt(p.qty)}` }),
            h('span', { class: 'nudge__pgo', text: done ? '✓ 已餵' : `餵給 ${mate.name}` }));
        })));
      } else if (opts.heals.length) {
        rows.push(h('p', { class: 'nudge__none', text: `${mate.name} 的毒性已滿，喝不下藥水。` }));
      }
    }
    const pct = meta.v && meta.v.maxHp > 0 ? Math.max(0, Math.min(100, (meta.v.hp / meta.v.maxHp) * 100)) : null;
    return h('section', { class: 'nudge__ev', dataset: { kind: ev.kind } },
      h('div', { class: 'nudge__evhead' },
        h('span', { class: 'nudge__evicon', 'aria-hidden': 'true', text: meta.icon }),
        h('div', { class: 'nudge__evtext' }, h('strong', { class: 'nudge__evtitle', text: meta.title }), meta.sub ? h('small', { class: 'nudge__evsub', text: meta.sub }) : null)),
      pct == null ? null : h('span', { class: 'nudge__hp' }, h('span', { class: 'nudge__hpfill', style: `width:${pct}%` })),
      rows);
  }

  function draw() {
    if (!modal) return;
    const state = getState();
    const opts = myOptions(state);
    const tips = [];
    if (opts.fresh.length) tips.push('招式與鬥氣加骰都會用到這些資源。');
    if (opts.buffs.length) tips.push(`攻擊／防禦藥水：${opts.buffs.map((b) => `${b.name}×${fmt(b.qty)}`).join('、')}。`);
    if (!opts.heals.length) tips.push('你手上沒有可以餵的回復藥水。');
    const onSession = location.hash === '#session';
    const dismiss = modal.dismiss;
    const covered = new Set();
    modal.panel.replaceChildren(...[ // replaceChildren 不收陣列也不收 null，先攤平
      h('header', { class: 'nudge__head' },
        h('span', { class: 'nudge__icon', 'aria-hidden': 'true', text: '!' }),
        h('div', {}, h('h2', { class: 'nudge__title', text: '隊友需要幫忙' }), h('p', { class: 'nudge__sub', text: '戰鬥中的狀況，以下是你現在可以做的事。' }))),
      h('div', { class: 'nudge__evs' }, modal.events.map((ev) => eventBlock(ev, opts, covered))),
      h('section', { class: 'nudge__you' },
        h('h3', { class: 'nudge__you-title', text: '你還有這些資源可以用' }),
        opts.fresh.length ? h('div', { class: 'mate__bars' }, opts.fresh.map((r) => resPill({ key: r.key, now: r.now, max: r.max, left: r.now / r.max, text: `${r.key} ${r.now} / ${r.max}` }))) : h('p', { class: 'nudge__none', text: '你的資源已經用掉大半。' }),
        tips.length ? h('ul', { class: 'nudge__tips' }, tips.map((t) => h('li', { text: t }))) : null),
      h('div', { class: 'nudge__foot' },
        onSession ? null : h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { dismiss(); location.hash = '#session'; } }, '到跑團頁'),
        dismiss.btn)].flat());
  }

  function show(events) {
    if (modal) { // 已經開著：把新事件加進去（同一種事件不重複）
      for (const ev of events) if (!modal.events.some((x) => x.kind === ev.kind && x.uid === ev.uid)) modal.events.push(ev);
      draw();
      return;
    }
    const panel = h('div', { class: 'nudge__panel', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': '隊友需要幫忙' });
    const backdrop = h('div', { class: 'nudge', 'aria-hidden': 'false' }, panel);
    const btn = h('button', { type: 'button', class: 'btn btn--primary', disabled: true }, '我知道了');
    const dismiss = () => { backdrop.remove(); modal = null; };
    dismiss.btn = btn;
    btn.addEventListener('click', dismiss);
    modal = { events: [...events], panel, node: backdrop, fed: new Set(), dismiss };
    document.body.append(backdrop);
    draw();
    setTimeout(() => { btn.disabled = false; }, LOCK_MS);
    // 擋住 Esc 讓底下的面板也不會被關掉；提醒本身只能按「我知道了」
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } });
    (panel.querySelector('.nudge__potion:not(:disabled)') ?? btn).focus({ preventScroll: true });
  }

  subscribeRoom(() => {
    const r = getRoomStatus();
    if (r.phase !== 'online' || r.me?.isGm || !r.me?.uid) { prev = null; return; }
    const next = snapshot(r);
    const before = prev;
    prev = next;
    vitals = next;
    if (modal) draw(); // 對方被救起來、毒性變了：按鈕跟著更新
    const inBattle = Boolean(getEncounter()?.monsters?.some((m) => m.hp > 0));
    gate.recovered(next);
    if (!inBattle) return;
    const events = detectEvents(before, next, { me: r.me.uid }).filter((ev) => gate.allow(ev, next, Date.now()));
    if (events.length) show(events);
  });
  return { show: (events, v) => { vitals = v; show(events); } };
}
