// 骰盤裡的「房間」區塊：連線狀態、GM、成員、GM 才有的「新戰鬥」、開發者才有的「暫代 GM」。
// 本機模式（沒登入）時整塊不顯示。文字一律走 textContent。
import { h } from './dom.js';
import { openBotImportSheet } from './botImport.js';
import { openSheetImportSheet } from './sheetImport.js';
import { openGmCharEditor } from './gmCharEdit.js';
import { getRoomStatus, subscribeRoom, startNewBattle, setGmOverride } from '../state/rollLog.js';

export function mountRoomPanel(container) {
  const draw = () => {
    const r = getRoomStatus();
    container.replaceChildren();
    if (r.phase === 'local') return;

    const online = r.members.filter((m) => m.online).length;
    const text = {
      connecting: '連線房間中…',
      online: `已加入房間・${online} / ${r.members.length} 人在線`,
      reconnecting: '連線中斷，重新連線中…（暫時使用本機骰盤，結果不會同步給大家）',
      denied: r.message,
    }[r.phase];
    const parts = [h('div', { class: 'room__status' }, h('span', { class: 'room__dot', 'aria-hidden': 'true' }), h('span', { text }))];

    if (r.phase === 'online') {
      const nameOf = (uid) => r.gm.names[uid] ?? r.members.find((m) => m.uid === uid)?.name ?? '（尚未加入）';
      const gmText = r.gm.uids.length ? r.gm.uids.map(nameOf).join('、') : '尚未設定';
      parts.push(
        h('p', { class: 'room__gm' }, `GM：${gmText}`, r.gm.override ? h('span', { class: 'badge', dataset: { tone: 'warn' }, text: '暫代中（測試用）' }) : null),
        r.members.length
          ? h('ul', { class: 'room__members' }, r.members.map((m) => h('li', { class: 'room__member', dataset: { online: m.online ? '1' : '0' }, text: m.name })))
          : null,
        r.battleNo ? h('p', { class: 'hint', text: `目前是第 ${r.battleNo} 場戰鬥` }) : null);
      const btns = [];
      if (r.me?.isGm) {
        btns.push(h('button', {
          type: 'button', class: 'btn btn--small',
          onclick: () => { if (confirm('開始新的一場戰鬥？紀錄裡會插入一條分隔線（不會改動任何角色資料）。')) startNewBattle(); },
        }, '🆕 新戰鬥'));
        btns.push(h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: openBotImportSheet }, '匯入機器人存檔'));
        btns.push(h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: openSheetImportSheet }, '匯入角色卡'));
        btns.push(h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: openGmCharEditor }, '玩家角色'));
      }
      if (r.me?.isAdmin) {
        btns.push(r.gm.override
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => setGmOverride('release') }, '還給原 GM')
          : h('button', {
              type: 'button', class: 'btn btn--ghost btn--small',
              onclick: () => { if (confirm('暫代 GM？原本的 GM 在你還回去之前沒有 GM 權限，所有人都會看到。')) setGmOverride('take'); },
            }, '暫代 GM（測試用）'));
      }
      if (btns.length) parts.push(h('div', { class: 'row room__btns' }, btns));
    }
    if (r.notice) parts.push(h('p', { class: 'notice notice--bad', text: r.notice }));
    container.append(h('section', { class: 'room', dataset: { phase: r.phase } }, parts));
  };
  draw();
  return { destroy: subscribeRoom(draw) };
}
