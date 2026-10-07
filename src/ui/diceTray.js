// ============================================================
// 骰盤：隨時可以從頂部列打開的抽屜，不用切換頁面。
// 一鍵技能檢定、自訂骰式（取代機器人 !投骰）、所有人的擲骰紀錄。
// 之後接上 Cloudflare：紀錄會變成「房間內所有玩家」共用（見 src/state/rollLog.js）。
// ============================================================
import { h } from './dom.js';
import { amountPicker, rollFailed } from './controls.js';
import { mountRoomPanel } from './roomPanel.js';
import { mountFeed } from './rollFeed.js';
import { openFoodSheet } from './statusBar.js';
import { LIFE_SKILLS, ART_SKILLS, STOMACH_SLOTS } from '../game/rules.js';
import { modifier, proficiency } from '../game/engine.js';
import { parseDiceExpr, MAX_DICE } from '../game/dice.js';
import { rollDice, rollCheck, clearLog, getRoomStatus } from '../state/rollLog.js';

const SIDES = [4, 6, 8, 10, 12, 20, 100];

export function createDiceTray({ getState, commit, toggleButton }) {
  const ui = { open: false, sides: 20, count: 1, mod: 0, text: '' };
  const node = h('aside', { class: 'tray', id: 'dice-tray', 'aria-label': '骰盤', 'aria-hidden': 'true', dataset: { open: 'false' } });
  document.body.append(node);
  let feeds = [];
  let roomPanel = null;

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

  // ---------- 組合 ----------
  function render() {
    const state = getState();
    feeds.forEach((f) => f.destroy());
    roomPanel?.destroy();
    const roomBox = h('div', { class: 'tray__room' });
    const latestBox = h('div', { class: 'tray__latest', 'aria-live': 'polite' });
    const historyBox = h('div', { class: 'tray__history' });
    const prof = proficiency(state, 'session');
    const stomach = state.sessionStomach;
    const scrollY = node.querySelector('.tray__body')?.scrollTop ?? 0;

    node.replaceChildren(
      h('header', { class: 'tray__head' },
        h('h2', { class: 'tray__heading', text: '骰盤' }),
        h('span', { class: 'tray__who', text: state.name }),
        h('button', { type: 'button', class: 'sheet__close', onclick: () => setOpen(false) }, '關閉')),
      roomBox, // 房間狀態：只有登入後才會出現
      latestBox, // 固定在上方：不管骰盤捲到哪裡，最新結果都看得到
      h('div', { class: 'tray__body' },
        h('section', { class: 'tray__section' },
          h('div', { class: 'tray__stomach' },
            h('span', { class: 'field-label', text: '跑團熟練' }),
            h('strong', { text: String(prof.total) }),
            h('span', { class: 'mini-slots' }, Array.from({ length: STOMACH_SLOTS }, (_, i) =>
              stomach[i]
                ? h('span', { class: 'mini-slot', title: stomach[i].food }, h('span', { 'aria-hidden': 'true', text: '🍽️' }))
                : h('button', {
                    type: 'button', class: 'mini-slot mini-slot--empty', 'aria-label': '空胃袋，點一下吃東西',
                    onclick: () => openFoodSheet(state, 'session', commit),
                  }, '＋')))),
          h('p', { class: 'hint', text: '點技能直接擲 1D20。GM 准許用生活技能時點生活技能（會加熟練），否則點非生活技能。' }),
          h('p', { class: 'field-label', text: '生活技能（加熟練）' }),
          h('div', { class: 'skill-grid' }, LIFE_SKILLS.map((s) => skillButton(state, s, state.lifeSkills[s] ?? 0, true))),
          h('p', { class: 'field-label', text: '非生活技能' }),
          h('div', { class: 'skill-grid' }, ART_SKILLS.map((s) => skillButton(state, s, state.arts[s] ?? 0, false)))),
        customPanel(),
        h('section', { class: 'tray__section' },
          h('div', { class: 'tray__title-row' },
            h('h3', { class: 'tray__title', text: '紀錄' }),
            getRoomStatus().phase === 'online'
              ? h('span', { class: 'hint', text: '房間共用，保存最近 200 筆' })
              : h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (confirm('清空這台裝置上的擲骰紀錄？')) clearLog(); } }, '清空')),
          historyBox)));
    roomPanel = mountRoomPanel(roomBox);
    feeds = [mountFeed(latestBox, { limit: 1, empty: '按下任何一顆骰子，結果會出現在這裡。' }), mountFeed(historyBox, { limit: 30, skip: 1, empty: '' })];
    const body = node.querySelector('.tray__body');
    if (body) body.scrollTop = scrollY;
  }

  function setOpen(open) {
    ui.open = open;
    node.dataset.open = String(open);
    node.setAttribute('aria-hidden', String(!open));
    toggleButton?.setAttribute('aria-expanded', String(open));
    if (open) render();
  }

  toggleButton?.addEventListener('click', () => setOpen(!ui.open));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.open) setOpen(false); });

  return { refresh: () => { if (ui.open) render(); }, open: () => setOpen(true), close: () => setOpen(false) };
}
