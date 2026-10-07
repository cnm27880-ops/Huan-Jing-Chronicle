// ============================================================
// GM 專用：匯入舊 Discord 機器人的存檔（players_data.json）。
// 檔案只在這個瀏覽器裡讀取與轉換，轉好的角色才送到伺服器；原始檔不會上傳，也不能放進 git。
// 轉換規則見 src/game/importBot.js（只填機器人有的欄位；技能與基礎數值要另外補）。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet } from './sheet.js';
import { convertBotPlayer } from '../game/importBot.js';
import { listCharacters, fetchCharacter } from '../state/charSync.js';
import { roomRequest, getRoomStatus } from '../state/rollLog.js';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const GAP_MS = 250; // 伺服器每人每秒最多 6 則訊息，匯入時放慢一點

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function openBotImportSheet() {
  const ui = { rows: null, existing: {}, picked: new Set(), merge: new Set(), message: '', results: [], busy: false };
  let sheet;

  async function loadFile(file) {
    ui.rows = null; ui.results = []; ui.message = '';
    if (!file) return sheet.refresh();
    if (file.size > MAX_FILE_BYTES) { ui.message = '檔案太大（超過 40MB），不是正確的存檔。'; return sheet.refresh(); }
    let json;
    try { json = JSON.parse(await file.text()); } catch { ui.message = '讀不懂這個檔案，請選機器人的 players_data.json。'; return sheet.refresh(); }
    if (!json || typeof json !== 'object' || Array.isArray(json)) { ui.message = '格式不對，應該是「Discord ID → 玩家資料」。'; return sheet.refresh(); }
    try {
      const list = await listCharacters();
      ui.existing = Object.fromEntries(list.map((c) => [c.uid, c]));
    } catch (e) { ui.message = `無法向伺服器查詢現有角色：${e.message}`; return sheet.refresh(); }
    const names = Object.fromEntries(getRoomStatus().members.map((m) => [m.uid, m.name]));
    ui.rows = Object.entries(json).map(([uid, bot]) => ({ uid, bot, who: names[uid] ?? null, conv: convertBotPlayer(bot) }));
    ui.picked = new Set(ui.rows.filter((r) => !r.conv.error && !ui.existing[r.uid]).map((r) => r.uid)); // 預設只選「伺服器還沒有角色」的人
    ui.merge = new Set();
    sheet.refresh();
  }

  async function run() {
    ui.busy = true; ui.results = []; sheet.refresh();
    for (const row of ui.rows.filter((r) => ui.picked.has(r.uid))) {
      const label = `${row.conv.summary?.name ?? row.uid}`;
      try {
        let base = null; let version = 0;
        if (ui.existing[row.uid]) {
          const cur = await fetchCharacter(row.uid);
          if (!ui.merge.has(row.uid)) { ui.results.push(`${label}：略過（伺服器已有存檔，且沒有勾選合併）`); continue; }
          base = cur.data; version = cur.version;
        }
        const { data, error } = convertBotPlayer(row.bot, base);
        if (error) { ui.results.push(`${label}：失敗（${error}）`); continue; }
        const res = await roomRequest({ t: 'charImport', uid: row.uid, base: version, data });
        ui.results.push(res.ok ? `${label}：已匯入（伺服器第 ${res.version} 版）` : `${label}：失敗（對方剛剛存檔了，請重新選檔再試）`);
      } catch (e) { ui.results.push(`${label}：失敗（${e.message}）`); }
      await wait(GAP_MS);
    }
    ui.busy = false;
    ui.results.push('完成。玩家下次載入網站時會看到「使用伺服器的存檔？」的詢問，選「確定」即可。');
    ui.rows = null; // 資料已變動，要再匯入請重新選檔
    sheet.refresh();
  }

  function rowView(r) {
    const s = r.conv.summary;
    const ex = ui.existing[r.uid];
    return h('li', { class: 'import-row' },
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: ui.picked.has(r.uid) ? true : null, disabled: r.conv.error ? true : null,
          onchange: (e) => { if (e.target.checked) ui.picked.add(r.uid); else ui.picked.delete(r.uid); sheet.refresh(); },
        }),
        h('span', {}, h('strong', { text: s?.name ?? '（無法讀取）' }), r.who ? `　Discord：${r.who}` : '　（還沒登入過網站）')),
      r.conv.error
        ? h('p', { class: 'notice notice--bad', text: r.conv.error })
        : h('p', { class: 'hint', text: `第 ${fmt(s.loginDays)} 天・金幣 ${fmt(s.gold)}・經驗 ${fmt(s.exp)}・背包 ${fmt(s.kinds)} 種共 ${fmt(s.items)} 件` }),
      ex && ui.picked.has(r.uid)
        ? h('label', { class: 'check' },
            h('input', {
              type: 'checkbox', checked: ui.merge.has(r.uid) ? true : null,
              onchange: (e) => { if (e.target.checked) ui.merge.add(r.uid); else ui.merge.delete(r.uid); },
            }),
            h('span', { text: `伺服器已有存檔（第 ${ex.version} 版）：勾選＝合併，只覆蓋背包、金幣、經驗、天數、生產次數；技能、數值、裝備、招式保留。不勾＝略過。` }))
        : (!ex && ui.picked.has(r.uid) ? h('p', { class: 'hint', text: '新建角色：技能與基礎數值是空白的（機器人存檔沒有這些），之後要另外補。' }) : null));
  }

  sheet = openSheet('匯入機器人存檔', () => h('div', {},
    h('p', { class: 'hint', text: '選機器人的 players_data.json。檔案只在你的瀏覽器裡讀取，轉好的角色才會送到伺服器，原始檔不會上傳。' }),
    h('input', { type: 'file', accept: '.json,application/json', disabled: ui.busy ? true : null, onchange: (e) => loadFile(e.target.files[0]) }),
    ui.message ? h('p', { class: 'notice notice--bad', text: ui.message }) : null,
    ui.rows ? h('ul', { class: 'import-list' }, ui.rows.map(rowView)) : null,
    ui.rows && ui.rows.length
      ? h('button', {
          type: 'button', class: 'btn btn--primary', disabled: ui.busy || !ui.picked.size ? true : null,
          onclick: () => { if (confirm(`匯入 ${ui.picked.size} 位玩家？這會寫入伺服器。`)) run(); },
        }, ui.busy ? '匯入中…' : `匯入選取的 ${ui.picked.size} 位`)
      : null,
    ui.results.length ? h('ul', { class: 'import-results' }, ui.results.map((t) => h('li', { text: t }))) : null));
}
