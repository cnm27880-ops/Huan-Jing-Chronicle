// ============================================================
// GM 專用：從每日備份（R2 的 YYYY-MM-DD.json.gz）還原玩家角色。
// 檔案只在這個瀏覽器裡解壓與讀取，選好的角色才送到伺服器（走 charImport，會記異動）。
// 備份檔含所有玩家的資料，不能放進 git。
// ============================================================
import { askConfirm } from './confirmPop.js';
import { h } from './dom.js';
import { openSheet } from './sheet.js';
import { listCharacters, fetchCharacter } from '../state/charSync.js';
import { roomRequest, getRoomStatus } from '../state/rollLog.js';

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 備份含立繪的 base64，可能比較大

async function readBackup(file) {
  let text;
  if (/\.gz$/i.test(file.name)) {
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else text = await file.text(); // 已經解壓成 .json 的也收
  const dump = JSON.parse(text);
  if (!dump || dump.format !== 1 || !Array.isArray(dump.tables?.characters)) throw new Error('不是每日備份檔');
  return dump;
}

export function openBackupRestoreSheet() {
  const ui = { dump: null, rows: [], existing: {}, picked: new Set(), message: '', results: [], busy: false };
  let sheet;

  async function loadFile(file) {
    ui.dump = null; ui.rows = []; ui.results = []; ui.message = '';
    if (!file) return sheet.refresh();
    if (file.size > MAX_FILE_BYTES) { ui.message = '檔案太大，不像是備份檔。'; return sheet.refresh(); }
    try { ui.dump = await readBackup(file); } catch (e) { ui.message = `讀不懂這個檔案：${e.message}。請選 R2 下載的 .json.gz。`; return sheet.refresh(); }
    try {
      ui.existing = Object.fromEntries((await listCharacters()).map((c) => [c.uid, c]));
    } catch (e) { ui.message = `無法向伺服器查詢現有角色：${e.message}`; return sheet.refresh(); }
    const names = Object.fromEntries(getRoomStatus().members.map((m) => [m.uid, m.name]));
    ui.rows = ui.dump.tables.characters.map((r) => {
      let data = null;
      try { data = JSON.parse(r.json); } catch { /* 壞掉的列顯示成無法讀取 */ }
      return { uid: String(r.uid), who: names[r.uid] ?? null, data, backupVersion: r.version, updatedAt: r.updated_at };
    });
    sheet.refresh();
  }

  async function restore(row) {
    ui.busy = true; sheet.refresh();
    const label = row.data?.name ?? row.uid;
    try {
      const cur = ui.existing[row.uid] ? await fetchCharacter(row.uid) : { version: 0 };
      const res = await roomRequest({ t: 'charImport', uid: row.uid, base: cur.version, data: row.data });
      ui.results.push(res.ok
        ? `${label}：已還原（伺服器第 ${res.version} 版）。請玩家重新整理網站，遇到「使用伺服器的存檔？」選「確定」。`
        : `${label}：失敗（對方剛剛存檔了，請重新選檔再試）`);
    } catch (e) { ui.results.push(`${label}：失敗（${e.message}）`); }
    ui.busy = false; ui.dump = null; ui.rows = []; // 資料已變動，要再還原請重新選檔
    sheet.refresh();
  }

  function rowView(r) {
    const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-TW') : '？';
    const ex = ui.existing[r.uid];
    return h('li', { class: 'import-row' },
      h('strong', { text: r.data?.name ?? '（無法讀取）' }),
      h('span', { text: r.who ? `　Discord：${r.who}` : `　（ID ${r.uid}）` }),
      h('p', { class: 'hint', text: `備份裡的存檔時間：${when}${ex ? `；伺服器現在是「${ex.charName || '？'}」` : '；伺服器目前沒有這位的角色'}` }),
      h('button', {
        type: 'button', class: 'btn btn--small', disabled: ui.busy || !r.data ? true : null,
        onclick: async (e) => {
          if (await askConfirm(e.currentTarget, { title: `還原「${r.data.name}」？`, lines: ['伺服器上這位玩家現在的角色會被備份的版本取代。'], okText: '還原', danger: true })) restore(r);
        },
      }, '還原這位'));
  }

  sheet = openSheet('從備份還原角色', () => h('div', {},
    h('p', { class: 'hint', text: '選從 Cloudflare R2 下載的備份檔（YYYY-MM-DD.json.gz）。檔案只在你的瀏覽器裡解壓，不會上傳。' }),
    h('input', { type: 'file', accept: '.gz,.json,application/gzip,application/json', disabled: ui.busy ? true : null, onchange: (e) => loadFile(e.target.files[0]) }),
    ui.dump ? h('p', { class: 'hint', text: `備份時間：${new Date(ui.dump.takenAt).toLocaleString('zh-TW')}，共 ${ui.rows.length} 位角色` }) : null,
    ui.message ? h('p', { class: 'notice notice--bad', text: ui.message }) : null,
    ui.rows.length ? h('ul', { class: 'import-list' }, ui.rows.map(rowView)) : null,
    ui.results.length ? h('ul', { class: 'import-results' }, ui.results.map((t) => h('li', { text: t }))) : null));
}
