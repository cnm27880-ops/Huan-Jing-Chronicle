// ============================================================
// 擲骰特效（只是畫面）：骰子翻滾 → 停在真正的點數 → 總和放大發光。1D20 擲出 20／1 有大成功／大失敗效果。
// 點數在呼叫前就已經擲好（伺服器或本機），這裡不擲骰。不擋操作（點穿過去），約 1.8 秒自動消失。
// 減少動態效果時直接顯示結果。文字一律用 textContent。
// ============================================================
import { h } from './dom.js';

const MAX_SHOWN = 6; // 最多畫幾顆，其餘寫「另 N 顆」
let current = null;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rand = (sides) => 1 + Math.floor(Math.random() * sides);

/**
 * faces：每顆骰子的點數；kept：優勢骰留下的那顆（可省略）；sides：面數；total：總和（含加值）；label：上方小字（例如「偵查檢定」「2D6+3」）
 */
export function playDiceFx({ faces, sides, total, label = '', kept }) {
  if (!Array.isArray(faces) || !faces.length) return;
  current?.remove();
  const single20 = sides === 20 && (faces.length === 1 || kept !== undefined); // 優勢骰（兩顆取高）：以留下的那顆判斷大成功／大失敗
  const key = kept ?? faces[0];
  const tone = single20 && key === 20 ? 'crit' : single20 && key === 1 ? 'fumble' : '';
  const shown = faces.slice(0, MAX_SHOWN);
  const dice = shown.map((n, i) => h('span', { class: 'dfx__die', dataset: { sides: String(sides) }, style: `--i:${i}`, text: String(rand(sides)) }));
  const totalEl = h('strong', { class: 'dfx__total num', text: String(total) });
  const node = h('div', { class: 'dfx', dataset: { tone, phase: 'roll' }, role: 'status', 'aria-live': 'polite', 'aria-label': `${label} 擲出 ${total}` },
    h('div', { class: 'dfx__burst', 'aria-hidden': 'true' }),
    h('p', { class: 'dfx__label', text: label }),
    h('div', { class: 'dfx__dice', 'aria-hidden': 'true' }, dice,
      faces.length > shown.length ? h('span', { class: 'dfx__more', text: `另 ${faces.length - shown.length} 顆` }) : null),
    totalEl,
    tone ? h('p', { class: 'dfx__tag', text: tone === 'crit' ? '大成功！' : '大失敗…' }) : null);
  document.body.append(node);
  current = node;

  const settle = () => {
    dice.forEach((d, i) => {
      d.textContent = String(shown[i]);
      d.dataset.max = shown[i] === sides ? '1' : '0';
      d.dataset.min = shown[i] === 1 ? '1' : '0';
    });
    node.dataset.phase = 'done';
  };
  if (reduced()) settle();
  else {
    // 翻滾：點數快速亂跳，越來越慢
    let t = 0;
    const steps = [40, 45, 50, 60, 70, 85, 100, 120, 150];
    const tick = () => {
      if (current !== node) return;
      if (t >= steps.length) { settle(); return; }
      dice.forEach((d) => { d.textContent = String(rand(sides)); });
      setTimeout(tick, steps[t++]);
    };
    tick();
  }
  setTimeout(() => { if (current === node) node.dataset.phase = 'out'; }, reduced() ? 1400 : 2100);
  setTimeout(() => { node.remove(); if (current === node) current = null; }, reduced() ? 1700 : 2500);
}
