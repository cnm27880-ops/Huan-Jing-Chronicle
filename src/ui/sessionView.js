// ============================================================
// 跑團頁（#session）：固定三欄工作台（版面規格見 DESIGN.md「跑團頁」）。
//   左欄：個人 HUD（生命、資源、防禦三軌、狀態）＋ 分頁：招式／生活技能／探索檢定（battleView.js）
//   中欄：遭遇戰舞台：先攻軸、BOSS、小怪矩陣、選目標、隊友血量、GM 工具（encounterCard.js）
//   右欄：房間、擲骰紀錄（新的在下、自動捲到底）、快速擲骰
// 電腦（≥1100px）三欄各自捲動；901–1099px 左欄改成底部抽屜；≤900px 紀錄當主畫面，
// 左欄與中欄都變成底部抽屜（⚔️ 招式／🌿 技能／🎯 目標），頂部是膠囊 HUD 與目標血量。
// 紀錄是「房間內所有玩家」共用（見 src/state/rollLog.js）。
// ============================================================
import { h } from './dom.js';
import { rollFailed } from './controls.js';
import { mountRoomPanel } from './roomPanel.js';
import { mountFeed, readFaces } from './rollFeed.js';
import { playDiceFx } from './diceFx.js';
import { openFoodSheet } from './statusBar.js';
import { LIFE_SKILLS, ART_SKILLS, STOMACH_SLOTS } from '../game/rules.js';
import { modifier, proficiency, endSession } from '../game/engine.js';
import { parseDiceExpr, MAX_DICE } from '../game/dice.js';
import { rollDice, rollCheck, clearLog, getRoomStatus, subscribeRoom, getEncounter } from '../state/rollLog.js';
import { iconOf } from './items.js';
import { createEncounterCard } from './encounterCard.js';
import { createBattleView, isBattleEvent } from './battleView.js';
import { battleSel as sel } from './battleSelect.js';

const SIDES = [4, 6, 8, 10, 12, 20, 100];
const LEFT_TABS = [['moves', '⚔️ 招式'], ['items', '🧪 藥水與狀態'], ['skills', '🎲 技能檢定']];
// 紀錄篩選：[id, 按鈕文字, 滑過時的說明]
const LOG_FILTERS = [
  ['all', '全部', '所有紀錄（房間共用，保存最近 200 筆）'],
  ['roll', '🎲 擲骰', '技能檢定、自訂骰，以及鑑定、黑市等其他結果'],
  ['battle', '⚔️ 戰鬥', '出招、承受攻擊、喝藥水、遭遇戰（新增敵人、先攻）'],
];
const LOG_FILTER_FN = {
  all: null,
  roll: (e) => e.kind !== 'audit' && !isBattleEvent(e),
  battle: isBattleEvent,
};
const LOG_EMPTY = {
  all: '按下任何一顆骰子，結果會出現在這裡。',
  roll: '還沒有檢定或擲骰。左邊「技能檢定」或下面的骰子都可以擲。',
  battle: '出招、承受攻擊或喝藥水後，戰鬥紀錄會出現在這裡。',
};

