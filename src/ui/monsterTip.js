// ============================================================
// 怪物詳細資料浮動窗：電腦滑鼠移上去就顯示，手機長按（約 0.45 秒）顯示。
// 一律用 textContent 放文字。樣式 .skill-tip（pages.css）共用，.mtip 是裡面的表格。
// ============================================================
import { h, fmt } from './dom.js';
import { TRACKS } from '../game/rules.js';
import { monsterAbs, monsterAtk, monsterDef, isDowned, BOSS_ATK_MODES, BOSS_DEF_MODES } from '../game/combat.js';
import { ENEMY_RANKS, rankOf } from '../game/enemy.js';

const LONG_PRESS_MS = 450;
const TOUCH_SHOW_MS = 5000;
let tip = null;
let hideTimer = null;
let watch = null; // 浮動窗的來源元素被重畫掉（滑鼠沒有觸發離開）時，定時檢查並收起

const abcText = (abc) => TRACKS.map((t) => `${t} ${fmt(abc[t] ?? 0)}`).join('　');

/** 浮動窗內容：名稱、等級、生命、三攻三防（BOSS 三種模式都列）、絕對防禦 */
export function monsterTipBody(m) {
  const info = ENEMY_RANKS[rankOf(m)];
  const boss = m.kind === 'boss';
  const rows = [];
  if (boss) {
    BOSS_ATK_MODES.forEach((name, i) => rows.push(['攻 ' + name, abcText(monsterAtk(m, i))]));
    BOSS_DEF_MODES.forEach((name, i) => rows.push(['防 ' + name, abcText(monsterDef(m, i))]));
  } else {
    rows.push(['攻擊', abcText(monsterAtk(m))], ['防禦', abcText(monsterDef(m))]);
  }
  if (monsterAbs(m)) rows.push(['絕對防禦', fmt(monsterAbs(m))]);
  return [
    h('strong', { text: `${m.id}（${info.label}・每回合 ${info.attacks} 打）` }),
    h('p', { text: `生命 ${fmt(m.hp)} / ${fmt(m.maxHp)}${isDowned(m) ? '（已倒下）' : ''}` }),
    h('div', { class: 'mtip' }, rows.map(([k, v]) => h('div', { class: 'mtip__row' }, h('span', { class: 'mtip__k', text: k }), h('span', { class: 'num', text: v })))),
  ];
}

function showTip(el, getMonster) {
  const m = getMonster();
  if (!m) return;
  if (!tip) {
    tip = h('div', { class: 'skill-tip', role: 'tooltip' });
    document.body.append(tip);
  }
  clearTimeout(hideTimer);
  tip.replaceChildren(...monsterTipBody(m));
  tip.dataset.show = '1';
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const below = r.bottom + 8 + hgt <= innerHeight;
  tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  tip.style.top = `${Math.max(8, below ? r.bottom + 8 : r.top - 8 - hgt)}px`;
  clearInterval(watch);
  watch = setInterval(() => { if (!el.isConnected) hideTip(); }, 250);
}
const hideTip = () => { clearTimeout(hideTimer); clearInterval(watch); if (tip) tip.dataset.show = '0'; };

/**
 * 掛在一個元素上：getMonster() 每次顯示時才呼叫（拿到最新數值）。
 * 長按顯示後，放開手指不會觸發點擊（不會誤選目標）；點別處或 5 秒後收起。
 */
export function attachMonsterTip(el, getMonster) {
  el.dataset.mtip = '1';
  let timer = null;
  let longPressed = false;
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(el, getMonster); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    longPressed = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      longPressed = true;
      showTip(el, getMonster);
      hideTimer = setTimeout(hideTip, TOUCH_SHOW_MS);
    }, LONG_PRESS_MS);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && (Math.abs(e.movementX) > 6 || Math.abs(e.movementY) > 6)) cancel(); });
  el.addEventListener('contextmenu', (e) => { if (longPressed) e.preventDefault(); });
  el.addEventListener('click', (e) => { if (longPressed) { e.stopImmediatePropagation(); e.preventDefault(); longPressed = false; } }, true);
}

document.addEventListener('pointerdown', (e) => { if (!tip || tip.dataset.show !== '1' || e.pointerType === 'mouse') return; if (!e.target.closest?.('[data-mtip]')) hideTip(); }, { passive: true });
