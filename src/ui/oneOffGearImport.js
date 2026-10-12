// ============================================================
// 一次性：把一份文字清單的裝備放進自己的背包（只加不蓋）。只有網址帶 ?importgear=1 才會出現。
// 匯入完成後，這個檔案、src/data/oneOffGearList.js 與 gearView.js 裡的一行呼叫都可以刪掉。
// ============================================================
import { h } from './dom.js';
import { toast } from './controls.js';
import { askConfirm } from './confirmPop.js';
import { parseGearList, importGearList } from '../game/equipment.js';
import { ONE_OFF_GEAR_LIST } from '../data/oneOffGearList.js';

export const oneOffGearEnabled = () => {
  try { return new URLSearchParams(location.search).has('importgear'); } catch { return false; }
};

export function oneOffGearCard({ getState, commit, rerender }) {
  const ta = h('textarea', { class: 'field', rows: 8, spellcheck: 'false' });
  ta.value = ONE_OFF_GEAR_LIST.trim();
  const comp = h('input', { type: 'checkbox', checked: true });
  const info = h('p', { class: 'hint' });
  const refresh = () => {
    const { items, errors } = parseGearList(ta.value);
    info.textContent = `看得懂 ${items.length} 件（其中 ${items.filter((x) => x.equip).length} 件要穿上）${errors.length ? `；有 ${errors.length} 行看不懂，第 ${errors[0].line} 行：${errors[0].text}` : ''}`;
  };
  ta.addEventListener('input', refresh);
  refresh();
  const go = async (e) => {
    const state = getState();
    const { items } = parseGearList(ta.value);
    const ok = await askConfirm(e.currentTarget, {
      title: `放進 ${items.length} 件裝備？`,
      lines: ['只會新增，不會刪除或覆蓋現有東西。', '請只按一次，重複按會重複新增。'],
      okText: '放進背包',
    });
    if (!ok) return;
    const r = importGearList(state, ta.value, { compensate: comp.checked });
    if (!r.ok) { toast(`沒有放進去：第 ${r.errors[0].line} 行 ${r.errors[0].text}（${r.errors[0].error}）`); return; }
    commit();
    toast(`已放進 ${r.added} 件，穿上 ${r.equipped} 件`);
    rerender();
  };
  return h('section', { class: 'card' },
    h('h2', { class: 'section-title', text: '一次性：匯入裝備清單' }),
    h('p', { class: 'hint', text: '每行一件，「裝-」開頭＝身上穿的，「特殊-」＝特殊飾品。欄位已有裝備時，要穿的會改放進背包，不會頂掉。' }),
    ta,
    h('label', { class: 'row' }, comp, h('span', { text: '穿上的裝備，從「手動調整」扣掉它的加成（面板數字不變；你的手動調整已經含這些裝備時才勾）' })),
    info,
    h('button', { type: 'button', class: 'btn btn--primary', onclick: go }, '放進背包'));
}
