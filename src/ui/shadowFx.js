// ============================================================
// 暗影斗篷特效（只是畫面，數值規則在 src/game/shadowCloak.js）：
//   enter  進入隱身：暗紫帷幕從四周合攏、斗篷從上方垂落、霧氣與暗影光點升起，中間浮出「暗影斗篷・隱身」
//   gather 每回合聚集：中央浮出「+N 能量傷害」與一圈暗影漣漪
//   fade   隱身時間到：帷幕輕輕散開
//   reveal 現身爆發：閃光與衝擊環、斗篷向兩側撕開，顯示「現身！+N 顆能量傷害骰」
// 不擋操作（點穿過去），約 2 秒自動消失；減少動態效果時只顯示文字。文字一律用 textContent。樣式在 src/styles/shadowfx.css。
// ============================================================
import { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

// 斗篷的一邊（左半，viewBox 300×600；右半用 flip 鏡像）：寬大的披風、下擺三個尖角、布褶線、發光的內緣
const WING = 'M0 0 H196 C250 70 288 160 272 262 C264 330 292 382 262 452 C250 484 262 528 238 600 L196 548 L152 600 L108 540 L62 600 L22 536 L0 572 Z';
const FOLDS = ['M30 0 C62 200 42 400 22 536', 'M88 0 C130 220 108 420 62 600', 'M146 0 C190 220 168 420 152 600', 'M200 0 C246 200 226 400 238 600'];
const wing = (side) => {
  const id = `sfx-g-${side}`;
  const inner = svg('g', side === 'r' ? { transform: 'translate(300 0) scale(-1 1)' } : {},
    svg('path', { d: WING, fill: `url(#${id})` }),
    ...FOLDS.map((d) => svg('path', { d, class: 'sfx__fold' })),
    svg('path', { d: 'M196 0 C250 70 288 160 272 262 C264 330 292 382 262 452 C250 484 262 528 238 600', class: 'sfx__rim' }));
  const grad = svg('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' },
    svg('stop', { offset: '0', class: 'sfx__stop sfx__stop--a' }), svg('stop', { offset: '0.7', class: 'sfx__stop sfx__stop--b' }), svg('stop', { offset: '1', class: 'sfx__stop sfx__stop--c' }));
  const el = svg('svg', { viewBox: '0 0 300 600', preserveAspectRatio: 'none', class: `sfx__cloak sfx__cloak--${side}`, 'aria-hidden': 'true' }, svg('defs', {}, grad), inner);
  return el;
};
// 兜帽人影（斗篷合攏時浮現）：兜帽、肩膀與兩道發光的眼縫
const figure = () => svg('svg', { viewBox: '0 0 200 400', class: 'sfx__figure', 'aria-hidden': 'true' },
  svg('path', { d: 'M100 24 C62 24 42 70 42 124 C42 176 22 236 0 400 H200 C178 236 158 176 158 124 C158 70 138 24 100 24 Z', class: 'sfx__body' }),
  svg('ellipse', { cx: '80', cy: '112', rx: '11', ry: '3.5', class: 'sfx__eye' }),
  svg('ellipse', { cx: '120', cy: '112', rx: '11', ry: '3.5', class: 'sfx__eye' }));

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
    wing('l'),
    wing('r'),
    figure(),
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
