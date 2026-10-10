// ============================================================
// GM 專用：新增、修改、刪除「特殊配方」與「特殊材料」（修整日「特殊」分頁用的）。
// 內建的 10 個配方與 3 種材料效果寫在程式裡，不能改；這裡新增的只會「產生物品」，效果用文字說明，玩家自己記得怎麼用。
// 寫入走房間（specialSet／specialDel），伺服器檢查是不是 GM 並驗證內容，改完所有人立刻收到。
// 欄位檢查規則在 src/game/special.js（前端先擋一次，伺服器再擋一次）。
// ============================================================
import { askConfirm } from './confirmPop.js';
import { h } from './dom.js';
import { openSheet } from './sheet.js';
import { roomRequest, getRoomStatus, subscribeRoom } from '../state/rollLog.js';
import { toast } from './controls.js';
import {
  getCustomSpecial, validateCustomRecipe, validateCustomMaterial, MAX_RECIPE_INGREDIENTS, ALL_CHECK_SKILLS, MAX_CUSTOM_RECIPES, MAX_CUSTOM_MATERIALS,
} from '../game/special.js';
import { LIFE_SKILLS } from '../game/rules.js';

const blankRecipe = () => ({ name: '', type: '', skill: LIFE_SKILLS[0], dc: '15', effect: '', rows: Array.from({ length: MAX_RECIPE_INGREDIENTS }, () => ({ item: '', qty: '' })) });
const blankMaterial = () => ({ name: '', hint: '', skills: new Set(ALL_CHECK_SKILLS) });

