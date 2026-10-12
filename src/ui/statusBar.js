// ============================================================
// 常駐狀態列：時間、熟練、胃袋、經驗、金幣隨時看得到，不用另外打開
// 點空的胃袋格就能吃東西
// ============================================================
import { h, fmt } from './dom.js';
import { iconOf } from './items.js';
import { openSheet } from './sheet.js';
import { askConfirm } from './confirmPop.js';
import { itemTile, toast } from './controls.js';
import { FOODS, STOMACH_SLOTS, MAX_TIME } from '../game/rules.js';
import {
  proficiency, newDay, eat, countOf, eatOrQueue, eatPreset, overwriteLoss, addPreset, presetLabel, clearQueue, restQueue,
} from '../game/engine.js';
import { logActivity } from '../state/activityLog.js';

/** 菜單編輯：新增（點料理加入，最多 3 份）與刪除。吃東西不在這裡，點胃袋的「＋」才吃 */
export function openMenuSheet(state, commit) {
  let draft = [];
  const sheet = openSheet('編輯菜單', () => {
    const presets = (state.foodPresets ??= []);
    const done = (text) => { toast(text); commit(); sheet.refresh(); };
    return h('div', { class: 'menu-edit' },
      h('p', { class: 'hint', text: '一組菜單最多 3 份料理，存好後點胃袋的「＋」就能選。' }),
      presets.length
        ? h('ul', { class: 'menu-list' }, presets.map((p, i) => h('li', { class: 'menu-row' },
            h('span', { class: 'menu-row__name', text: presetLabel(p) }),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': `刪除菜單 ${presetLabel(p)}`, onclick: () => { presets.splice(i, 1); done('刪除一組菜單'); } }, '刪除'))))
        : h('p', { class: 'hint', text: '還沒有菜單。' }),
      h('p', { class: 'field-label', text: `新增菜單：${draft.length ? presetLabel(draft) : '點下面的料理加入'}` }),
      h('div', { class: 'menu-chips' }, Object.keys(FOODS).map((f) =>
        h('button', {
          type: 'button', class: 'chip', title: FOODS[f].effect,
          onclick: () => { if (draft.length < STOMACH_SLOTS) draft.push(f); sheet.refresh(); },
        }, `${iconOf(f)} ${f}`))),
      h('div', { class: 'menu-actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: !draft.length, onclick: () => { draft = []; sheet.refresh(); } }, '清除'),
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small', disabled: !draft.length,
          onclick: () => { const err = addPreset(state, draft); if (err) return toast(err); draft = []; done('新增一組菜單'); },
        }, '儲存菜單')));
  });
}

/** 點胃袋的「＋」：選菜單（一鍵吃一整組）或單吃一份料理 */
export function openFoodSheet(state, ctx, commit) {
  const rest = ctx === 'rest';
  const where = rest ? '修整' : '跑團';
  let sets = 1; // 菜單一次吃幾組
  const sheet = openSheet(rest ? '修整時吃東西' : '跑團時吃東西', () => {
    const stomach = rest ? state.restStomach : state.sessionStomach;
    const queue = rest ? restQueue(state) : [];
    const presets = (state.foodPresets ??= []);
    const foods = Object.keys(FOODS).filter((f) => countOf(state, f) > 0);
    const done = (text) => { toast(text); logActivity(state, { cat: 'item', text, lines: [] }); commit(); sheet.refresh(); };

    const queueBox = rest && queue.length
      ? h('div', { class: 'menu-queue' },
          h('span', { class: 'hint', text: `等候中 ${queue.length} 份：${presetLabel(queue)}（胃袋有空格會自動補上）` }),
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => done(`等候佇列退回背包 ${clearQueue(state)} 份`) }, '全部退回背包'))
      : null;

    const setChips = h('div', { class: 'menu-sets' },
      h('span', { class: 'hint', text: '一次吃' }),
      [1, 5, 10].map((n) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(sets === n), onclick: () => { sets = n; sheet.refresh(); } }, `${n} 組`)),
      h('input', {
        class: 'field menu-sets__input', type: 'number', min: 1, inputmode: 'numeric', value: sets, 'aria-label': '菜單一次吃幾組',
        onchange: (e) => { sets = Math.max(1, Math.floor(Number(e.target.value)) || 1); sheet.refresh(); },
      }));

    const presetRows = presets.map((p) =>
      h('li', { class: 'menu-row' },
        h('span', { class: 'menu-row__name', text: presetLabel(p) }),
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small',
          onclick: () => {
            const err = eatPreset(state, p, sets, ctx);
            err ? toast(err) : done(`${where}吃下菜單「${presetLabel(p)}」× ${sets} 組`);
          },
        }, `吃 ${sets} 組`),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--small',
          onclick: async (e) => {
            const lost = overwriteLoss(state, p, ctx);
            if (!lost.length) return toast('胃袋還有空格，直接吃就好，不需要覆蓋。');
            const ok = await askConfirm(e.currentTarget, {
              title: '要覆蓋胃袋裡的料理嗎？',
              lines: [`會蓋掉：${presetLabel(lost.map((s) => s.food))}`, '被蓋掉的料理不會退回。'],
              okText: '覆蓋', danger: true,
            });
            if (!ok) return;
            const err = eatPreset(state, p, sets, ctx, { overwrite: true });
            err ? toast(err) : done(`${where}覆蓋吃下菜單「${presetLabel(p)}」× ${sets} 組（蓋掉 ${presetLabel(lost.map((s) => s.food))}）`);
          },
        }, '覆蓋吃')));

    return h('div', { class: 'menu-eat' },
      h('p', { class: 'field-label', text: `胃袋 ${stomach.length} / ${STOMACH_SLOTS}${rest && stomach.length >= STOMACH_SLOTS ? '（滿了，再吃會排進等候）' : ''}` }),
      queueBox,
      presets.length
        ? [h('p', { class: 'field-label', text: '菜單' }), setChips, h('ul', { class: 'menu-list' }, presetRows)]
        : h('p', { class: 'hint', text: '還沒有菜單，點胃袋左邊的「菜單」新增。' }),
      h('p', { class: 'field-label', text: '單吃一份' }),
      foods.length
        ? h('div', { class: 'tile-grid' }, foods.map((f) =>
            itemTile(f, countOf(state, f), {
              extra: h('span', { class: 'tile__note', text: FOODS[f].effect }),
              onClick: () => {
                const wasFull = stomach.length >= STOMACH_SLOTS;
                const err = rest ? eatOrQueue(state, f) : eat(state, f, ctx);
                if (err) return toast(err);
                done(`${wasFull ? '排入等候' : '吃下'}${f}（${where}）`);
              },
            })))
        : h('p', { class: 'notice', text: '背包裡沒有料理。' }));
  });
}

