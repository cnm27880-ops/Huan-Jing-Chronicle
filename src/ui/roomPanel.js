// 骰盤裡的「房間」區塊：連線狀態、GM、成員、GM 才有的「新戰鬥」、開發者才有的「暫代 GM」。
// 本機模式（沒登入）時整塊不顯示。文字一律走 textContent。
import { askConfirm } from './confirmPop.js';
import { h } from './dom.js';
import { toast } from './controls.js';
import { loadModule, chunkErrorText } from './lazyLoad.js';
import { getRoomStatus, subscribeRoom, startNewBattle, setGmOverride } from '../state/rollLog.js';

/**
 * GM 工具面板：點了才下載（一般玩家永遠用不到，不放進首屏）。
 * importer 要寫成 () => import('./x.js')（路徑寫死，Vite 才會把它分成獨立的檔案）；openName 是那個檔案匯出的開啟函式。
 */
const lazyTool = (importer, openName, label) => async () => {
  let mod;
  try { mod = await loadModule(importer); } catch { toast(`${label}：${chunkErrorText(navigator.onLine !== false)}`); return; }
  mod[openName]();
};

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
    // 連上之後標題列（「房間・N / M 人在線」）已經有狀態，內文只留 GM 與成員；其他狀態才顯示一行說明
    const parts = r.phase === 'online' ? [] : [h('div', { class: 'room__status' }, h('span', { class: 'room__dot', 'aria-hidden': 'true' }), h('span', { text }))];

    if (r.phase === 'online') {
      const nameOf = (uid) => r.gm.names[uid] ?? r.members.find((m) => m.uid === uid)?.name ?? '（尚未加入）';
      const gmText = r.gm.uids.length ? r.gm.uids.map(nameOf).join('、') : '未設定';
      parts.push(
        h('div', { class: 'room__line' },
          h('span', { class: 'room__gm', title: r.battleNo ? `目前是第 ${r.battleNo} 場戰鬥` : '' }, `GM ${gmText}`, r.gm.override ? h('span', { class: 'badge', dataset: { tone: 'warn' }, text: '暫代' }) : null),
          r.members.length
            ? h('ul', { class: 'room__members' }, r.members.map((m) => h('li', { class: 'room__member', dataset: { online: m.online ? '1' : '0' }, text: m.name })))
            : null));
      // GM 工具：不分類，三個一排（排版在 session.css 的 .room__tools）
      const gmBtn = (text, onclick, main) => h('button', { type: 'button', class: `btn btn--small${main ? '' : ' btn--ghost'}`, onclick }, text);
      if (r.me?.isGm) {
        parts.push(h('div', { class: 'room__tools' },
          gmBtn('新戰鬥', async (e) => { if (await askConfirm(e.currentTarget, { title: '開始新的一場戰鬥？', lines: ['紀錄裡會插入一條分隔線（不會改動任何角色資料）。'], okText: '開始' })) startNewBattle(); }, true),
          gmBtn('發放獎勵', lazyTool(() => import('./rewardSheet.js'), 'openRewardSheet', '發放獎勵'), true),
          gmBtn('模擬戰', lazyTool(() => import('./simPanel.js'), 'openSimPanel', '模擬戰')),
          gmBtn('玩家角色', lazyTool(() => import('./gmCharEdit.js'), 'openGmCharEditor', '玩家角色')),
          gmBtn('匯入機器人存檔', lazyTool(() => import('./botImport.js'), 'openBotImportSheet', '匯入機器人存檔')),
          gmBtn('匯入角色卡', lazyTool(() => import('./sheetImport.js'), 'openSheetImportSheet', '匯入角色卡')),
          gmBtn('從備份還原角色', lazyTool(() => import('./backupRestore.js'), 'openBackupRestoreSheet', '從備份還原角色')),
          gmBtn('特殊配方與材料', lazyTool(() => import('./specialEdit.js'), 'openSpecialEditor', '特殊配方與材料')),
          gmBtn('專屬技能', lazyTool(() => import('./skillEdit.js'), 'openSkillEditor', '專屬技能'))));
      }
      const btns = [];
      if (r.me?.isAdmin) {
        btns.push(r.gm.override
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => setGmOverride('release') }, '還給原 GM')
          : h('button', {
              type: 'button', class: 'btn btn--ghost btn--small',
              onclick: async (e) => { if (await askConfirm(e.currentTarget, { title: '暫代 GM？', lines: ['原本的 GM 在你還回去之前沒有 GM 權限，所有人都會看到。'], okText: '暫代' })) setGmOverride('take'); },
            }, '暫代 GM'));
      }
      if (btns.length) parts.push(h('div', { class: 'row room__btns' }, btns));
    }
    if (r.notice) parts.push(h('p', { class: 'notice notice--bad', text: r.notice }));
    container.append(h('section', { class: 'room', dataset: { phase: r.phase } }, parts));
  };
  draw();
  return { destroy: subscribeRoom(draw) };
}
