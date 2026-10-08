// ============================================================
// GM 專用：新增、修改、刪除「專屬技能」（給有個人技能的玩家；新增後在「玩家角色」面板指定給玩家）。
// 只能設定「每級累積的固定屬性加成」＋效果文字；要程式計算的被動（像老狗識途）要另外寫程式，這裡先把效果寫進文字。
// 內建技能不能改。寫入走房間（skillSet／skillDel），伺服器檢查是不是 GM 並驗證內容，改完所有人立刻收到。
// 欄位檢查規則在 src/game/skillTable.js 的 validateCustomSkill（前端先擋一次，伺服器再擋一次）。
// ============================================================
import { h } from './dom.js';
import { openSheet } from './sheet.js';
import { roomRequest, getRoomStatus, subscribeRoom } from '../state/rollLog.js';
import { toast } from './controls.js';
import {
  SKILL_TABLE, getCustomSkillNames, validateCustomSkill, parseFxLine, formatFxLine,
  CUSTOM_TIERS, CUSTOM_KINDS, CUSTOM_SCHOOLS, MAX_CUSTOM_SKILLS, CUSTOM_TEXT_MAX, MAX_SKILL_LEVEL,
} from '../game/skillTable.js';

const blank = () => ({ name: '', tier: CUSTOM_TIERS[0], kind: CUSTOM_KINDS[1], school: '獨特', text: '', levels: Array.from({ length: MAX_SKILL_LEVEL }, () => '') });

export function openSkillEditor() {
  const ui = { form: blank(), editing: null, busy: false };
  let sheet;

  const send = async (msg, okText) => {
    ui.busy = true; sheet.refresh();
    try { await roomRequest(msg); toast(okText); } catch (e) { toast(e.message); }
    ui.busy = false; sheet.refresh();
  };

  /** 把表單整理成 { name, def }；有錯回傳 { error } */
  function read() {
    const f = ui.form;
    const fx = [];
    for (let i = 0; i < MAX_SKILL_LEVEL; i++) {
      const p = parseFxLine(f.levels[i]);
      if (!p.ok) return { error: `第 ${i + 1} 級：${p.error}` };
      fx.push(p.fx);
    }
    const v = validateCustomSkill(f.name, { tier: f.tier, kind: f.kind, school: f.school, text: f.text, fx });
    return v.ok ? v : { error: v.error };
  }

  async function save() {
    const v = read();
    if (v.error) return toast(v.error);
    await send({ t: 'skillSet', name: v.name, def: v.def }, `已儲存專屬技能「${v.name}」`);
    ui.form = blank(); ui.editing = null; sheet.refresh();
  }

  const edit = (name) => {
    const d = SKILL_TABLE[name];
    ui.form = { name, tier: d.tier, kind: d.kind, school: d.school, text: d.text, levels: d.fx.map((f) => formatFxLine(f)) };
    ui.editing = name; sheet.refresh();
  };

  const select = (value, options, label, onChange) => h('select', { class: 'field', 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o, selected: o === value ? true : null, text: o })));

  function body() {
    if (getRoomStatus().phase !== 'online' || !getRoomStatus().me?.isGm) return h('p', { class: 'notice notice--bad', text: '只有加入房間的 GM 可以編輯。' });
    const f = ui.form;
    const names = getCustomSkillNames();
    return h('div', { class: 'learn' },
      h('p', { class: 'hint', text: '新增後，到「玩家角色」面板把技能指定給玩家。內建技能不能改。' }),
      h('section', { class: 'special-edit' },
        h('h3', { class: 'field-label', text: `專屬技能（已新增 ${names.length} / ${MAX_CUSTOM_SKILLS}）` }),
        names.length
          ? h('ul', { class: 'special-edit__list' }, names.map((n) => h('li', { class: 'special-edit__row' },
              h('span', { class: 'special-edit__name', text: `${n}　${SKILL_TABLE[n].tier}・${SKILL_TABLE[n].kind}・${SKILL_TABLE[n].school}` }),
              h('span', { class: 'special-edit__btns' },
                h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.busy ? true : null, onclick: () => edit(n) }, '編輯'),
                h('button', {
                  type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.busy ? true : null,
                  onclick: () => { if (confirm(`刪除專屬技能「${n}」？已經學會它的玩家會暫時看不到這個技能（等級資料還在，重新建同名技能就會回來）。`)) send({ t: 'skillDel', name: n }, `已刪除「${n}」`); },
                }, '刪除')))))
          : h('p', { class: 'hint', text: '還沒有新增任何專屬技能。' }),
        h('h4', { class: 'field-label', text: ui.editing ? `編輯「${ui.editing}」` : '新增專屬技能' }),
        h('div', { class: 'special-edit__form' },
          h('input', { class: 'field', type: 'text', value: f.name, placeholder: '技能名稱', maxlength: '20', 'aria-label': '技能名稱', disabled: ui.editing ? true : null, oninput: (e) => { f.name = e.target.value; } }),
          h('div', { class: 'special-edit__trio' },
            select(f.tier, CUSTOM_TIERS, '位階', (v) => { f.tier = v; }),
            select(f.kind, CUSTOM_KINDS, '類型', (v) => { f.kind = v; }),
            select(f.school, CUSTOM_SCHOOLS, '系別', (v) => { f.school = v; })),
          h('textarea', { class: 'field import-text', rows: '5', maxlength: String(CUSTOM_TEXT_MAX), placeholder: `效果文字（最多 ${CUSTOM_TEXT_MAX} 字）`, 'aria-label': '效果文字', oninput: (e) => { f.text = e.target.value; } }, f.text),
          h('p', { class: 'hint', text: '每級的屬性加成：填「累積值」（該級總共加多少，不是比上一級多加多少），格式「屬性+數字」，多項用空格隔開，例如「生命+5 真實傷害+1」。沒有加成就留空。' }),
          f.levels.map((v, i) => h('div', { class: 'special-edit__level' },
            h('span', { class: 'special-edit__lv', text: `${i + 1} 級` }),
            h('input', { class: 'field', type: 'text', value: v, placeholder: '例：生命+5 真實傷害+1', 'aria-label': `${i + 1} 級的屬性加成`, oninput: (e) => { f.levels[i] = e.target.value; } }))),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn--primary', disabled: ui.busy ? true : null, onclick: save }, ui.editing ? '儲存修改' : '新增技能'),
            ui.editing ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { ui.form = blank(); ui.editing = null; sheet.refresh(); } }, '取消編輯') : null))));
  }

  // 別人（或自己）改了專屬技能：重畫清單（只在資料真的變了才重畫，免得打字時被打斷）
  let seen = getRoomStatus().skills;
  const off = subscribeRoom((r) => {
    if (!document.querySelector('.sheet__panel[aria-label="專屬技能（GM）"]')) { off(); return; }
    if (r.skills !== seen) { seen = r.skills; sheet.refresh(); }
  });
  sheet = openSheet('專屬技能（GM）', body, { tall: true });
}