/**
 * 「新的一天」：第一下只會在同一格裡變成「確定換日？」，再按「確定」才真的換日（避免誤觸）。
 * 5 秒內沒確認就自動恢復原狀。
 */
function newDayButton(state, commit) {
  const box = h('span', { class: 'day-confirm' });
  let timer = null;
  const showIdle = () => {
    clearTimeout(timer);
    box.replaceChildren(h('button', { type: 'button', class: 'status__day', onclick: showAsk }, '新的一天'));
  };
  function showAsk() {
    const yes = h('button', {
      type: 'button', class: 'status__day status__day--yes',
      onclick: () => {
        clearTimeout(timer);
        newDay(state);
        toast(`第 ${state.loginDays} 天，時間恢復 10 點`);
        commit();
      },
    }, '確定');
    box.replaceChildren(
      h('span', { class: 'day-confirm__ask', text: '確定換日？' }),
      yes,
      h('button', { type: 'button', class: 'status__day status__day--no', onclick: showIdle }, '取消'));
    yes.focus();
    timer = setTimeout(() => { if (box.isConnected) showIdle(); }, 5000);
  }
  showIdle();
  return box;
}

/**
 * 修整日頂部的角色狀態（和戰鬥頁一樣是固定在上方的 HUD）：
 * 名字、天數、經驗、金幣；修整時顯示時間；熟練與胃袋（點空格吃東西）
 */
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
  return h('div', { class: 'rest-hud' },
    h('div', { class: 'rest-hud__top' },
      h('h2', { class: 'rest-hud__name', text: state.name }),
      h('span', { class: 'rest-hud__day', text: `第 ${state.loginDays} 天` }),
      h('span', { class: 'rest-hud__num' }, h('small', { text: '經驗' }), h('strong', { class: 'num', text: fmt(state.exp) })),
      h('span', { class: 'rest-hud__num' }, h('small', { text: '金幣' }), h('strong', { class: 'num', text: fmt(state.gold) }))),
    h('div', { class: 'rest-hud__grid' },
      ctx === 'rest'
        ? h('div', { class: 'hud-box hud-box--time' },
            h('div', { class: 'hud-box__head' },
              h('span', { class: 'hud-box__label', text: '時間' }),
              h('strong', { class: 'hud-box__value num', text: `${state.time} / ${MAX_TIME}` }),
              newDayButton(state, commit)),
            h('span', { class: 'pips', role: 'img', 'aria-label': `剩餘時間 ${state.time} 點` },
              Array.from({ length: MAX_TIME }, (_, i) => h('span', { class: `pip${i < state.time ? ' is-on' : ''}` }))))
        : null,
      h('div', { class: 'hud-box hud-box--prof', title: prof.parts.map((p) => `${p.label} +${p.value}`).join('、') },
        h('div', { class: 'hud-box__head' },
          h('span', { class: 'hud-box__label', text: ctx === 'rest' ? '修整熟練' : '跑團熟練' }),
          h('strong', { class: 'hud-box__value num', text: `+${prof.total}` })),
        h('span', { class: 'mini-slots' },
          h('button', { type: 'button', class: 'mini-slot mini-slot--menu', title: '編輯菜單', onclick: () => openMenuSheet(state, commit) }, '菜單'),
          slots,
          ctx === 'rest' && restQueue(state).length
            ? h('button', { type: 'button', class: 'mini-slot mini-slot--queue', title: '等候中的料理，點一下管理', onclick: () => openFoodSheet(state, ctx, commit) },
                `＋${restQueue(state).length}`)
            : null))));
}
