// ============================================================
// 暗影斗篷特效（只是畫面，數值規則在 src/game/shadowCloak.js）：
//   enter  進入隱身：暗紫帷幕從四周合攏、斗篷從上方垂落、霧氣與暗影光點升起，中間浮出「暗影斗篷・隱身」
//   gather 每回合聚集：中央浮出「+N 能量傷害」與一圈暗影漣漪
//   fade   隱身時間到：帷幕輕輕散開
//   reveal 現身爆發：閃光與衝擊環、斗篷向兩側撕開，顯示「現身！+N 顆能量傷害骰」
// 不擋操作（點穿過去），約 2 秒自動消失；減少動態效果時只顯示文字。文字一律用 textContent。樣式在 src/styles/shadowfx.css。
// ============================================================
import { h } from './dom.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const WISPS = 16;
let current = null;

const TITLES = { enter: ['暗影斗篷', '隱身'], gather: [null, null], fade: ['隱身結束', ''], reveal: ['現身！', ''] };

/** kind = 'enter' | 'gather' | 'fade' | 'reveal'；n = 數字（聚集或爆發的能量傷害骰） */
export function playShadowFx(kind, { n = 0 } = {}) {
  current?.remove();
  const wisps = reduced() ? [] : Array.from({ length: WISPS }, (_, i) => h('span', {
    class: 'sfx__wisp', style: `--x:${Math.round(((i * 53) % 100) - 50)}vw;--d:${(i % 5) * 120}ms;--s:${6 + (i % 4) * 3}px;--r:${(i * 37) % 360}deg`,
  }));
  const [title, sub] = TITLES[kind] ?? ['', ''];
  const text = kind === 'gather' ? `+${n} 能量傷害` : kind === 'reveal' ? (n > 0 ? `爆發 ${n} 顆能量傷害骰` : '') : sub;
  const node = h('div', { class: 'sfx', dataset: { kind }, role: 'status', 'aria-live': 'polite', 'aria-label': `${title ?? ''}${text}` },
    h('div', { class: 'sfx__veil', 'aria-hidden': 'true' }),
    h('div', { class: 'sfx__cloak sfx__cloak--l', 'aria-hidden': 'true' }),
    h('div', { class: 'sfx__cloak sfx__cloak--r', 'aria-hidden': 'true' }),
    h('div', { class: 'sfx__mist', 'aria-hidden': 'true' }),
    h('div', { class: 'sfx__ring', 'aria-hidden': 'true' }),
    h('div', { class: 'sfx__flash', 'aria-hidden': 'true' }),
    h('div', { class: 'sfx__wisps', 'aria-hidden': 'true' }, wisps),
    h('div', { class: 'sfx__text' },
      title ? h('strong', { class: 'sfx__title', text: title }) : null,
      text ? h('span', { class: 'sfx__sub num', text }) : null));
  document.body.append(node);
  current = node;
  const ms = reduced() ? 1200 : kind === 'gather' ? 1500 : 2300;
  setTimeout(() => { node.dataset.phase = 'out'; }, ms - 450);
  setTimeout(() => { node.remove(); if (current === node) current = null; }, ms);
}
