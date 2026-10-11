// ============================================================
// GM 專用「發放獎勵」面板（跑團頁的房間區塊）：劇情告一段落時，一次發給全員（或勾選的玩家）技能書、金幣、經驗、時間；
// 也拿來補償（例如玩家忘了喝惜未央，直接補時間）。走信箱（kind: 'reward'）：不在線的上線才收到，收到時右下角跳通知。
// 伺服器：worker/src/room-core.js 的 onReward（只有 GM 能發）；套用：src/game/mail.js 的 applyMail。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { askConfirm } from './confirmPop.js';
import { toast } from './controls.js';
import { KNOWN_ITEMS } from './items.js';
import { getRoomStatus, roomRequest } from '../state/rollLog.js';

const QUICK = ['殘缺技能書', '初階技能書', '進階技能書', '大師技能書']; // 常發的技能書：點一下加進清單
const int = (v) => Math.max(0, Math.floor(Number(v)) || 0);

export function openRewardSheet() {
  const ui = { picked: null, gold: 0, exp: 0, time: 0, note: '', items: [{ name: '', qty: 1 }], busy: false, message: '' };
  let sheet;

  /** 可以發的對象：房間裡的玩家（不含 GM）；角色名有回報過就一起顯示 */
  const players = () => {
    const r = getRoomStatus();
    const gm = new Set(r.gm?.uids ?? []);
    return (r.members ?? []).filter((m) => !gm.has(m.uid))
      .map((m) => ({ uid: m.uid, online: m.online, label: r.vitals?.[m.uid]?.name && r.vitals[m.uid].name !== m.name ? `${r.vitals[m.uid].name}（${m.name}）` : m.name }));
  };

  const cleanItems = () => {
    const out = {};
    for (const it of ui.items) { const n = it.name.trim(); const q = int(it.qty); if (n && q > 0) out[n] = (out[n] ?? 0) + q; }
    return out;
  };
  const summary = (items) => [...Object.entries(items).map(([n, q]) => `${n} ×${fmt(q)}`), ui.gold ? `金幣 ${fmt(ui.gold)}` : '', ui.exp ? `經驗 ${fmt(ui.exp)}` : '', ui.time ? `時間 +${ui.time}` : ''].filter(Boolean);

  async function send(anchor) {
    const items = cleanItems();
    const lines = summary(items);
    const to = [...ui.picked];
    if (!to.length) return toast('請至少勾一位玩家。');
    if (!lines.length) return toast('請至少填一樣獎勵。');
    const names = players().filter((p) => ui.picked.has(p.uid)).map((p) => p.label);
    if (!(await askConfirm(anchor, { title: `發放給 ${to.length} 位玩家？`, lines: [...lines, `對象：${names.join('、')}`, ui.note ? `備註：${ui.note}` : '', '發出後無法收回；不在線的玩家上線才會收到。'].filter(Boolean), okText: '發放' }))) return;
    ui.busy = true; ui.message = ''; sheet.refresh();
    try {
      const res = await roomRequest({ t: 'reward', to, items, gold: ui.gold, exp: ui.exp, time: ui.time, note: ui.note.trim() });
      ui.message = `已發放給 ${res.count} 位玩家。`;
      toast(ui.message);
      Object.assign(ui, { gold: 0, exp: 0, time: 0, note: '', items: [{ name: '', qty: 1 }] });
    } catch (e) { ui.message = `沒有發出：${e.message}`; }
    ui.busy = false;
    sheet.refresh();
  }

  const num = (label, key, hint) => h('label', { class: 'extra' }, h('span', { text: label }),
    h('input', { class: 'field', type: 'number', min: 0, inputmode: 'numeric', value: ui[key], placeholder: '0', 'aria-label': label, title: hint, onchange: (e) => { ui[key] = int(e.target.value); e.target.value = String(ui[key]); } }));

  function body() {
    const list = players();
    if (!list.length) return h('p', { class: 'notice', text: '房間裡還沒有其他玩家（玩家要登入過一次，才能收到獎勵）。' });
    ui.picked ??= new Set(list.map((p) => p.uid)); // 預設全員
    ui.picked = new Set([...ui.picked].filter((u) => list.some((p) => p.uid === u)));
    const all = list.every((p) => ui.picked.has(p.uid));
    const itemRows = ui.items.map((it, i) => h('div', { class: 'trade-want' },
      h('input', { class: 'field', type: 'text', list: 'reward-known-items', placeholder: '物品名稱，例如 大師技能書', value: it.name, 'aria-label': '獎勵物品', oninput: (e) => { it.name = e.target.value; } }),
      h('input', { class: 'field gift-qty', type: 'number', min: 1, inputmode: 'numeric', value: it.qty, 'aria-label': '數量', onchange: (e) => { it.qty = int(e.target.value); } }),
      ui.items.length > 1 ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': '移除這一項', onclick: () => { ui.items.splice(i, 1); sheet.refresh(); } }, '✕') : null));
    const sendBtn = h('button', { type: 'button', class: 'btn btn--primary', disabled: ui.busy ? true : null, onclick: (e) => send(e.currentTarget) }, ui.busy ? '發放中…' : '🎁 發放獎勵');
    return h('div', { class: 'giftsheet' },
      h('p', { class: 'field-label', text: '① 發給誰（預設全員）' }),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: all ? true : null, onchange: (e) => { ui.picked = new Set(e.target.checked ? list.map((p) => p.uid) : []); sheet.refresh(); } }),
        h('span', { text: `全選（${ui.picked.size} / ${list.length}）` })),
      h('div', { class: 'reward-targets' }, list.map((p) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ui.picked.has(p.uid) ? true : null, onchange: (e) => { if (e.target.checked) ui.picked.add(p.uid); else ui.picked.delete(p.uid); sheet.refresh(); } }),
        h('span', { text: `${p.label}${p.online ? '' : '（離線，上線才收到）'}` })))),
      h('p', { class: 'field-label', text: '② 獎勵內容' }),
      h('div', { class: 'stat-grid' }, num('金幣', 'gold'), num('經驗', 'exp'), num('時間', 'time', '直接加時間（例如玩家忘了喝惜未央，補 1～2 時間）；沒有上限')),
      h('div', { class: 'reward-quick' }, QUICK.map((n) => h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { const empty = ui.items.find((x) => !x.name.trim()); if (empty) empty.name = n; else ui.items.push({ name: n, qty: 1 }); sheet.refresh(); } }, `＋ ${n}`))),
      h('div', { class: 'trade-wants' }, itemRows),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { ui.items.push({ name: '', qty: 1 }); sheet.refresh(); } }, '＋ 再加一項物品'),
      h('datalist', { id: 'reward-known-items' }, KNOWN_ITEMS.map((n) => h('option', { value: n }))),
      h('p', { class: 'field-label', text: '③ 備註（玩家收到時會看到，例如「第三章任務獎勵」）' }),
      h('input', { class: 'field', type: 'text', maxlength: 60, value: ui.note, placeholder: '選填', 'aria-label': '備註', oninput: (e) => { ui.note = e.target.value; } }),
      ui.message ? h('p', { class: 'notice', text: ui.message }) : null,
      h('div', { class: 'row' }, sendBtn, h('button', { type: 'button', class: 'btn btn--ghost', onclick: closeSheet }, '關閉')));
  }

  sheet = openSheet('發放獎勵（GM）', body, { tall: true });
}
