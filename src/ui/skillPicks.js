// ============================================================
// 技能的「自選屬性」面板（放在技能升級畫面下方）：孕育、呼吸法、工程模塊等。
// 到達的等級可以選要加／減哪個屬性；按「確定」才存，選定後不可更改（要改找 GM）。
// 規則在 src/game/skillPicks.js。文字一律走 textContent。
// ============================================================
import { h } from './dom.js';
import { toast } from './controls.js';
import { askConfirm } from './confirmPop.js';
import { derivedStats } from '../game/stats.js';
import { PICK_SPECS, pickMilestones, setPick, pickText } from '../game/skillPicks.js';
import { logActivity } from '../state/activityLog.js';

const drafts = new Map(); // `${技能}:${等級}` → { skip, lose, gain: [] }，重畫時保留還沒按確定的選擇

export function skillPicksBlock(state, name, { commit, refresh }) {
  const spec = PICK_SPECS[name];
  const levels = pickMilestones(state, name);
  if (!spec || !levels.length) return null;

  const row = (m) => {
    const saved = state.skillPicks?.[name]?.[m];
    if (saved) {
      return h('li', { class: 'pick-row' },
        h('strong', { text: `${m} 級` }), h('span', { text: pickText(name, saved) }), h('small', { class: 'hint', text: '🔒 已選定' }));
    }
    const key = `${name}:${m}`;
    const d = drafts.get(key) ?? { skip: false, lose: spec.lose?.from.length === 1 ? spec.lose.from[0] : '', gain: Array(spec.gain.fixed ? 0 : spec.gain.n).fill('') };
    drafts.set(key, d);
    const redraw = () => refresh();
    const select = (value, options, onChange, label) => h('select', { class: 'field pick-select', 'aria-label': label, onchange: (e) => { onChange(e.target.value); } },
      h('option', { value: '', text: '選擇屬性' }),
      options.map((o) => h('option', { value: o, selected: o === value ? true : null, text: o })));

    const parts = [];
    if (spec.optional) {
      parts.push(h('div', { class: 'chip-row' },
        [[false, '使用'], [true, '不使用']].map(([skip, text]) =>
          h('button', { type: 'button', class: 'chip', 'aria-pressed': String(d.skip === skip), onclick: () => { d.skip = skip; redraw(); } }, text))));
    }
    if (!d.skip) {
      if (spec.lose) {
        parts.push(spec.lose.from.length > 1
          ? h('label', { class: 'pick-line' }, h('span', { text: `減少 ${spec.lose.n} 點` }), select(d.lose, spec.lose.from, (v) => { d.lose = v; }, '要減少的屬性'))
          : h('p', { class: 'pick-line', text: `減少 ${spec.lose.from[0]} ${spec.lose.n} 點` }));
      }
      if (spec.gain.fixed) {
        parts.push(h('p', { class: 'pick-line', text: `增加 ${spec.gain.fixed} ${spec.gain.n} 點` }));
      } else {
        if (spec.gain.n >= 3) {
          parts.push(h('label', { class: 'pick-line' }, h('span', { text: `${spec.gain.n} 點全給` }),
            select('', spec.gain.from, (v) => { if (v) { d.gain = Array(spec.gain.n).fill(v); redraw(); } }, '全部設成同一個屬性')));
        }
        parts.push(h('div', { class: 'pick-points' }, d.gain.map((v, i) =>
          h('label', { class: 'pick-line' }, h('span', { text: `第 ${i + 1} 點` }), select(v, spec.gain.from, (x) => { d.gain[i] = x; }, `第 ${i + 1} 點加的屬性`)))));
      }
    }
    parts.push(h('button', {
      type: 'button', class: 'btn btn--small',
      onclick: async (e) => {
        const choice = d.skip ? { skip: true } : { gain: d.gain, lose: d.lose };
        const preview = setPickPreview(state, name, m, choice);
        if (preview.error) return toast(preview.error);
        const ok = await askConfirm(e.currentTarget, { title: `${name} ${m} 級：確定這樣選嗎？`, lines: [preview.text, '選定後不可更改。'], okText: '確定', danger: true });
        if (!ok) return;
        const r = setPick(state, name, m, choice, derivedStats(state));
        if (!r.ok) return toast(r.error);
        drafts.delete(key);
        toast(`${name} ${m} 級：${pickText(name, r.pick)}`);
        logActivity(state, { cat: 'learn', text: `${name} ${m} 級自選屬性`, lines: [pickText(name, r.pick)] });
        commit();
        refresh();
      },
    }, '確定'));
    return h('li', { class: 'pick-row pick-row--open' }, h('strong', { text: `${m} 級` }), h('div', { class: 'pick-body' }, parts));
  };

  return h('section', { class: 'pick-block' },
    h('p', { class: 'field-label', text: '自選屬性（選定後不可更改）' }),
    h('ul', { class: 'pick-list' }, levels.map(row)));
}

/** 按確定前先在不存檔的複本上試算一次，錯誤立刻告訴玩家，成功就拿到要顯示的確認文字 */
function setPickPreview(state, name, m, choice) {
  const copy = JSON.parse(JSON.stringify({ skills: state.skills, skillPicks: state.skillPicks ?? {} }));
  const r = setPick(copy, name, m, choice, derivedStats(state));
  return r.ok ? { text: pickText(name, r.pick) } : { error: r.error };
}
