// ============================================================
// 修整日頁面（黑金版，見 DESIGN.md）
// 設計原則：全程用點的，不用打字；狀態列常駐在上方。
// 版面：上方 HUD → 兩個行動分頁 → 左邊一步步設定（行動、難度、次數與加值）＋大按鈕，右邊結果。
// 只改畫面：採集、製作、檢定都還是呼叫 engine.js 的同一批函式。
// ============================================================
import { h, fmt } from './dom.js';
import { statusBar } from './statusBar.js';
import { itemTile, amountPicker } from './controls.js';
import { iconOf, TIERS } from './items.js';
import {
  GATHER_ACTIONS, CRAFT_ACTIONS, DIFFICULTIES, RECIPES,
  CRAFT_COST_AMOUNT,
} from '../game/rules.js';
import {
  modifier, gather, craft, craftableTimes, keepsakeApplies, countOf,
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
  const pushResult = (r) => { ui.results.unshift(r); ui.results.length = Math.min(ui.results.length, 20); ui.fresh = true; commit(); };

  // ---------- 共用 ----------
  const section = (title, ...children) => h('section', { class: 'card rest-step' }, h('h2', { class: 'section-title', text: title }), ...children);

  /** 加值：大數字＋每一項來源 */
  function modLine(mod) {
    return h('div', { class: 'mod-line' },
      h('span', { class: 'mod-line__label', text: '加值' }),
      h('strong', { class: 'mod-line__value num', text: `+${mod.total}` }),
      h('span', { class: 'mod-line__parts' }, mod.parts.map((p) => h('span', { class: 'mod-chip' }, `${p.label} `, h('b', { class: 'num', text: `+${p.value}` })))));
  }

  function keepsakeToggles(state, action) {
    const usable = Object.entries(state.keepsakes).filter(([n, d]) => keepsakeApplies(d, action) && countOf(state, n) > 0);
    [...ui.keepsakes].forEach((n) => { if (!usable.some(([u]) => u === n)) ui.keepsakes.delete(n); });
    if (!usable.length) return null;
    return h('div', { class: 'rest-field' },
      h('p', { class: 'field-label', text: '使用紀念品（每次檢定各消耗 1 個）' }),
      h('div', { class: 'keepsake-row' },
        usable.map(([n, d]) =>
          h('button', {
            type: 'button', class: 'keepsake', 'aria-pressed': String(ui.keepsakes.has(n)), title: d.desc,
            onclick: () => { ui.keepsakes.has(n) ? ui.keepsakes.delete(n) : ui.keepsakes.add(n); render(); },
          },
          h('span', { class: 'keepsake__icon', 'aria-hidden': 'true', text: iconOf(n) }),
          h('span', { class: 'keepsake__text' }, h('strong', { text: n }), h('small', { text: `+${d.bonus}　剩 ${fmt(countOf(state, n))}` })),
          h('span', { class: 'keepsake__check', 'aria-hidden': 'true', text: ui.keepsakes.has(n) ? '✓' : '' })))));
  }

  /** 行動卡：圖示、名稱、技能等級、目前加值 */
  function actionCards(state, list, current, onPick) {
    return h('div', { class: 'action-cards', role: 'radiogroup' },
      list.map((a) => h('button', {
        type: 'button', class: 'action-card', role: 'radio', 'aria-checked': String(a === current),
        onclick: () => onPick(a),
      },
      h('span', { class: 'action-card__icon', 'aria-hidden': 'true', text: ICONS[a] }),
      h('span', { class: 'action-card__name', text: a }),
      h('span', { class: 'action-card__sub', text: `技能 ${state.lifeSkills[a] ?? 0}` }),
      h('span', { class: 'action-card__mod num', text: `+${modifier(state, a, 'rest').total}` }))));
  }

  /** 次數＋紀念品＋加值，最後是大按鈕 */
  function runBlock(state, a, { label, hint, max, quick, onRun }) {
    const mod = modifier(state, a, 'rest', [...ui.keepsakes]);
    return [
      section('次數與加值',
        h('div', { class: 'rest-field' },
          h('p', { class: 'field-label', text: hint }),
          amountPicker({ value: ui.times, max, quick, onChange: (n) => { ui.times = n; render(); } })),
        keepsakeToggles(state, a),
        modLine(mod)),
      h('div', { class: 'rest-go' },
        h('button', { type: 'button', class: 'btn btn--primary btn--go', onclick: onRun }, label)),
    ];
  }

  // ---------- 採集 ----------
  function gatherPanel(state) {
    const a = ui.gatherAction;
    const max = state.time;
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    return [
      section('選擇採集', actionCards(state, GATHER_ACTIONS, a, (x) => { ui.gatherAction = x; render(); }),
        h('p', { class: 'hint', text: '每次擲 1D20 + 加值，總分決定評級（簡單～神級），評級越高抽到的東西越好。' })),
      ...(max <= 0
        ? [h('p', { class: 'notice notice--bad', text: '今天的時間用完了。點上方的「新的一天」恢復 10 點。' })]
        : runBlock(state, a, {
            label: `${ICONS[a]} ${a} ${ui.times} 次`, hint: `每次 1 點時間，今天還剩 ${max} 點`, max, quick: [1, 3, 5],
            onRun: () => pushResult({ kind: 'gather', action: a, ...gather(state, a, ui.times, [...ui.keepsakes]) }),
          })),
    ];
  }

  // ---------- 製作 ----------
  function craftPanel(state) {
    const a = ui.craftAction;
    const d = ui.craftDiff;
    const recipe = RECIPES[a][d];
    const max = craftableTimes(state, a, d);
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    return [
      section('選擇製作', actionCards(state, CRAFT_ACTIONS, a, (x) => { ui.craftAction = x; render(); })),
      section('難度與配方',
        h('div', { class: 'diff-grid', role: 'radiogroup' },
          DIFFICULTIES.map((x, i) => {
            const r = RECIPES[a][x];
            const n = craftableTimes(state, a, x);
            return h('button', {
              type: 'button', class: `diff${n ? '' : ' is-none'}`, role: 'radio', 'aria-checked': String(x === d), dataset: { tier: i },
              onclick: () => { ui.craftDiff = x; render(); },
            },
            h('span', { class: 'diff__head' }, h('strong', { text: x }), h('span', { class: 'diff__dc num', text: `DC ${r.dc}` })),
            h('span', { class: 'diff__cost' }, h('span', { 'aria-hidden': 'true', text: iconOf(r.cost) }), ` ${r.cost} ×${CRAFT_COST_AMOUNT}`),
            h('span', { class: 'diff__can', text: n ? `可做 ${fmt(n)} 次` : `只有 ${fmt(countOf(state, r.cost))} 個` }));
          })),
        h('div', { class: 'reward-line' },
          h('p', { class: 'field-label', text: `成功時從這些抽 ${recipe.count} 個` }),
          h('div', { class: 'reward-line__tiles' }, recipe.rewards.map((r) => itemTile(r, null, { size: 'sm' }))))),
      ...(max <= 0
        ? [h('p', { class: 'notice notice--bad', text: `${recipe.cost}不足 ${CRAFT_COST_AMOUNT} 個，先去採集吧。` })]
        : runBlock(state, a, {
            label: `${ICONS[a]} ${a}（${d}）${ui.times} 次`, hint: '製作不消耗時間', max, quick: [1, 5, 10],
            onRun: () => pushResult({ kind: 'craft', action: a, diff: d, ...craft(state, a, d, ui.times, [...ui.keepsakes]) }),
          })),
    ];
  }

  // ---------- 結果 ----------
  const lootTiles = (loot) =>
    h('div', { class: 'loot' }, Object.entries(loot).sort((x, y) => y[1] - x[1]).map(([n, q]) => itemTile(n, q, { size: 'sm' })));

  /** 結果卡：和擲骰紀錄同一種樣式（左側色條、右上膠囊徽章、六角骰面） */
  function resultCard(r, latest) {
    if (r.kind === 'note') return h('li', { class: 'rres rres--note', text: r.text });
    const gatherKind = r.kind === 'gather';
    if (!r.rolls.length) return h('li', { class: 'rres rres--note', text: gatherKind ? '時間不足，沒有採集。' : '原料不足，沒有製作。' });
    const best = gatherKind ? Math.max(...r.rolls.map((x) => TIERS.indexOf(x.tier))) : -1;
    const ok = gatherKind ? 0 : r.rolls.filter((x) => x.success).length;
    const used = r.rolls.flatMap((x) => x.used);
    const tone = gatherKind ? 'tier' : ok > 0 ? 'ok' : 'fail';
    return h('li', { class: 'rres', dataset: { tone, tier: gatherKind ? best : 'none' } },
      h('div', { class: 'rres__head' },
        h('strong', { class: 'rres__title', text: gatherKind ? `${ICONS[r.action]} ${r.action} ×${r.rolls.length}` : `${ICONS[r.action]} ${r.action}（${r.diff}）×${r.rolls.length}` }),
        h('span', { class: 'rres__badge', dataset: { tone } , text: gatherKind ? `經驗 +${fmt(r.exp)}` : `成功 ${ok} / ${r.rolls.length}` })),
      gatherKind && best >= 3 ? h('p', { class: 'rres__flash', text: `擲出${TIERS[best]}！` }) : null,
      h('div', { class: 'dice-faces' },
        r.rolls.map((x) => h('span', {
          class: 'die',
          dataset: { tier: gatherKind ? TIERS.indexOf(x.tier) : x.success ? 'ok' : 'fail', final: x.total, roll: latest ? '1' : '0' },
          title: `1D20（${x.roll}）+ ${x.mod} = ${x.total}${gatherKind ? `　${x.tier}` : x.success ? '　成功' : '　失敗'}`,
          text: x.total,
        }))),
      h('p', { class: 'dice-legend', text: gatherKind ? '每一骰的總分；顏色是評級（綠 簡單、藍 普通、紫 困難、金 史詩、白 神級）' : '每一骰的總分；藍色成功、紅色失敗' }),
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
  const TABS = [
    ['gather', '採集', '🌿', '花時間'],
    ['craft', '製作', '🔨', '不花時間'],
  ];

  function render() {
    const state = getState();
    const panel = ui.tab === 'gather' ? gatherPanel(state) : craftPanel(state);
    const scrollY = root.scrollTop;
    const fresh = ui.fresh;
    ui.fresh = false;
    root.replaceChildren(
      h('div', { class: 'rest-root' },
        statusBar(state, commit, 'rest'),
        h('div', { class: 'rest-tabs', role: 'tablist', 'aria-label': '修整日行動' },
          TABS.map(([id, label, icon, sub]) => h('button', {
            type: 'button', role: 'tab', class: 'rest-tab', 'aria-selected': String(ui.tab === id),
            onclick: () => { ui.tab = id; ui.times = 1; render(); },
          },
          h('span', { class: 'rest-tab__icon', 'aria-hidden': 'true', text: icon }),
          h('span', { class: 'rest-tab__name', text: label }),
          h('small', { class: 'rest-tab__sub', text: sub })))),
        h('div', { class: 'rest-grid' },
          h('div', { class: 'rest-main' }, panel),
          h('section', { class: 'card rest-results', 'aria-live': 'polite' },
            h('div', { class: 'battle-head' },
              h('h2', { class: 'section-title', text: '結果' }),
              ui.results.length ? h('span', { class: 'hint', text: `最近 ${Math.min(ui.results.length, 20)} 筆` }) : null),
            ui.results.length
              ? h('ol', { class: 'rres-list' }, ui.results.slice(0, 20).map((r, i) => resultCard(r, i === 0 && fresh)))
              : h('p', { class: 'empty', text: '選好行動後按下按鈕，戰利品會出現在這裡。' }))))
    );
    root.scrollTop = scrollY;
    if (fresh) {
      const first = root.querySelector('.rres');
      if (first) first.dataset.fresh = '1'; // 只有新結果播進場動畫，其他重畫不閃
      rollNumbers();
      // 手機上結果在下方，按下後自動捲過去
      if (matchMedia('(max-width: 759px)').matches) {
        first?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      }
    }
  }

  return { render };
}
