// ============================================================
// 常駐狀態列：時間、熟練、胃袋、經驗、金幣隨時看得到，不用另外打開
// 點空的胃袋格就能吃東西
// ============================================================
import { h, fmt } from './dom.js';
import { iconOf } from './items.js';
import { openSheet } from './sheet.js';
import { itemTile, toast } from './controls.js';
import { FOODS, STOMACH_SLOTS, MAX_TIME } from '../game/rules.js';
import { proficiency, newDay, eat, countOf } from '../game/engine.js';

export function openFoodSheet(state, ctx, commit) {
  const sheet = openSheet(ctx === 'rest' ? '修整時吃東西' : '跑團時吃東西', (close) => {
    const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
    const foods = Object.keys(FOODS).filter((f) => countOf(state, f) > 0);
    return h('div', {},
      h('p', { class: 'hint', text: ctx === 'rest'
        ? '每份維持 10 次修整檢定，最多 3 份，熟練加值相加。'
        : '維持到本次跑團結束，最多 3 份，熟練加值相加。' }),
      h('p', { class: 'field-label', text: `胃袋 ${stomach.length} / ${STOMACH_SLOTS}` }),
      foods.length
        ? h('div', { class: 'tile-grid' }, foods.map((f) =>
            itemTile(f, countOf(state, f), {
              extra: h('span', { class: 'tile__note', text: FOODS[f].effect }),
              onClick: () => {
                const err = eat(state, f, ctx);
                if (err) return toast(err);
                toast(`吃下${f}`);
                commit();
                stomach.length + 0 >= STOMACH_SLOTS ? close() : sheet.refresh();
              },
            })))
        : h('p', { class: 'notice', text: '背包裡沒有料理。' }));
  });
}

export function statusBar(state, commit, ctx = 'rest') {
  const stomach = ctx === 'rest' ? state.restStomach : state.sessionStomach;
  const prof = proficiency(state, ctx);
  const slots = Array.from({ length: STOMACH_SLOTS }, (_, i) => {
    const s = stomach[i];
    return s
      ? h('span', { class: 'mini-slot', title: `${s.food}：${FOODS[s.food]?.effect ?? ''}` },
          h('span', { 'aria-hidden': 'true', text: iconOf(s.food) }),
          h('small', { text: ctx === 'rest' ? s.left : '團' }))
      : h('button', {
          type: 'button', class: 'mini-slot mini-slot--empty', 'aria-label': '空胃袋，點一下吃東西',
          onclick: () => openFoodSheet(state, ctx, commit),
        }, '＋');
  });
  return h('div', { class: 'status' },
    h('div', { class: 'status__who' },
      h('strong', { class: 'status__name', text: state.name }),
      h('span', { class: 'status__meta', text: `第 ${state.loginDays} 天` })),
    ctx === 'rest'
      ? h('div', { class: 'status__time' },
          h('span', { class: 'status__label', text: '時間' }),
          h('span', { class: 'pips', role: 'img', 'aria-label': `剩餘時間 ${state.time} 點` },
            Array.from({ length: MAX_TIME }, (_, i) => h('span', { class: `pip${i < state.time ? ' is-on' : ''}` }))),
          h('strong', { text: `${state.time}` }),
          h('button', {
            type: 'button', class: 'status__day',
            onclick: () => { newDay(state); toast(`第 ${state.loginDays} 天，時間恢復 10 點`); commit(); },
          }, '新的一天'))
      : null,
    h('div', { class: 'status__prof', title: prof.parts.map((p) => `${p.label} +${p.value}`).join('、') },
      h('span', { class: 'status__label', text: ctx === 'rest' ? '修整熟練' : '跑團熟練' }),
      h('strong', { text: prof.total }),
      h('span', { class: 'mini-slots' }, slots)),
    h('div', { class: 'status__num' }, h('span', { class: 'status__label', text: '經驗' }), h('strong', { text: fmt(state.exp) })),
    h('div', { class: 'status__num' }, h('span', { class: 'status__label', text: '金幣' }), h('strong', { text: fmt(state.gold) }))
  );
}
