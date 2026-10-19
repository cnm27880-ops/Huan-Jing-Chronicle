// ============================================================
// 跑團頁（#session）：固定三欄工作台（版面規格見 DESIGN.md「跑團頁」）。
//   左欄：個人 HUD（生命、資源、防禦三軌、狀態）＋ 分頁：招式／生活技能／探索檢定（battleView.js）
//   中欄：遭遇戰舞台：先攻軸、BOSS、小怪矩陣、選目標、隊友血量、GM 工具（encounterCard.js）
//   右欄：房間、擲骰紀錄（新的在下、自動捲到底）、快速擲骰
// 電腦（≥1100px）三欄各自捲動；901–1099px 左欄改成底部抽屜；≤900px 紀錄當主畫面，
// 左欄與中欄都變成底部抽屜（招式／藥水／檢定／目標），頂部是膠囊 HUD 與目標血量。
// 紀錄是「房間內所有玩家」共用（見 src/state/rollLog.js）。
// ============================================================
import { createPartyPanel } from './partyBars.js';
import { askConfirm } from './confirmPop.js';
import { pushLayer } from './modalStack.js';
import { h } from './dom.js';
import { rollFailed, toast } from './controls.js';
import { mountRoomPanel } from './roomPanel.js';
import { mountFeed, readFaces } from './rollFeed.js';
import { playDiceFx } from './diceFx.js';
import { openFoodSheet } from './statusBar.js';
import { LIFE_SKILLS, ART_SKILLS, STOMACH_SLOTS } from '../game/rules.js';
import { modifier, proficiency, endSession, countOf, removeItem, FOOD_BAG, foodBagSlots, foodBags, spitToBag, takeFromBag } from '../game/engine.js';
import { parseDiceExpr, MAX_DICE } from '../game/dice.js';
import { rollDice, rollCheck, clearLog, getRoomStatus, subscribeRoom, getEncounter } from '../state/rollLog.js';
import { iconOf } from './items.js';
import { createEncounterCard } from './encounterCard.js';
import { createBattleView, isBattleEvent } from './battleView.js';
import { battleSel as sel } from './battleSelect.js';

const SIDES = [4, 6, 8, 10, 12, 20, 100];
const DICE_FOLD_KEY = 'huanjing:dice:collapsed:v1';
const readDiceCollapsed = () => { try { return localStorage.getItem(DICE_FOLD_KEY) === '1'; } catch { return false; } }; // 只有手機看得到收合鈕；讀不到就當展開
const MOBILE_MQ = '(max-width: 900px)'; // 收合只在手機有效（電腦沒有收合鈕，不能卡在收合）
const saveDiceCollapsed = (v) => { try { localStorage.setItem(DICE_FOLD_KEY, v ? '1' : '0'); } catch { /* 存不了就算了，下次照預設 */ } };
const LEFT_TABS = [['moves', '招式'], ['items', '藥水與狀態'], ['skills', '技能檢定']];
// 跑團紀錄只放「檢定、自訂骰、戰鬥」；鑑定、黑市、鑲嵌、GM 異動等都在「日誌」頁
const sessionEvent = (e) => e.kind === 'check' || e.kind === 'dice' || isBattleEvent(e);
const LOG_EMPTY = '按下任何一顆骰子，或出招、承受攻擊，結果會出現在這裡。';

