// ============================================================
// GM 專用：查看並修改玩家的角色（手動調整、技能等級、啟動）。
// 讀取用 charGet、寫回用 charImport（帶版本號：玩家剛好存檔會被擋下，不會蓋掉對方）。
// 只有 statMode === 'skills' 的角色（用技能目錄計算數值的）才能改手動調整與技能。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet } from './sheet.js';
import { listCharacters, fetchCharacter } from '../state/charSync.js';
import { roomRequest } from '../state/rollLog.js';
import { derivedStats } from '../game/stats.js';
import { ALL_STATS } from '../game/rules.js';
import { SKILL_TABLE, inCatalog, needsActivation, usesSkillTable, MAX_SKILL_LEVEL, getCustomSkillNames } from '../game/skillTable.js';

const when = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '不明');
const int = (v) => Math.trunc(Number(v)) || 0;

export function openGmCharEditor() {
  const ui = { list: null, error: '', uid: null, version: 0, data: null, busy: false, message: '', addSkill: '', addLevel: 1 };
  let sheet;

  async function loadList() {
    try { ui.list = await listCharacters(); } catch (e) { ui.error = e.message; }
    sheet.refresh();
  }

  async function open(uid) {
    ui.busy = true; ui.message = ''; sheet.refresh();
    try {
      const { version, data } = await fetchCharacter(uid);
      Object.assign(ui, { uid, version, data });
    } catch (e) { ui.error = e.message; }
    ui.busy = false;
    sheet.refresh();
  }

  async function save() {
    ui.busy = true; ui.message = ''; sheet.refresh();
    try {
      const adjust = Object.fromEntries(Object.entries(ui.data.adjust ?? {}).filter(([, v]) => v !== 0));
      const res = await roomRequest({ t: 'charImport', uid: ui.uid, base: ui.version, data: { ...ui.data, adjust } });
      if (res.ok) { ui.version = res.version; ui.message = `已儲存（第 ${res.version} 版）。玩家下次載入網站時會被詢問要不要使用伺服器的存檔。`; }
      else ui.message = '失敗：玩家剛剛存檔了，請回到清單重新開啟再改。';
    } catch (e) { ui.message = `失敗：${e.message}`; }
    ui.busy = false;
    sheet.refresh();
  }

  function listView() {
    if (ui.error) return h('p', { class: 'notice notice--bad', text: ui.error });
    if (!ui.list) return h('p', { class: 'hint', text: '讀取中…' });
    if (!ui.list.length) return h('p', { class: 'notice', text: '還沒有任何玩家的角色存在伺服器上。' });
    return h('ul', { class: 'import-list' }, ui.list.map((c) => h('li', { class: 'import-row' },
      h('strong', { text: c.charName || c.name }), h('small', { class: 'hint', text: `${c.name}・第 ${c.version} 版・${when(c.updatedAt)}` }),
      h('button', { type: 'button', class: 'btn btn--small', disabled: ui.busy ? true : null, onclick: () => open(c.uid) }, '開啟'))));
  }

  /** 把技能指定給玩家（例如 GM 新增的專屬技能）：直接設定等級；GM 自己決定要不要補技能書與經驗 */
  function addSkillRow(d) {
    const owned = d.skills ?? {};
    const custom = getCustomSkillNames().filter((n) => !(n in owned));
    const others = Object.keys(SKILL_TABLE).filter((n) => !(n in owned) && !custom.includes(n));
    if (!ui.addSkill || !(ui.addSkill in SKILL_TABLE) || ui.addSkill in owned) ui.addSkill = custom[0] ?? others[0] ?? '';
    return h('div', { class: 'row', style: 'margin: 10px 0;' },
      h('select', { class: 'field', 'aria-label': '要指定的技能', onchange: (e) => { ui.addSkill = e.target.value; } },
        custom.length ? h('optgroup', { label: 'GM 新增的專屬技能' }, custom.map((n) => h('option', { value: n, selected: n === ui.addSkill ? true : null, text: n }))) : null,
        h('optgroup', { label: '其他技能' }, others.map((n) => h('option', { value: n, selected: n === ui.addSkill ? true : null, text: `${n}（${SKILL_TABLE[n].tier}）` })))),
      h('input', { class: 'field', type: 'number', min: 1, max: MAX_SKILL_LEVEL, value: ui.addLevel, inputmode: 'numeric', 'aria-label': '等級', style: 'max-width: 5em;', onchange: (e) => { ui.addLevel = Math.max(1, Math.min(MAX_SKILL_LEVEL, int(e.target.value) || 1)); } }),
      h('button', {
        type: 'button', class: 'btn btn--small', disabled: ui.addSkill ? null : true,
        onclick: () => { d.skills = { ...d.skills, [ui.addSkill]: ui.addLevel }; ui.message = `已加上「${ui.addSkill}」${ui.addLevel} 級，記得按「儲存到伺服器」。`; ui.addSkill = ''; sheet.refresh(); },
      }, '＋ 指定給玩家'));
  }

  function editor() {
    const d = ui.data;
    if (!usesSkillTable(d)) {
      return h('div', {},
        h('p', { class: 'notice', text: `${d.name}：這是舊式存檔（數值已含技能，沒有手動調整）。要改成用技能目錄計算，請用「匯入角色卡」重新匯入。` }),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { ui.data = null; sheet.refresh(); } }, '回清單'));
    }
    d.adjust = d.adjust ?? {};
    const stats = derivedStats(d);
    const skills = Object.entries(d.skills ?? {}).filter(([n]) => inCatalog(n));
    return h('div', {},
      h('div', { class: 'row' },
        h('strong', { text: d.name }),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { ui.data = null; sheet.refresh(); } }, '回清單')),
      h('p', { class: 'field-label', text: '手動調整（加進數值面板；可為負數）' }),
      h('div', { class: 'stat-grid' }, ALL_STATS.map((s) => h('label', { class: 'stat' },
        h('span', { class: 'stat__name', text: s }),
        h('input', { class: 'field', type: 'number', inputmode: 'numeric', value: d.adjust[s] ?? 0, 'aria-label': `${s} 手動調整`, onchange: (e) => { d.adjust[s] = int(e.target.value); sheet.refresh(); } }),
        h('small', { class: 'stat__detail', text: `面板 ${fmt(stats[s].total)}` })))),
      h('p', { class: 'field-label', text: `技能（${skills.length}）` }),
      h('ul', { class: 'skill-list' }, skills.map(([n, lv]) => h('li', { class: 'skill-row' },
        h('strong', { text: n }),
        h('label', { class: 'extra' }, h('span', { text: '等級' }),
          h('input', { class: 'field', type: 'number', min: 0, max: MAX_SKILL_LEVEL, value: lv, inputmode: 'numeric', onchange: (e) => { d.skills[n] = Math.max(0, Math.min(MAX_SKILL_LEVEL, int(e.target.value))); sheet.refresh(); } })),
        needsActivation(n)
          ? h('label', { class: 'check' },
              h('input', { type: 'checkbox', checked: d.skillOn?.[n] ? true : null, onchange: (e) => { d.skillOn = { ...d.skillOn, [n]: e.target.checked }; sheet.refresh(); } }),
              h('span', { text: `啟動（算力上限 −${SKILL_TABLE[n].activate.算力}）` }))
          : null))),
      addSkillRow(d),
      h('button', { type: 'button', class: 'btn btn--primary', disabled: ui.busy ? true : null, onclick: save }, ui.busy ? '儲存中…' : '儲存到伺服器'),
      ui.message ? h('p', { class: 'notice', text: ui.message }) : null);
  }

  sheet = openSheet('玩家角色（GM）', () => (ui.data ? editor() : listView()));
  loadList();
}