export function openSpecialEditor() {
  const ui = { rForm: blankRecipe(), mForm: blankMaterial(), editingR: null, editingM: null, busy: false };
  let sheet;

  const send = async (msg, okText) => {
    ui.busy = true; sheet.refresh();
    try { await roomRequest(msg); toast(okText); } catch (e) { toast(e.message); }
    ui.busy = false; sheet.refresh();
  };

  // ---------- 配方 ----------
  const readRecipe = () => {
    const f = ui.rForm;
    const materials = {};
    for (const { item, qty } of f.rows) if (item.trim() || String(qty).trim()) materials[item.trim()] = Number(qty);
    return validateCustomRecipe(f.name, { type: f.type, skill: f.skill, dc: Number(f.dc), materials, effect: f.effect });
  };
  const saveRecipe = async () => {
    const v = readRecipe();
    if (!v.ok) return toast(v.error);
    await send({ t: 'specialSet', kind: 'recipe', name: v.name, def: v.def }, `已儲存配方「${v.name}」`);
    ui.rForm = blankRecipe(); ui.editingR = null; sheet.refresh();
  };
  const editRecipe = (name, d) => {
    const rows = Object.entries(d.materials).map(([item, qty]) => ({ item, qty: String(qty) }));
    while (rows.length < MAX_RECIPE_INGREDIENTS) rows.push({ item: '', qty: '' });
    ui.rForm = { name, type: d.type, skill: d.skill, dc: String(d.dc), effect: d.effect, rows };
    ui.editingR = name; sheet.refresh();
  };
  const input = (value, onChange, attrs = {}) => h('input', { class: 'field', type: 'text', value, ...attrs, oninput: (e) => onChange(e.target.value) });

  function recipeSection() {
    const { recipes } = getCustomSpecial();
    const f = ui.rForm;
    const names = Object.keys(recipes);
    return h('section', { class: 'special-edit' },
      h('h3', { class: 'field-label', text: `特殊配方（已新增 ${names.length} / ${MAX_CUSTOM_RECIPES}）` }),
      names.length
        ? h('ul', { class: 'special-edit__list' }, names.map((n) => h('li', { class: 'special-edit__row' },
            h('span', { class: 'special-edit__name', text: `${n}　${recipes[n].type}・${recipes[n].skill} DC ${recipes[n].dc}` }),
            h('span', { class: 'special-edit__btns' },
              h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.busy ? true : null, onclick: () => editRecipe(n, recipes[n]) }, '編輯'),
              h('button', {
                type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.busy ? true : null,
                onclick: async (e) => { if (await askConfirm(e.currentTarget, { title: `刪除配方「${n}」？`, lines: ['已經做出來的物品不會消失。'], okText: '刪除', danger: true })) send({ t: 'specialDel', kind: 'recipe', name: n }, `已刪除「${n}」`); },
              }, '刪除'))))) 
        : h('p', { class: 'hint', text: '還沒有新增任何配方。' }),
      h('h4', { class: 'field-label', text: ui.editingR ? `編輯「${ui.editingR}」` : '新增配方' }),
      h('div', { class: 'special-edit__form' },
        input(f.name, (v) => { f.name = v; }, { placeholder: '配方（成品）名稱', maxlength: '20', 'aria-label': '配方名稱' }),
        input(f.type, (v) => { f.type = v; }, { placeholder: '類型，例如「進階藥水」', maxlength: '20', 'aria-label': '類型' }),
        h('div', { class: 'special-edit__pair' },
          h('select', { class: 'field', 'aria-label': '檢定技能', onchange: (e) => { f.skill = e.target.value; } },
            LIFE_SKILLS.map((s) => h('option', { value: s, selected: s === f.skill ? true : null, text: s }))),
          h('input', { class: 'field', type: 'number', inputmode: 'numeric', min: '1', max: '60', value: f.dc, placeholder: 'DC', 'aria-label': 'DC', oninput: (e) => { f.dc = e.target.value; } })),
        h('p', { class: 'hint', text: `材料（最多 ${MAX_RECIPE_INGREDIENTS} 種，每次檢定扣一份）` }),
        f.rows.map((row, i) => h('div', { class: 'special-edit__pair' },
          input(row.item, (v) => { row.item = v; }, { placeholder: `材料 ${i + 1} 名稱`, maxlength: '20', 'aria-label': `材料 ${i + 1} 名稱` }),
          h('input', { class: 'field', type: 'number', inputmode: 'numeric', min: '1', max: '999', value: row.qty, placeholder: '數量', 'aria-label': `材料 ${i + 1} 數量`, oninput: (e) => { row.qty = e.target.value; } }))),
        input(f.effect, (v) => { f.effect = v; }, { placeholder: '效果說明（最多 120 字，玩家自己記得怎麼用）', maxlength: '120', 'aria-label': '效果說明' }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn--primary', disabled: ui.busy ? true : null, onclick: saveRecipe }, ui.editingR ? '儲存修改' : '新增配方'),
          ui.editingR ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { ui.rForm = blankRecipe(); ui.editingR = null; sheet.refresh(); } }, '取消編輯') : null)));
  }

  // ---------- 材料 ----------
  const saveMaterial = async () => {
    const f = ui.mForm;
    const v = validateCustomMaterial(f.name, { hint: f.hint, skills: [...f.skills] });
    if (!v.ok) return toast(v.error);
    await send({ t: 'specialSet', kind: 'material', name: v.name, def: v.def }, `已儲存材料「${v.name}」`);
    ui.mForm = blankMaterial(); ui.editingM = null; sheet.refresh();
  };

  function materialSection() {
    const { materials } = getCustomSpecial();
    const f = ui.mForm;
    const names = Object.keys(materials);
    return h('section', { class: 'special-edit' },
      h('h3', { class: 'field-label', text: `特殊材料（已新增 ${names.length} / ${MAX_CUSTOM_MATERIALS}；每個修整日每種取 1 次）` }),
      names.length
        ? h('ul', { class: 'special-edit__list' }, names.map((n) => h('li', { class: 'special-edit__row' },
            h('span', { class: 'special-edit__name', text: `${n}　${materials[n].skills.length === ALL_CHECK_SKILLS.length ? '任意技能' : materials[n].skills.join('、')}` }),
            h('span', { class: 'special-edit__btns' },
              h('button', {
                type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.busy ? true : null,
                onclick: () => { ui.mForm = { name: n, hint: materials[n].hint, skills: new Set(materials[n].skills) }; ui.editingM = n; sheet.refresh(); },
              }, '編輯'),
              h('button', {
                type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.busy ? true : null,
                onclick: async (e) => { if (await askConfirm(e.currentTarget, { title: `刪除材料「${n}」？`, lines: ['玩家背包裡已有的不會消失。'], okText: '刪除', danger: true })) send({ t: 'specialDel', kind: 'material', name: n }, `已刪除「${n}」`); },
              }, '刪除')))))
        : h('p', { class: 'hint', text: '還沒有新增任何材料。' }),
      h('h4', { class: 'field-label', text: ui.editingM ? `編輯「${ui.editingM}」` : '新增材料' }),
      h('div', { class: 'special-edit__form' },
        input(f.name, (v) => { f.name = v; }, { placeholder: '材料名稱', maxlength: '20', 'aria-label': '材料名稱' }),
        input(f.hint, (v) => { f.hint = v; }, { placeholder: '取得方式說明（最多 60 字）', maxlength: '60', 'aria-label': '說明' }),
        h('p', { class: 'hint', text: '可以用哪些技能檢定（擲 1D20 + 技能加值，總分多少就得到多少個）' }),
        h('div', { class: 'special-edit__skills' }, ALL_CHECK_SKILLS.map((s) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: f.skills.has(s) ? true : null, onchange: (e) => { if (e.target.checked) f.skills.add(s); else f.skills.delete(s); } }),
          h('span', { text: s })))),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn--primary', disabled: ui.busy ? true : null, onclick: saveMaterial }, ui.editingM ? '儲存修改' : '新增材料'),
          ui.editingM ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { ui.mForm = blankMaterial(); ui.editingM = null; sheet.refresh(); } }, '取消編輯') : null)));
  }

  // 別人（或自己）改了特殊配方／材料：重畫清單（只在資料真的變了才重畫，免得打字時被打斷）
  let seen = getRoomStatus().special;
  const off = subscribeRoom((r) => {
    if (!document.querySelector('.sheet__panel[aria-label="特殊配方與材料（GM）"]')) { off(); return; }
    if (r.special !== seen) { seen = r.special; sheet.refresh(); }
  });
  sheet = openSheet('特殊配方與材料（GM）', () => {
    if (getRoomStatus().phase !== 'online' || !getRoomStatus().me?.isGm) return h('p', { class: 'notice notice--bad', text: '只有加入房間的 GM 可以編輯。' });
    return h('div', { class: 'learn' },
      h('p', { class: 'hint', text: '內建的配方與材料不能改。新增的只會產生物品，效果請寫在說明裡。' }),
      recipeSection(), materialSection());
  }, { tall: true });
}
