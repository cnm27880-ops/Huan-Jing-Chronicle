// ============================================================
// 檢定數值修正（裝備頁右欄）：備用保險。技能值和角色卡對不上時，玩家自己填差額。
// 規則在 src/game/engine.js 的 setCheckAdjust／modifier：修正會加進該技能的每次檢定，擲骰明細會顯示「手動修正」。
// ============================================================
import { h } from './dom.js';
import { toast } from './controls.js';
import { LIFE_SKILLS, ART_SKILLS } from '../game/rules.js';
import { CHECK_ADJUST_MAX, setCheckAdjust } from '../game/engine.js';
import { logActivity } from '../state/activityLog.js';

export function checkAdjustCard({ getState, commit }) {
  const state = getState();
  const row = (skill, isLife) => {
    const base = Number((isLife ? state.lifeSkills : state.arts)?.[skill]) || 0;
    const input = h('input', {
      class: 'field', type: 'number', inputmode: 'numeric', min: -CHECK_ADJUST_MAX, max: CHECK_ADJUST_MAX, step: 1,
      value: state.checkAdjust?.[skill] ?? 0, 'aria-label': `${skill} 手動修正`,
      onchange: (e) => {
        const s = getState();
        const before = Number(s.checkAdjust?.[skill]) || 0;
        const n = setCheckAdjust(s, skill, e.target.value);
        e.target.value = n;
        if (n === before) return;
        logActivity(s, { cat: 'learn', text: `${skill} 檢定修正：${before} → ${n}`, lines: [] });
        toast(`${skill} 手動修正 ${n >= 0 ? '+' : ''}${n}`);
        commit();
      },
    });
    return h('li', { class: 'adj-cell' }, h('span', { class: 'adj-cell__name' }, h('strong', { text: skill }), h('small', { class: 'num', text: `技能 ${base}` })), input);
  };
  return h('section', { class: 'card' },
    h('h2', { class: 'section-title', text: '檢定數值修正（備用）' }),
    h('p', { class: 'hint', text: `技能升級後數字沒變、或和你的角色卡對不上時，在這裡填差額（可填負數，範圍 ±${CHECK_ADJUST_MAX}）。會加進該技能的每次檢定，擲骰明細會寫「手動修正」，GM 看得到。` }),
    h('ul', { class: 'adj-grid' }, [...LIFE_SKILLS.map((s) => row(s, true)), ...ART_SKILLS.map((s) => row(s, false))]));
}