export function createSessionView({ root, getState, commit }) {
  const ui = {
    leftTab: 'moves',
    logFilter: 'all',
    sheet: '', // 手機／平板目前打開的抽屜：'' | 'left' | 'center'
    hudOpen: false, // 手機膠囊 HUD 是否展開
    sides: 20, count: 1, mod: 0, text: '',
  };
  const stage = createEncounterCard({ getState, commit, rerender: () => render() });
  const battle = createBattleView({
    getState, commit, rerender: () => render(), onFire: () => stage.attack(), fireInfo: () => stage.fireInfo(),
  });

  // ---------- 固定骨架（只建一次；重畫時換各欄內容，紀錄與房間區塊不重建，捲動位置不會跳） ----------
  const left = h('aside', { class: 'sx-col sx-left', id: 'sx-left', 'aria-label': '角色與招式' });
  const center = h('section', { class: 'sx-col sx-center', id: 'sx-center', 'aria-label': '戰鬥舞台' });
  const top = h('div', { class: 'sx-top' }); // 手機：膠囊 HUD ＋ 目標血量
  const roomBox = h('div', { class: 'sx-room__body' });
  const roomSummary = h('summary', { class: 'sx-room__sum', text: '房間' });
  const roomDetails = h('details', { class: 'sx-room' }, roomSummary, roomBox);
  const feedHead = h('div', { class: 'sx-feedhead' });
  const feedBox = h('div', { class: 'sx-feed', role: 'log', 'aria-label': '擲骰紀錄' });
  const diceBox = h('div', { class: 'sx-dice' });
  const right = h('aside', { class: 'sx-col sx-right', 'aria-label': '紀錄與擲骰' }, top, roomDetails, feedHead, feedBox, diceBox);
  const barBtn = (id, label, controls) => h('button', {
    type: 'button', class: 'sx-bar__btn', dataset: { id }, 'aria-controls': controls, 'aria-expanded': 'false',
    onclick: () => openSheet(id),
  }, label);
  const bar = h('nav', { class: 'sx-bar', 'aria-label': '跑團快捷' },
    barBtn('moves', '⚔️ 招式', 'sx-left'), barBtn('items', '🧪 藥水', 'sx-left'), barBtn('skills', '🎲 檢定', 'sx-left'), barBtn('targets', '🎯 目標', 'sx-center'));
  const scrim = h('div', { class: 'sx-scrim', 'aria-hidden': 'true', onclick: () => setSheet('') });
  const wrap = h('div', { class: 'sx', dataset: { sheet: '' } }, left, center, right, scrim, bar);

  let mounted = false;
  let feed = null;
  let roomPanel = null;
  let unsubRoom = null;
  let roomSig = '';
  let deferred = false; // 正在中欄輸入框打字時，房間更新先不重畫（免得打到一半的數字不見），離開輸入框再畫
  const typingIn = (el) => el.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
  center.addEventListener('focusout', () => setTimeout(() => {
    if (!deferred || !mounted || typingIn(center)) return;
    deferred = false;
    renderCenter();
  }, 0));

  // ---------- 抽屜（手機、平板） ----------
  function setSheet(sheet) {
    ui.sheet = sheet;
    wrap.dataset.sheet = sheet;
    bar.querySelectorAll('.sx-bar__btn').forEach((b) => {
      const on = (b.dataset.id === 'targets' && sheet === 'center') || (sheet === 'left' && b.dataset.id === ui.leftTab);
      b.setAttribute('aria-expanded', String(on));
    });
  }
  function openSheet(id) {
    if (id === 'targets') return setSheet(ui.sheet === 'center' ? '' : 'center');
    if (ui.sheet === 'left' && ui.leftTab === id) return setSheet(''); // 再按一次同一顆：收起
    if (id !== ui.leftTab) { ui.leftTab = id; renderLeft(); }
    setSheet('left');
    left.scrollTop = 0;
    return undefined;
  }
  const onKey = (e) => { if (e.key === 'Escape' && ui.sheet) setSheet(''); };

  // ---------- 左欄：技能檢定 ----------
  async function checkSkill(skill) {
    const state = getState();
    try {
      const r = await rollCheck(state.name, state, skill);
      playDiceFx({ faces: [r.roll], sides: 20, total: r.total, label: `${skill}檢定` });
    } catch (e) { rollFailed(e); }
  }

  function skillButton(state, skill, value, isLife) {
    const mod = modifier(state, skill, 'session');
    return h('button', { type: 'button', class: 'skill-btn', onclick: () => checkSkill(skill) },
      h('span', { class: 'skill-btn__name', text: skill }),
      h('span', { class: 'skill-btn__mod', text: `+${mod.total}` }),
      h('small', { text: isLife ? `${value} + 熟練` : `技能 ${value}` }));
  }

  /** 技能檢定：生活技能（加跑團熟練，含跑團胃袋）＋非生活技能，點一下直接檢定 */
  function skillPanel(state) {
    const prof = proficiency(state, 'session');
    const stomach = state.sessionStomach;
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '技能檢定' }),
      h('p', { class: 'hint', text: '點一下直接擲 1D20 ＋ 加值，結果在右邊紀錄。' }),
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
      h('p', { class: 'field-label', text: '生活技能（技能 ＋ 跑團熟練）' }),
      h('div', { class: 'skill-grid' }, LIFE_SKILLS.map((s) => skillButton(state, s, state.lifeSkills[s] ?? 0, true))),
      h('p', { class: 'field-label', text: '非生活技能' }),
      h('div', { class: 'skill-grid' }, ART_SKILLS.map((s) => skillButton(state, s, state.arts[s] ?? 0, false))));
  }

  function renderLeft() {
    const state = getState();
    const y = left.scrollTop;
    const tabs = h('div', { class: 'sx-tabs', role: 'tablist', 'aria-label': '左欄分頁' }, LEFT_TABS.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', class: 'sx-tab', 'aria-selected': String(ui.leftTab === id),
      onclick: () => { ui.leftTab = id; renderLeft(); setSheet(ui.sheet); },
    }, label)));
    const panel = ui.leftTab === 'skills'
      ? skillPanel(state)
      : ui.leftTab === 'items'
        ? h('div', { class: 'sx-stack' }, battle.potionCard(state), battle.statusCard(state), battle.defenseCard(state))
        : battle.moveCard(state);
    left.replaceChildren(
      h('div', { class: 'sx-left__hud' }, battle.hud(state)),
      h('div', { class: 'sx-sheethead' },
        h('span', { class: 'sx-sheethead__grip', 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'sheet__close', onclick: () => setSheet('') }, '收起')),
      tabs, panel);
    left.scrollTop = y;
  }

  // ---------- 中欄與手機頂部 ----------
  function renderCenter() {
    const y = center.scrollTop;
    center.replaceChildren(
      h('div', { class: 'sx-sheethead' },
        h('span', { class: 'sx-sheethead__grip', 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'sheet__close', onclick: () => setSheet('') }, '收起')),
      stage.render());
    center.scrollTop = y;
    const n = sel.targets.length;
    bar.querySelector('[data-id="targets"]').textContent = n ? `🎯 目標（${n}）` : '🎯 目標';
  }

  function renderTop() {
    const state = getState();
    top.replaceChildren(...[
      battle.miniHud(state, { open: ui.hudOpen, onToggle: () => { ui.hudOpen = !ui.hudOpen; renderTop(); } }),
      ui.hudOpen ? h('div', { class: 'sx-top__hud' }, battle.hud(state)) : null,
      stage.targetStrip()].filter(Boolean)); // replaceChildren 會把 null 變成文字，要先濾掉
  }

  // ---------- 右欄：紀錄與快速擲骰 ----------
  function mountLog() {
    feed?.destroy();
    feed = mountFeed(feedBox, { limit: 60, oldestFirst: true, filter: LOG_FILTER_FN[ui.logFilter], empty: LOG_EMPTY[ui.logFilter] });
  }

  function renderFeedHead() {
    feedHead.replaceChildren(...[ // replaceChildren 會把 null 變成文字「null」，要先濾掉
      h('div', { class: 'tabs-seg', role: 'tablist', 'aria-label': '紀錄類型' }, LOG_FILTERS.map(([id, label, tip]) => h('button', {
        type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(ui.logFilter === id), title: tip,
        onclick: () => { ui.logFilter = id; renderFeedHead(); mountLog(); },
      }, label))),
      getRoomStatus().phase === 'online'
        ? null
        : h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (confirm('清空這台裝置上的擲骰紀錄？')) clearLog(); } }, '清空')].filter(Boolean));
  }

  function expression() {
    if (ui.text.trim()) return parseDiceExpr(ui.text);
    return parseDiceExpr(`${ui.count}D${ui.sides}${ui.mod ? (ui.mod > 0 ? '+' : '') + ui.mod : ''}`);
  }

  async function rollCustom() {
    const expr = expression();
    if (expr.error) return;
    try {
      const ev = await rollDice(getState().name, expr);
      const f = ev && readFaces(ev);
      if (f) playDiceFx({ faces: f.faces, sides: f.sides, total: ev.big, label: f.formula });
    } catch (e) { rollFailed(e); }
  }


  /** 快速擲骰：骰子面數、顆數、加減值，或直接輸入骰式 */
  function renderDice() {
    const expr = expression();
    const rollBtn = h('button', { type: 'button', class: 'btn btn--primary sx-dice__roll', disabled: Boolean(expr.error), title: expr.error ? '骰式格式不對' : `擲 ${expr.text}`, onclick: rollCustom }, '🎲 投骰');
    diceBox.replaceChildren(
      h('div', { class: 'sx-dice__sides', role: 'radiogroup', 'aria-label': '骰子面數' }, SIDES.map((n) => h('button', {
        type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(!ui.text.trim() && ui.sides === n),
        onclick: () => { ui.sides = n; ui.text = ''; renderDice(); },
      }, `D${n}`))),
      h('div', { class: 'sx-dice__row' },
        h('label', { class: 'sx-dice__f' }, h('span', { text: '顆' }),
          h('input', {
            class: 'field', type: 'number', inputmode: 'numeric', min: 1, max: MAX_DICE, value: ui.count, 'aria-label': '幾顆',
            onchange: (e) => { ui.count = Math.min(MAX_DICE, Math.max(1, Math.trunc(Number(e.target.value)) || 1)); ui.text = ''; renderDice(); },
          })),
        h('label', { class: 'sx-dice__f' }, h('span', { text: '加減' }),
          h('input', {
            class: 'field', type: 'number', inputmode: 'numeric', value: ui.mod, 'aria-label': '加減值',
            onchange: (e) => { ui.mod = Math.trunc(Number(e.target.value)) || 0; ui.text = ''; renderDice(); },
          })),
        h('input', {
          class: 'field sx-dice__expr', type: 'text', placeholder: '或輸入 2D6+3', value: ui.text, autocomplete: 'off', 'aria-label': '直接輸入骰式',
          oninput: (e) => {
            ui.text = e.target.value;
            const ex = expression();
            rollBtn.disabled = Boolean(ex.error);
            rollBtn.title = ex.error ? '骰式格式不對' : `擲 ${ex.text}`;
            diceBox.querySelectorAll('.sx-dice__sides .chip').forEach((c) => c.setAttribute('aria-checked', String(!ui.text.trim() && c.textContent === `D${ui.sides}`)));
          },
          onkeydown: (e) => { if (e.key === 'Enter') rollCustom(); },
        }),
        rollBtn));
  }

  function renderRoomSummary() {
    const r = getRoomStatus();
    roomDetails.hidden = r.phase === 'local';
    const online = r.members.filter((m) => m.online).length;
    roomSummary.textContent = r.phase === 'online' ? `房間・${online} / ${r.members.length} 人在線` : r.phase === 'denied' ? '房間（本機模式）' : '房間（連線中…）';
  }

  /** 中欄要重畫的房間狀態：變了才重畫（打字中的左欄表單不受隊友狀態更新影響） */
  const sigOf = () => {
    const r = getRoomStatus();
    return JSON.stringify([r.phase, r.me?.isGm, getEncounter(), r.images, r.vitals, r.members.map((m) => [m.uid, m.online]), r.gm?.uids]);
  };

  // ---------- 組合 ----------
  function render() {
    if (!mounted) {
      mounted = true;
      root.replaceChildren(wrap);
      roomPanel = mountRoomPanel(roomBox);
      mountLog();
      renderDice();
      document.addEventListener('keydown', onKey);
      roomSig = sigOf();
      unsubRoom = subscribeRoom(() => {
        renderRoomSummary();
        const sig = sigOf();
        if (sig === roomSig) return;
        const before = sel.targets.join();
        roomSig = sig;
        if (typingIn(center)) deferred = true; else renderCenter();
        renderTop();
        if (sel.targets.join() !== before) renderLeft(); // 目標倒下或被移除：左欄「出招」按鈕的目標文字跟著更新
        renderFeedHead();
      });
    }
    renderRoomSummary();
    renderFeedHead();
    renderCenter();
    renderLeft();
    renderTop();
    setSheet(ui.sheet);
  }

  /** 離開跑團頁：停掉紀錄與房間的自動更新，背景擲骰時不用重畫看不到的畫面 */
  function leave() {
    unsubRoom?.(); unsubRoom = null;
    feed?.destroy(); feed = null;
    roomPanel?.destroy(); roomPanel = null;
    document.removeEventListener('keydown', onKey);
    setSheet('');
    mounted = false;
  }

  return { render, leave };
}
