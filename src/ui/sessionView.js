// ============================================================
// 跑團頁（原本的骰盤抽屜，階段 B 改成獨立分頁 #session）：
// 房間資訊、一鍵技能檢定、跑團胃袋、自訂骰式（取代機器人 !投骰）、遭遇戰、所有人的擲骰紀錄。
// 紀錄是「房間內所有玩家」共用（見 src/state/rollLog.js）。
// ============================================================
import { h } from './dom.js';
import { amountPicker, rollFailed } from './controls.js';
import { mountRoomPanel } from './roomPanel.js';
import { mountFeed } from './rollFeed.js';
import { openFoodSheet } from './statusBar.js';
import { LIFE_SKILLS, ART_SKILLS, STOMACH_SLOTS } from '../game/rules.js';
import { modifier, proficiency, endSession } from '../game/engine.js';
import { parseDiceExpr, MAX_DICE } from '../game/dice.js';
import { rollDice, rollCheck, clearLog, getRoomStatus, subscribeRoom, getEncounter } from '../state/rollLog.js';
import { iconOf } from './items.js';
import { createEncounterCard } from './encounterCard.js';
import { createBattleView, isBattleEvent } from './battleView.js';

const SIDES = [4, 6, 8, 10, 12, 20, 100];

export function createSessionView({ root, getState, commit }) {
  const ui = { sides: 20, count: 1, mod: 0, text: '', battleOpen: false };
  const node = root;
  let feeds = [];
  let roomPanel = null;
  let encBox = null;
  let unsubRoom = null;
  let encSig = '';
  const encounter = createEncounterCard({ getState, commit, rerender: () => render() });

  // 戰鬥面板：原本的戰鬥頁（生命與資源、招式、藥水、狀態）改成跑團頁裡的懸浮面板，隨時可以打開
  const panelBody = h('div', { class: 'battle-float__body' });
  const battle = createBattleView({ root: panelBody, getState, commit });
  const panel = h('aside', { class: 'battle-float', 'aria-label': '戰鬥面板', 'aria-hidden': 'true', dataset: { open: 'false' } },
    h('header', { class: 'battle-float__head' },
      h('h2', { class: 'tray__heading', text: '戰鬥面板' }),
      h('button', { type: 'button', class: 'sheet__close', onclick: () => setBattleOpen(false) }, '關閉')),
    panelBody);
  const toggle = h('button', { type: 'button', class: 'btn btn--primary battle-float__toggle', 'aria-expanded': 'false', onclick: () => setBattleOpen(!ui.battleOpen) }, '⚔️ 戰鬥面板');

  function setBattleOpen(open) {
    ui.battleOpen = open;
    panel.dataset.open = String(open);
    panel.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    if (open) battle.render(); else battle.leave();
  }

  // ---------- 一鍵技能檢定 ----------
  async function checkSkill(skill) {
    const state = getState();
    try { await rollCheck(state.name, state, skill); } catch (e) { rollFailed(e); }
  }

  function skillButton(state, skill, value, isLife) {
    const mod = modifier(state, skill, 'session');
    return h('button', { type: 'button', class: 'skill-btn', onclick: () => checkSkill(skill) },
      h('span', { class: 'skill-btn__name', text: skill }),
      h('span', { class: 'skill-btn__mod', text: `+${mod.total}` }),
      h('small', { text: isLife ? `${value} + 熟練` : `技能 ${value}` }));
  }

  // ---------- 自訂骰 ----------
  function expression() {
    if (ui.text.trim()) return parseDiceExpr(ui.text);
    return parseDiceExpr(`${ui.count}D${ui.sides}${ui.mod ? (ui.mod > 0 ? '+' : '') + ui.mod : ''}`);
  }

  async function rollCustom() {
    const state = getState();
    const expr = expression();
    if (expr.error) return;
    try { await rollDice(state.name, expr); } catch (e) { rollFailed(e); }
  }

  function customPanel() {
    const expr = expression();
    return h('section', { class: 'tray__section' },
      h('h3', { class: 'tray__title', text: '自訂骰' }),
      h('div', { class: 'chip-row', role: 'radiogroup', 'aria-label': '骰子面數' },
        SIDES.map((n) => h('button', {
          type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(!ui.text.trim() && ui.sides === n),
          onclick: () => { ui.sides = n; ui.text = ''; render(); },
        }, `D${n}`))),
      h('p', { class: 'field-label', text: '幾顆' }),
      amountPicker({ value: ui.count, max: MAX_DICE, quick: [1, 2, 3, 5, 10], onChange: (n) => { ui.count = n; ui.text = ''; render(); } }),
      h('div', { class: 'row tray__mod' },
        h('label', { class: 'field-label', for: 'tray-mod', text: '加減值' }),
        h('input', {
          id: 'tray-mod', class: 'field', type: 'number', inputmode: 'numeric', value: ui.mod,
          onchange: (e) => { ui.mod = Math.trunc(Number(e.target.value)) || 0; ui.text = ''; render(); },
        })),
      h('div', { class: 'row tray__mod' },
        h('label', { class: 'field-label', for: 'tray-expr', text: '或直接輸入' }),
        h('input', {
          id: 'tray-expr', class: 'field', type: 'text', placeholder: '例如 2D6+3', value: ui.text, autocomplete: 'off',
          oninput: (e) => {
            ui.text = e.target.value;
            const btn = node.querySelector('.tray__roll');
            const ex = expression();
            btn.disabled = Boolean(ex.error);
            btn.textContent = ex.error ? '格式不對' : `🎲 擲 ${ex.text}`;
          },
          onkeydown: (e) => { if (e.key === 'Enter') rollCustom(); },
        })),
      h('button', {
        type: 'button', class: 'btn btn--primary btn--go tray__roll', disabled: Boolean(expr.error), onclick: rollCustom,
      }, expr.error ? '格式不對' : `🎲 擲 ${expr.text}`));
  }

  /** 遭遇戰畫面相關的房間狀態：變了才需要重畫（presence 之類的更新不用） */
  const encounterSig = () => `${getRoomStatus().phase}|${getRoomStatus().me?.isGm ? 1 : 0}|${JSON.stringify(getEncounter())}`;

  // ---------- 組合 ----------
  function render() {
    const state = getState();
    feeds.forEach((f) => f.destroy());
    roomPanel?.destroy();
    const roomBox = h('div', { class: 'tray__room' });
    encBox = h('div', { class: 'session-encounter' }, encounter.render());
    encSig = encounterSig();
    unsubRoom?.();
    unsubRoom = subscribeRoom(() => { // 房間的遭遇戰（敵人、先攻）有變才重畫這一塊，不動別的
      const sig = encounterSig();
      if (sig !== encSig) { encSig = sig; encBox.replaceChildren(encounter.render()); }
    });
    const latestBox = h('div', { class: 'tray__latest', 'aria-live': 'polite' });
    const historyBox = h('div', { class: 'tray__history' });
    const battleLogBox = h('div', { class: 'tray__history' });
    const prof = proficiency(state, 'session');
    const stomach = state.sessionStomach;
    const scrollY = root.scrollTop;

    node.replaceChildren(panel, toggle, h('div', { class: 'session-root' },
      h('header', { class: 'tray__head' },
        h('h2', { class: 'tray__heading', text: '跑團' }),
        h('span', { class: 'tray__who', text: state.name })),
      roomBox, // 房間狀態：只有登入後才會出現
      h('div', { class: 'tray__body' },
        latestBox, // 最新結果放在內容最上面，跟著一起捲動（不再釘在畫面上佔空間）
        h('section', { class: 'tray__section' },
          h('div', { class: 'tray__stomach' },
            h('span', { class: 'field-label', text: '跑團熟練' }),
            h('strong', { text: String(prof.total) }),
            h('span', { class: 'mini-slots' }, Array.from({ length: STOMACH_SLOTS }, (_, i) =>
              stomach[i]
                ? h('span', { class: 'mini-slot', title: stomach[i].food }, h('span', { 'aria-hidden': 'true', text: iconOf(stomach[i].food) || '🍽️' }))
                : h('button', {
                    type: 'button', class: 'mini-slot mini-slot--empty', 'aria-label': '空胃袋，點一下吃東西',
                    onclick: () => openFoodSheet(state, 'session', commit),
                  }, '＋')))),
          stomach.length
            ? h('button', {
                type: 'button', class: 'btn btn--ghost btn--small',
                onclick: () => { if (!confirm('結束本次跑團？跑團胃袋會清空。')) return; endSession(state); commit(); },
              }, '結束本次跑團')
            : null,
          h('p', { class: 'field-label', text: '生活技能（加熟練）' }),
          h('div', { class: 'skill-grid' }, LIFE_SKILLS.map((s) => skillButton(state, s, state.lifeSkills[s] ?? 0, true))),
          h('p', { class: 'field-label', text: '非生活技能' }),
          h('div', { class: 'skill-grid' }, ART_SKILLS.map((s) => skillButton(state, s, state.arts[s] ?? 0, false)))),
        customPanel(),
        encBox,
        h('section', { class: 'tray__section' },
          h('h3', { class: 'tray__title', text: '戰鬥紀錄' }),
          battleLogBox),
        h('section', { class: 'tray__section' },
          h('div', { class: 'tray__title-row' },
            h('h3', { class: 'tray__title', text: '紀錄' }),
            getRoomStatus().phase === 'online'
              ? h('span', { class: 'hint', text: '房間共用，保存最近 200 筆' })
              : h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (confirm('清空這台裝置上的擲骰紀錄？')) clearLog(); } }, '清空')),
          historyBox))));
    roomPanel = mountRoomPanel(roomBox);
    feeds = [mountFeed(battleLogBox, { limit: 10, filter: isBattleEvent, empty: '出招、承受攻擊或喝藥水後，戰鬥紀錄會出現在這裡。' }), mountFeed(latestBox, { limit: 1, empty: '按下任何一顆骰子，結果會出現在這裡。' }), mountFeed(historyBox, { limit: 30, skip: 1, empty: '' })];
    root.scrollTop = scrollY;
    if (ui.battleOpen) battle.render(); // 戰鬥面板開著：資料有變就一起更新
  }

  /** 離開跑團頁：停掉紀錄的自動更新，背景擲骰時不用重畫看不到的清單 */
  function leave() {
    unsubRoom?.();
    unsubRoom = null;
    battle.leave();
    feeds.forEach((f) => f.destroy());
    feeds = [];
    roomPanel?.destroy();
    roomPanel = null;
  }

  return { render, leave };
}
