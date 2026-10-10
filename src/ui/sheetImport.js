// ============================================================
// GM 專用：匯入試算表角色卡（已學會的技能與等級、生活技能、技藝、胃袋、目前生命與資源）。
// GM 把玩家的試算表另存副本 → 「角色永久狀態」分頁全選複製 → 貼上這裡。
// 讀取與轉換都在瀏覽器裡，轉好的角色才送到伺服器；規則見 src/game/importSheet.js。
// ============================================================
import { askConfirm } from './confirmPop.js';
import { h, fmt } from './dom.js';
import { openSheet } from './sheet.js';
import { parseSheet, convertSheet } from '../game/importSheet.js';
import { fetchCharacter } from '../state/charSync.js';
import { roomRequest, getRoomStatus } from '../state/rollLog.js';
import { RESOURCE_STATS } from '../game/rules.js';

const STAT_ORDER = ['真實傷害', '物理傷害', '能量傷害', '靈魂傷害', '絕對防禦', '體魄強韌', '抗性免疫', '精神意志', ...RESOURCE_STATS];

export function openSheetImportSheet() {
  const ui = { text: '', uid: '', customUid: '', parsed: null, activated: new Set(), replace: false, existing: null, busy: false, message: '', done: '' };
  let sheet;
  const targetUid = () => (ui.customUid.trim() || ui.uid);

  async function analyse() {
    ui.done = ''; ui.message = ''; ui.existing = null;
    ui.parsed = parseSheet(ui.text);
    ui.activated = new Set();
    if (ui.parsed.error) { ui.message = ui.parsed.error; ui.parsed = null; }
    sheet.refresh();
  }

  async function write() {
    const uid = targetUid();
    if (!/^\d{5,25}$/.test(uid)) { ui.message = '請選一位玩家，或輸入正確的 Discord ID（純數字）。'; return sheet.refresh(); }
    ui.busy = true; ui.message = ''; sheet.refresh();
    try {
      const cur = await fetchCharacter(uid); // 伺服器上已有角色就合併（保留背包、裝備、金幣）
      const { data, report, error } = convertSheet(ui.parsed, ui.replace ? null : cur.data, { activated: ui.activated }); // 取代＝不合併，伺服器現有存檔整份丟掉
      if (error) throw new Error(error);
      const res = await roomRequest({ t: 'charImport', uid, base: cur.version, data });
      ui.done = res.ok
        ? `已寫入伺服器（第 ${res.version} 版）：${report.name}，學會 ${report.learned} 個技能。玩家下次載入網站時會被詢問要不要使用伺服器的存檔，選「確定」即可。`
        : '失敗：對方剛剛存檔了，請再按一次「寫入」。';
      if (res.ok) ui.parsed = null;
    } catch (e) { ui.message = `失敗：${e.message}`; }
    ui.busy = false;
    sheet.refresh();
  }

  function preview() {
    const { report } = convertSheet(ui.parsed, null, { activated: ui.activated });
    const adj = report.adjust;
    return h('div', { class: 'import-preview' },
      h('p', {}, h('strong', { text: report.name }), `　學會 ${fmt(report.learned)} 個技能`),
      report.dropped.length ? h('p', { class: 'hint', text: `技能目錄沒有，會直接丟掉（${report.dropped.length}）：${report.dropped.join('、')}` }) : null,
      report.zero.length ? h('p', { class: 'hint', text: `等級空白，記為 0 級（${report.zero.length}）：${report.zero.join('、')}` }) : null,
      report.activation.length
        ? h('div', {},
            h('p', { class: 'field-label', text: '武裝類技能：試算表上已經「啟動」的請打勾（面板數值已含它們；沒勾＝網站預設未啟動）' }),
            report.activation.map((n) => h('label', { class: 'check' },
              h('input', {
                type: 'checkbox', checked: ui.activated.has(n) ? true : null,
                onchange: (e) => { if (e.target.checked) ui.activated.add(n); else ui.activated.delete(n); sheet.refresh(); },
              }), h('span', { text: n }))))
        : null,
      h('p', { class: 'field-label', text: '手動調整（試算表面板 − 網站用技能、裝備、食物算出的值；包含自由分配、愚者對調、尚未搬到網站的裝備）' }),
      h('ul', { class: 'import-adjust' }, STAT_ORDER.filter((s) => adj[s]).map((s) => h('li', { dataset: { neg: adj[s] < 0 ? '1' : '0' }, text: `${s} ${adj[s] > 0 ? '+' : ''}${fmt(adj[s])}` }))),
      report.negative.length ? h('p', { class: 'notice notice--bad', text: `負的調整（${report.negative.join('、')}）：網站算出來比試算表面板還高。常見原因是玩家改過公式、試算表漏算了某些技能，請 GM 確認後再寫入。` }) : null,
      report.fractional.length ? h('p', { class: 'hint', text: `${report.fractional.join('、')} 在試算表上是小數（玩家改掉了進位公式），已依 GM 的規則進位。` }) : null,
      report.missing.length ? h('p', { class: 'notice notice--bad', text: `讀不到：${report.missing.join('、')}` }) : null);
  }

  const members = () => getRoomStatus().members ?? [];
  sheet = openSheet('匯入試算表角色卡', () => h('div', {},
    h('p', { class: 'hint', text: '1. 把玩家的試算表另存副本。2. 在「角色永久狀態」分頁按 Ctrl+A 全選、Ctrl+C 複製（小黑那種版本請用「角色最終狀態」分頁）。3. 貼到下面。已有角色的玩家會合併：保留背包、裝備、金幣，技能與手動調整以這張角色卡為準。' }),
    h('label', { class: 'field-label', for: 'sheet-target', text: '寫給哪位玩家' }),
    h('select', { id: 'sheet-target', class: 'field', onchange: (e) => { ui.uid = e.target.value; } },
      h('option', { value: '', text: '選擇玩家…' }),
      members().map((m) => h('option', { value: m.uid, selected: ui.uid === m.uid ? true : null, text: m.name }))),
    h('input', { class: 'field', type: 'text', inputmode: 'numeric', placeholder: '或輸入 Discord ID（還沒登入過網站的玩家）', value: ui.customUid, oninput: (e) => { ui.customUid = e.target.value; } }),
    h('textarea', { class: 'field import-text', rows: 6, placeholder: '貼上角色卡文字…', oninput: (e) => { ui.text = e.target.value; } }, ui.text),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: ui.replace ? true : null, onchange: (e) => { ui.replace = e.target.checked; } }),
      h('span', { text: '取代現有存檔（不合併）：伺服器上的角色整份丟掉重建，背包、裝備、金幣也會清空。角色被弄錯（例如變成別人的角色）時才勾。' })),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', disabled: ui.busy ? true : null, onclick: analyse }, '解析'),
      ui.parsed ? h('button', { type: 'button', class: 'btn btn--primary', disabled: ui.busy ? true : null, onclick: async (e) => { if (await askConfirm(e.currentTarget, ui.replace ? { title: '取代伺服器上的角色？', lines: ['現有存檔（含背包、裝備、金幣）會整份丟掉。'], okText: '取代', danger: true } : { title: '寫入伺服器？', lines: ['已有角色的玩家會被合併。'], okText: '寫入' })) write(); } }, ui.busy ? '寫入中…' : '寫入伺服器') : null),
    ui.message ? h('p', { class: 'notice notice--bad', text: ui.message }) : null,
    ui.done ? h('p', { class: 'notice', text: ui.done }) : null,
    ui.parsed ? preview() : null));
}