export function createSessionView({ root, getState, commit }) {
  const ui = {
    leftTab: 'moves',
    sheet: '', // 手機／平板目前打開的抽屜：'' | 'left' | 'center'
    hudOpen: false, // 手機膠囊 HUD 是否展開
    sides: 20, count: 1, mod: 0, text: '',
    diceCollapsed: readDiceCollapsed(), // 手機骰盤收合成一條投骰鈕
    adv: false, // 下一次技能檢定用優勢骰（會消耗一個「張亮的驚人發現」這類紀念品）
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
  // 資源條：第一張是自己（樣式比照隊友卡＋三防，可點開調整面板；手機改用頂部膠囊 HUD），後面是隊友（玩家端；GM 不顯示隊友）
  const party = createPartyPanel({ selfCard: () => battle.selfMate(getState()) });
  const right = h('aside', { class: 'sx-col sx-right', 'aria-label': '紀錄與擲骰' }, top, party.node, roomDetails, feedHead, feedBox, diceBox);
  const barBtn = (id, label, controls) => h('button', {
    type: 'button', class: 'sx-bar__btn', dataset: { id }, 'aria-controls': controls, 'aria-expanded': 'false',
    onclick: () => openSheet(id),
  }, label);
  const bar = h('nav', { class: 'sx-bar', 'aria-label': '跑團快捷' },
    barBtn('moves', '招式', 'sx-left'), barBtn('items', '藥水', 'sx-left'), barBtn('skills', '檢定', 'sx-left'), barBtn('targets', '目標', 'sx-center'));
  const scrim = h('div', { class: 'sx-scrim', 'aria-hidden': 'true', onclick: () => setSheet('') });
  const wrap = h('div', { class: 'sx', dataset: { sheet: '' } }, left, center, right, scrim, bar);

  let mounted = false;
  let feed = null;
  let roomPanel = null;
  let unsubRoom = null;
  let roomSig = '';
  let mobileMq = null;
  let deferred = false; // 正在中欄輸入框打字時，房間更新先不重畫（免得打到一半的數字不見），離開輸入框再畫
  const typingIn = (el) => el.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
  center.addEventListener('focusout', () => setTimeout(() => {
    if (!deferred || !mounted || typingIn(center)) return;
    deferred = false;
    renderCenter();
  }, 0));

  // ---------- 抽屜（手機、平板） ----------
  let drawerLayer = null; // 抽屜開著時在 modalStack 佔一層（不鎖背景）：上面有別的視窗時，Esc 先關上面的
  function setSheet(sheet) {
    ui.sheet = sheet;
    wrap.dataset.sheet = sheet;
    if (sheet && !drawerLayer) drawerLayer = pushLayer({ tier: 'drawer', modal: false, close: () => setSheet('') });
    else if (!sheet && drawerLayer) { drawerLayer.remove(); drawerLayer = null; }
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

  // ---------- 左欄：技能檢定 ----------
  /** 有「優勢骰」效果、背包還有的紀念品名稱（沒有就 null） */
  const advantageItem = (state) => Object.entries(state.keepsakes ?? {}).find(([n, d]) => d.advantage && countOf(state, n) > 0)?.[0] ?? null;

  async function checkSkill(skill) {
    const state = getState();
    const item = ui.adv ? advantageItem(state) : null;
    try {
      const r = await rollCheck(state.name, state, skill, Boolean(item));
      if (item && removeItem(state, item)) { ui.adv = false; commit(); } // 擲成功才消耗
      playDiceFx({ faces: r.rolls ?? [r.roll], kept: r.rolls ? r.roll : undefined, sides: 20, total: r.total, label: `${skill}檢定` });
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
    const bagSlots = foodBagSlots(state);
    const bagged = foodBags(state);
    return h('section', { class: 'sx-sec skillpanel' },
      h('h2', { class: 'section-title', text: '技能檢定' }),
      h('p', { class: 'hint', text: '點一下直接擲 1D20 ＋ 加值，結果在右邊紀錄。' }),
      advantageItem(state)
        ? h('button', {
            type: 'button', class: 'keepsake', 'aria-pressed': String(ui.adv), title: state.keepsakes[advantageItem(state)].desc,
            onclick: () => { ui.adv = !ui.adv; renderLeft(); },
          },
          h('span', { class: 'keepsake__text' }, h('strong', { text: `${advantageItem(state)}（優勢骰）` }), h('small', { text: `下一次檢定擲兩顆 D20 取高　剩 ${countOf(state, advantageItem(state))}` })),
          h('span', { class: 'keepsake__check', 'aria-hidden': 'true', text: ui.adv ? '✓' : '' }))
        : null,
      h('div', { class: 'tray__stomach' },
        h('span', { class: 'field-label', text: '跑團熟練' }),
        h('strong', { text: String(prof.total) }),
        h('span', { class: 'mini-slots' }, Array.from({ length: STOMACH_SLOTS }, (_, i) =>
          stomach[i]
            ? (bagSlots
                ? h('button', { // 有保溫針織袋：點一下吐進袋子
                    type: 'button', class: 'mini-slot', title: `${stomach[i].food}（點一下吐進${FOOD_BAG}）`, 'aria-label': `${stomach[i].food}，點一下吐進${FOOD_BAG}`,
                    onclick: () => { const food = stomach[i].food; const e = spitToBag(state, i); if (e) return toast(e); toast(`${food}吐進${FOOD_BAG}了。`); commit(); },
                  }, h('span', { 'aria-hidden': 'true', text: iconOf(stomach[i].food) || '食' }))
                : h('span', { class: 'mini-slot', title: stomach[i].food }, h('span', { 'aria-hidden': 'true', text: iconOf(stomach[i].food) || '食' })))
            : h('button', {
                type: 'button', class: 'mini-slot mini-slot--empty', 'aria-label': '空胃袋，點一下吃東西',
                onclick: () => openFoodSheet(state, 'session', commit),
              }, '＋')))),
      bagRow(state),
      stomach.length || bagged.length
        ? h('button', {
            type: 'button', class: 'btn btn--ghost btn--small',
            onclick: async (e) => {
              const lines = ['跑團胃袋會清空。', ...(bagged.length ? [`${FOOD_BAG}裡的料理也會清空：${bagged.map((s) => s.food).join('、')}`] : [])];
              if (!(await askConfirm(e.currentTarget, { title: '結束本次跑團？', lines, okText: '結束', danger: true }))) return;
              endSession(state); commit();
            },
          }, '結束本次跑團')
        : null,
      h('p', { class: 'field-label', text: '生活技能（技能 ＋ 跑團熟練）' }),
      h('div', { class: 'skill-grid' }, LIFE_SKILLS.map((s) => skillButton(state, s, state.lifeSkills[s] ?? 0, true))),
      h('p', { class: 'field-label', text: '非生活技能' }),
      h('div', { class: 'skill-grid' }, ART_SKILLS.map((s) => skillButton(state, s, state.arts[s] ?? 0, false))));
  }

  /**
   * 福瑞保溫針織袋（跑團胃袋下方）：背包有幾個就幾格。上面胃袋的料理點一下＝吐進袋子；這裡的料理點一下＝放回胃袋。
   * 結束本次跑團時，袋子裡的料理全部清空（engine.js 的 endSession）
   */
  function bagRow(state) {
    const slots = foodBagSlots(state);
    const bagged = foodBags(state);
    if (!slots && !bagged.length) return null;
    const n = Math.max(slots, bagged.length);
    return h('div', { class: 'tray__stomach' },
      h('span', { class: 'field-label', title: '點胃袋的料理吐進袋子；點袋子的料理放回胃袋', text: `保溫袋 ${bagged.length}/${slots}` }),
      h('span', { class: 'mini-slots' }, Array.from({ length: n }, (_, i) => {
        const s = bagged[i];
        if (!s) return h('span', { class: 'mini-slot mini-slot--empty', title: `空的${FOOD_BAG}（點上面胃袋的料理吐進來）`, 'aria-label': `空的${FOOD_BAG}` }, '·');
        return h('button', {
          type: 'button', class: 'mini-slot', title: `${s.food}（點一下放回胃袋；結束本次跑團時清空）`,
          'aria-label': `${s.food}，點一下放回跑團胃袋`, disabled: state.sessionStomach.length >= STOMACH_SLOTS ? true : null,
          onclick: () => { const e = takeFromBag(state, i); if (e) return toast(e); commit(); },
        }, h('span', { 'aria-hidden': 'true', text: iconOf(s.food) || '食' }));
      })));
  }

  function renderLeft() {
    const state = getState();
    const y = left.scrollTop;
    const tabs = h('div', { class: 'sx-tabs tabs-seg', role: 'tablist', 'aria-label': '左欄分頁' }, LEFT_TABS.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', class: 'tabs-seg__tab', 'aria-selected': String(ui.leftTab === id),
      onclick: () => { ui.leftTab = id; renderLeft(); setSheet(ui.sheet); },
    }, label)));
    const panel = ui.leftTab === 'skills'
      ? skillPanel(state)
      : ui.leftTab === 'items'
        ? h('div', { class: 'sx-stack' }, battle.potionCard(state), battle.statusCard(state))
        : battle.moveCard(state);
    left.replaceChildren(
      h('div', { class: 'sx-sheethead' },
        h('span', { class: 'sx-sheethead__grip', 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'sheet__close', onclick: () => setSheet('') }, '收起')),
      tabs, panel);
    left.scrollTop = y;
  }

  // ---------- 中欄與手機頂部 ----------
  function renderCenter() {
    const y = center.scrollTop;
    center.replaceChildren(...[
      h('div', { class: 'sx-sheethead' },
        h('span', { class: 'sx-sheethead__grip', 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'sheet__close', onclick: () => setSheet('') }, '收起')),
      stage.render(),
      battle.fireBar(getState())].filter(Boolean)); // 手機：目標抽屜底部的「選招式＋出招」列
    center.scrollTop = y;
    const n = sel.targets.length;
    bar.querySelector('[data-id="targets"]').textContent = n ? `目標（${n}）` : '目標';
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
    feed = mountFeed(feedBox, { limit: 60, oldestFirst: true, filter: sessionEvent, empty: LOG_EMPTY });
  }

  /** 只剩本機模式的「清空」按鈕；房間模式沒有東西，整列收起來把位置留給紀錄 */
  function renderFeedHead() {
    const local = getRoomStatus().phase !== 'online';
    feedHead.hidden = !local;
    feedHead.replaceChildren(...(local
      ? [h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: async (e) => { if (await askConfirm(e.currentTarget, { title: '清空這台裝置上的擲骰紀錄？', okText: '清空', danger: true })) clearLog(); } }, '清空紀錄')]
      : []));
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


  /**
   * 快速擲骰，兩層：第一層骰型（D4～D100，單列、放不下就橫向捲動）；第二層「顆、加減、自訂骰式、投骰」同一列，
   * 標籤改成輸入框裡的提示字。手機（≤900px）可收合成只剩一條投骰鈕，展開／收合記在這台裝置。
   */
  function renderDice() {
    const expr = expression();
    const folded = ui.diceCollapsed && window.matchMedia(MOBILE_MQ).matches;
    const rollTitle = () => (expression().error ? '骰式格式不對' : `擲 ${expression().text}`);
    diceBox.dataset.collapsed = folded ? '1' : '0';
    const rollBtn = h('button', { type: 'button', class: 'btn btn--primary sx-dice__roll', disabled: Boolean(expr.error), title: rollTitle(), onclick: rollCustom }, folded ? `投骰 ${expr.error ? '' : expr.text}` : '投骰');
    const fold = h('button', {
      type: 'button', class: 'btn btn--quiet btn--small sx-dice__fold', 'aria-expanded': String(!ui.diceCollapsed), 'aria-label': ui.diceCollapsed ? '展開骰盤' : '收合骰盤',
      onclick: () => { ui.diceCollapsed = !ui.diceCollapsed; saveDiceCollapsed(ui.diceCollapsed); renderDice(); },
    }, ui.diceCollapsed ? '展開' : '收合');
    if (folded) { diceBox.replaceChildren(h('div', { class: 'sx-dice__row sx-dice__row--fold' }, fold, rollBtn)); return; }
    diceBox.replaceChildren(
      h('div', { class: 'sx-dice__top' },
        h('div', { class: 'sx-dice__sides', role: 'radiogroup', 'aria-label': '骰子面數' }, SIDES.map((n) => h('button', {
          type: 'button', class: 'sx-side', role: 'radio', 'aria-checked': String(!ui.text.trim() && ui.sides === n),
          onclick: () => { ui.sides = n; ui.text = ''; renderDice(); },
        }, `D${n}`))),
        fold),
      h('div', { class: 'sx-dice__row' },
        h('input', {
          class: 'field sx-dice__n', type: 'number', inputmode: 'numeric', min: 1, max: MAX_DICE, value: ui.count, placeholder: '顆', title: '幾顆', 'aria-label': '幾顆',
          onchange: (e) => { ui.count = Math.min(MAX_DICE, Math.max(1, Math.trunc(Number(e.target.value)) || 1)); ui.text = ''; renderDice(); },
        }),
        h('input', {
          class: 'field sx-dice__n', type: 'number', inputmode: 'numeric', value: ui.mod || '', placeholder: '加減', title: '加減值', 'aria-label': '加減值',
          onchange: (e) => { ui.mod = Math.trunc(Number(e.target.value)) || 0; ui.text = ''; renderDice(); },
        }),
        h('input', {
          class: 'field sx-dice__expr', type: 'text', placeholder: '或輸入 2D6+3', value: ui.text, autocomplete: 'off', 'aria-label': '直接輸入骰式',
          oninput: (e) => {
            ui.text = e.target.value;
            const ex = expression();
            rollBtn.disabled = Boolean(ex.error);
            rollBtn.title = rollTitle();
            diceBox.querySelectorAll('.sx-dice__sides .sx-side').forEach((c) => c.setAttribute('aria-checked', String(!ui.text.trim() && c.textContent === `D${ui.sides}`)));
          },
          onkeydown: (e) => { if (e.key === 'Enter') rollCustom(); },
        }),
        rollBtn));
  }

  function renderRoomSummary() {
    const r = getRoomStatus();
    roomDetails.hidden = r.phase === 'local';
    const online = r.members.filter((m) => m.online).length;
    // 標題列：房間・N / M 人在線　GM 某某〔暫代〕（GM 不另外佔一整排）
    const nameOf = (uid) => r.gm.names[uid] ?? r.members.find((m) => m.uid === uid)?.name ?? '（尚未加入）';
    const gmText = r.gm.uids.length ? r.gm.uids.map(nameOf).join('、') : '未設定';
    roomSummary.textContent = r.phase === 'online' ? `房間・${online} / ${r.members.length} 人在線　GM ${gmText}${r.gm.override ? '〔暫代〕' : ''}` : r.phase === 'denied' ? '房間（本機模式）' : '房間（連線中…）';
  }

  /** 中欄要重畫的房間狀態：變了才重畫（打字中的左欄表單不受隊友狀態更新影響） */
  const sigOf = () => {
    const r = getRoomStatus();
    return JSON.stringify([r.phase, r.me?.isGm, getEncounter(), r.images, r.vitals, r.hiddenVitals, r.members.map((m) => [m.uid, m.online]), r.gm?.uids]);
  };

  // ---------- 組合 ----------
  function render() {
    if (!mounted) {
      mounted = true;
      root.replaceChildren(wrap);
      roomPanel = mountRoomPanel(roomBox);
      mountLog();
      renderDice();
      mobileMq = window.matchMedia(MOBILE_MQ);
      mobileMq.addEventListener('change', renderDice); // 轉直橫、改視窗寬度：收合狀態跟著套用或解除
      roomSig = sigOf();
      unsubRoom = subscribeRoom(() => {
        renderRoomSummary();
        const sig = sigOf();
        if (sig === roomSig) return;
        const before = sel.targets.join();
        roomSig = sig;
        if (typingIn(center)) deferred = true; else renderCenter();
        renderTop();
        party.render();
        if (sel.targets.join() !== before) renderLeft(); // 目標倒下或被移除：左欄「出招」按鈕的目標文字跟著更新
        renderFeedHead();
      });
    }
    renderRoomSummary();
    renderFeedHead();
    party.render();
    renderCenter();
    renderLeft();
    renderTop();
    setSheet(ui.sheet);
  }

  /** 離開跑團頁：停掉紀錄與房間的自動更新，背景擲骰時不用重畫看不到的畫面 */
  function leave() {
    unsubRoom?.(); unsubRoom = null;
    mobileMq?.removeEventListener('change', renderDice); mobileMq = null;
    feed?.destroy(); feed = null;
    roomPanel?.destroy(); roomPanel = null;
    setSheet('');
    mounted = false;
  }

  return { render, leave };
}
