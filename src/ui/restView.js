// ============================================================
// 修整日頁面
// 設計原則：全程用點的，不用打字；狀態列常駐，不用另外打開
// ============================================================
import { h, fmt } from './dom.js';
import { statusBar, openFoodSheet } from './statusBar.js';
import { itemTile, amountPicker } from './controls.js';
import { iconOf, TIERS } from './items.js';
import {
  LIFE_SKILLS, ART_SKILLS, GATHER_ACTIONS, CRAFT_ACTIONS, DIFFICULTIES, RECIPES,
  FOODS, STOMACH_SLOTS, CRAFT_COST_AMOUNT,
} from '../game/rules.js';
import {
  modifier, endSession, gather, craft, craftableTimes, sessionCheck, keepsakeApplies, countOf,
} from '../game/engine.js';

const ICONS = { 採藥: '🌿', 狩獵: '🏹', 挖礦: '⛏️', 釣魚: '🎣', 調劑: '⚗️', 烹飪: '🍳', 鑄造: '🔨', 書寫: '✍️' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createRestView({ root, getState, commit }) {
  const ui = {
    tab: 'gather',
    gatherAction: '採藥',
    craftAction: '烹飪',
    craftDiff: '普通',
    times: 1,
    keepsakes: new Set(),
    results: [], // 最新的在最前面
    fresh: false, // 剛產生新結果：要播動畫並捲到結果
  };

  const partsText = (list) => list.map((p) => `${p.label} +${p.value}`).join('　');
  const pushResult = (r) => { ui.results.unshift(r); ui.fresh = true; commit(); };

  // ---------- 共用：加值說明、紀念品 ----------
  function modLine(mod) {
    return h('div', { class: 'mod' },
      h('span', { class: 'mod__label', text: '加值' }),
      h('strong', { class: 'mod__value', text: `+${mod.total}` }),
      h('span', { class: 'mod__parts', text: partsText(mod.parts) }));
  }

  function keepsakeToggles(state, action) {
    const usable = Object.entries(state.keepsakes).filter(([n, d]) => keepsakeApplies(d, action) && countOf(state, n) > 0);
    [...ui.keepsakes].forEach((n) => { if (!usable.some(([u]) => u === n)) ui.keepsakes.delete(n); });
    if (!usable.length) return null;
    return h('div', { class: 'block' },
      h('p', { class: 'field-label', text: '使用紀念品（每次檢定各消耗 1 個）' }),
      h('div', { class: 'toggle-row' },
        usable.map(([n, d]) =>
          h('button', {
            type: 'button', class: 'toggle', 'aria-pressed': String(ui.keepsakes.has(n)), title: d.desc,
            onclick: () => { ui.keepsakes.has(n) ? ui.keepsakes.delete(n) : ui.keepsakes.add(n); render(); },
          },
          h('span', { 'aria-hidden': 'true', text: iconOf(n) }),
          h('span', { class: 'toggle__text' }, h('strong', { text: `${n} +${d.bonus}` }), h('small', { text: `剩 ${fmt(countOf(state, n))}` }))))));
  }

  function actionCards(list, current, onPick, sub) {
    return h('div', { class: 'action-cards', role: 'radiogroup' },
      list.map((a) => h('button', {
        type: 'button', class: 'action-card', role: 'radio', 'aria-checked': String(a === current),
        onclick: () => onPick(a),
      },
      h('span', { class: 'action-card__icon', 'aria-hidden': 'true', text: ICONS[a] }),
      h('span', { class: 'action-card__name', text: a }),
      h('span', { class: 'action-card__sub', text: sub(a) }))));
  }

  // ---------- 採集 ----------
  function gatherPanel(state) {
    const a = ui.gatherAction;
    const mod = modifier(state, a, 'rest', [...ui.keepsakes]);
    const max = state.time;
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    return h('div', { class: 'panel' },
      actionCards(GATHER_ACTIONS, a, (x) => { ui.gatherAction = x; render(); }, (x) => `技能 ${state.lifeSkills[x] ?? 0}`),
      max <= 0
        ? h('p', { class: 'notice', text: '今天的時間用完了。點上方的「新的一天」恢復 10 點。' })
        : [
            h('div', { class: 'block' },
              h('p', { class: 'field-label', text: `次數（每次 1 點時間，剩 ${max} 點）` }),
              amountPicker({ value: ui.times, max, quick: [1, 3, 5], onChange: (n) => { ui.times = n; render(); } })),
            keepsakeToggles(state, a),
            modLine(mod),
            h('button', {
              type: 'button', class: 'btn btn--primary btn--go',
              onclick: () => pushResult({ kind: 'gather', action: a, ...gather(state, a, ui.times, [...ui.keepsakes]) }),
            }, `${ICONS[a]} ${a} ${ui.times} 次`),
          ]);
  }

  // ---------- 製作 ----------
  function craftPanel(state) {
    const a = ui.craftAction;
    const d = ui.craftDiff;
    const recipe = RECIPES[a][d];
    const max = craftableTimes(state, a, d);
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    const mod = modifier(state, a, 'rest', [...ui.keepsakes]);
    return h('div', { class: 'panel' },
      actionCards(CRAFT_ACTIONS, a, (x) => { ui.craftAction = x; render(); }, (x) => `技能 ${state.lifeSkills[x] ?? 0}`),
      h('div', { class: 'diff-grid', role: 'radiogroup' },
        DIFFICULTIES.map((x, i) => {
          const r = RECIPES[a][x];
          const n = craftableTimes(state, a, x);
          return h('button', {
            type: 'button', class: 'diff', role: 'radio', 'aria-checked': String(x === d), dataset: { tier: i },
            onclick: () => { ui.craftDiff = x; render(); },
          },
          h('span', { class: 'diff__head' }, h('strong', { text: x }), h('span', { text: `DC ${r.dc}` })),
          h('span', { class: 'diff__cost' }, h('span', { 'aria-hidden': 'true', text: iconOf(r.cost) }), ` ${r.cost} ×${CRAFT_COST_AMOUNT}`),
          h('span', { class: `diff__can${n ? '' : ' is-none'}`, text: n ? `可做 ${fmt(n)} 次` : `只有 ${fmt(countOf(state, r.cost))} 個` }));
        })),
      h('div', { class: 'reward-line' },
        h('span', { class: 'field-label', text: `成功抽 ${recipe.count} 個` }),
        recipe.rewards.map((r) => itemTile(r, null, { size: 'sm' }))),
      max <= 0
        ? h('p', { class: 'notice', text: `${recipe.cost}不足 ${CRAFT_COST_AMOUNT} 個，先去採集吧。` })
        : [
            h('div', { class: 'block' },
              h('p', { class: 'field-label', text: '次數（製作不消耗時間）' }),
              amountPicker({ value: ui.times, max, quick: [1, 5, 10], onChange: (n) => { ui.times = n; render(); } })),
            keepsakeToggles(state, a),
            modLine(mod),
            h('button', {
              type: 'button', class: 'btn btn--primary btn--go',
              onclick: () => pushResult({ kind: 'craft', action: a, diff: d, ...craft(state, a, d, ui.times, [...ui.keepsakes]) }),
            }, `${ICONS[a]} ${a}（${d}）${ui.times} 次`),
          ]);
  }

  // ---------- 跑團 ----------
  function sessionPanel(state) {
    const skillBtn = (s, value) => {
      const mod = modifier(state, s, 'session');
      return h('button', {
        type: 'button', class: 'skill-btn',
        onclick: () => pushResult({ kind: 'session', ...sessionCheck(state, s) }),
      },
      h('span', { class: 'skill-btn__name', text: s }),
      h('span', { class: 'skill-btn__mod', text: `+${mod.total}` }),
      h('small', { text: mod.isLife ? `${value} + 熟練` : `技能 ${value}` }));
    };
    const st = state.sessionStomach;
    return h('div', { class: 'panel' },
      h('div', { class: 'session-stomach' },
        h('p', { class: 'field-label', text: '跑團胃袋（到本次跑團結束）' }),
        h('div', { class: 'session-stomach__slots' },
          Array.from({ length: STOMACH_SLOTS }, (_, i) => st[i]
            ? itemTile(st[i].food, null, { size: 'sm', extra: h('span', { class: 'tile__note', text: FOODS[st[i].food]?.effect }) })
            : h('button', { type: 'button', class: 'slot-add', onclick: () => openFoodSheet(state, 'session', commit) }, '＋ 吃東西'))),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--small', disabled: !st.length,
          onclick: () => { endSession(state); pushResult({ kind: 'note', text: '本次跑團結束，跑團胃袋已清空。' }); },
        }, '結束本次跑團')),
      h('p', { class: 'hint', text: '點技能就直接擲 1D20。GM 准許用生活技能時點生活技能，否則點非生活技能。' }),
      h('div', { class: 'skill-cols' },
        h('div', {},
          h('p', { class: 'field-label', text: '生活技能（加熟練）' }),
          h('div', { class: 'skill-grid' }, LIFE_SKILLS.map((s) => skillBtn(s, state.lifeSkills[s] ?? 0)))),
        h('div', {},
          h('p', { class: 'field-label', text: '非生活技能' }),
          h('div', { class: 'skill-grid' }, ART_SKILLS.map((s) => skillBtn(s, state.arts[s] ?? 0))))));
  }

  // ---------- 結果 ----------
  const lootTiles = (loot) =>
    h('div', { class: 'loot' }, Object.entries(loot).sort((x, y) => y[1] - x[1]).map(([n, q]) => itemTile(n, q, { size: 'sm' })));

  function resultCard(r, latest) {
    if (r.kind === 'note') return h('li', { class: 'result result--note', text: r.text });
    if (r.kind === 'session') {
      return h('li', { class: 'result' },
        h('div', { class: 'result__head' },
          h('span', { text: `🎲 ${r.skill}檢定` }),
          h('span', { class: 'result__big', dataset: { final: r.total, roll: latest ? '1' : '0' }, text: r.total })),
        h('p', { class: 'result__formula', text: `1D20（${r.roll}）+ ${r.mod}　${r.isLife ? '含熟練' : '不加熟練'}` }));
    }
    const gatherKind = r.kind === 'gather';
    if (!r.rolls.length) return h('li', { class: 'result result--note', text: gatherKind ? '時間不足，沒有採集。' : '原料不足，沒有製作。' });
    const best = gatherKind ? Math.max(...r.rolls.map((x) => TIERS.indexOf(x.tier))) : '';
    const ok = gatherKind ? 0 : r.rolls.filter((x) => x.success).length;
    const used = r.rolls.flatMap((x) => x.used);
    return h('li', { class: 'result', dataset: { tier: best } },
      h('div', { class: 'result__head' },
        h('span', { text: gatherKind ? `${ICONS[r.action]} ${r.action} ×${r.rolls.length}` : `${ICONS[r.action]} ${r.action}（${r.diff}）×${r.rolls.length}` }),
        h('span', { class: 'result__exp', text: gatherKind ? `經驗 +${fmt(r.exp)}` : `成功 ${ok} / ${r.rolls.length}` })),
      gatherKind && best >= 3 ? h('p', { class: 'result__flash', text: `擲出${TIERS[best]}！` }) : null,
      h('div', { class: 'dice-row' },
        r.rolls.map((x) => h('span', {
          class: 'die',
          dataset: { tier: gatherKind ? TIERS.indexOf(x.tier) : x.success ? 'ok' : 'fail', final: x.total, roll: latest ? '1' : '0' },
          title: `1D20（${x.roll}）+ ${x.mod} = ${x.total}${gatherKind ? `　${x.tier}` : x.success ? '　成功' : '　失敗'}`,
          text: x.total,
        }))),
      h('p', { class: 'dice-legend', text: gatherKind ? '數字是每一骰的總分，顏色是評級' : '數字是每一骰的總分，紅色是失敗' }),
      Object.keys(r.loot).length ? lootTiles(r.loot) : h('p', { class: 'hint', text: '全部失敗，原料全毀。' }),
      used.length ? h('p', { class: 'hint', text: `用掉紀念品 ${used.length} 個` }) : null);
  }

  /** 唯一的動畫：最新結果的數字先亂跳再定格 */
  function rollNumbers() {
    const els = root.querySelectorAll('[data-roll="1"]');
    if (!els.length || reduceMotion()) return;
    const start = performance.now();
    const tick = (t) => {
      const done = t - start > 450;
      els.forEach((el) => { el.textContent = done ? el.dataset.final : String(Math.floor(Math.random() * 40) + 1); });
      if (!done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- 組合 ----------
  function render() {
    const state = getState();
    const tabs = [['gather', '採集'], ['craft', '製作'], ['session', '跑團檢定']];
    const panel = ui.tab === 'gather' ? gatherPanel(state) : ui.tab === 'craft' ? craftPanel(state) : sessionPanel(state);
    const scrollY = root.scrollTop;
    const fresh = ui.fresh;
    ui.fresh = false;
    root.replaceChildren(
      statusBar(state, commit, ui.tab === 'session' ? 'session' : 'rest'),
      h('div', { class: 'rest-layout' },
        h('section', { class: 'card actions' },
          h('div', { class: 'tabs-seg', role: 'tablist' },
            tabs.map(([id, label]) => h('button', {
              type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(ui.tab === id),
              onclick: () => { ui.tab = id; ui.times = 1; render(); },
            }, label))),
          panel),
        h('section', { class: 'results', 'aria-live': 'polite' },
          h('h2', { class: 'section-title', text: '結果' }),
          ui.results.length
            ? h('ol', { class: 'result-list' }, ui.results.slice(0, 20).map((r, i) => resultCard(r, i === 0 && fresh)))
            : h('p', { class: 'empty', text: '選好行動後按下按鈕，戰利品會出現在這裡。' })))
    );
    root.scrollTop = scrollY;
    if (fresh) {
      rollNumbers();
      // 手機上結果在下方，按下後自動捲過去
      if (matchMedia('(max-width: 900px)').matches) {
        root.querySelector('.result')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      }
    }
  }

  return { render };
}
