// ============================================================
// 鑑定開獎動畫：卡片一張張翻開、數值跳動，最後標出最好的一件。
// 只是畫面效果：數值在打開之前就已經擲好、存好了，關掉動畫不影響任何結果。
// 文字一律走 textContent（防 XSS）。系統設定「減少動態效果」時直接全部翻開。
// ============================================================
import { h, fmt } from './dom.js';
import { rarityTag } from './controls.js';

const MAX_CARDS = 12;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * cards：[{ tier, icon, name, body: 元素, badge: [文字, 'good'|'bad'|'neutral'], note }]
 * best：最好的那張在 cards 裡的位置；summary：最下面的一句話
 */
let closeCurrent = null;

export function openReveal({ title, cards, best = -1, summary = '' }) {
  closeCurrent?.();
  const shown = cards.slice(0, MAX_CARDS);
  const timers = [];

  const cardEls = shown.map((c, i) => h('li', {
    class: 'rv-card', dataset: { rarity: c.tier ?? 'none', tier: c.tier ?? 'none' },
    style: `--i:${i}`,
  },
  h('button', { type: 'button', class: 'rv-card__inner', 'aria-label': `翻開第 ${i + 1} 件`, onclick: () => flip(i) },
    h('span', { class: 'rv-face rv-back', 'aria-hidden': 'true' },
      h('span', { class: 'rv-back__gem' }),
      h('span', { class: 'rv-back__q', text: '?' })),
    h('span', { class: 'rv-face rv-front' },
      h('span', { class: 'rv-front__head' },
        h('span', { class: 'rv-front__icon', 'aria-hidden': 'true', text: c.icon }),
        h('strong', { class: 'rv-front__name rarity__name', text: c.name })),
      rarityTag(c.tier),
      c.body,
      c.note ? h('small', { class: 'rv-front__note', text: c.note }) : null,
      c.badge ? h('span', { class: 'badge', dataset: { tone: c.badge[1] }, text: c.badge[0] }) : null))));

  const skip = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => openAll() }, '全部翻開');
  const done = h('button', { type: 'button', class: 'btn btn--primary', onclick: close }, '收下');
  const foot = h('p', { class: 'reveal__summary', text: '' });
  const root = h('div', { class: 'reveal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'reveal__backdrop', onclick: close }),
    h('div', { class: 'reveal__panel' },
      h('p', { class: 'reveal__kicker', text: '鑑定開獎' }),
      h('h2', { class: 'reveal__title', text: title }),
      h('ol', { class: 'rv-grid', dataset: { count: Math.min(shown.length, 4) } }, cardEls),
      foot,
      h('div', { class: 'reveal__actions' }, skip, done)));

  const opened = new Set();
  function countUp(el) {
    el.querySelectorAll('[data-final]').forEach((n) => {
      const end = Number(n.dataset.final);
      if (reduceMotion() || !Number.isFinite(end)) { n.textContent = `+${fmt(end)}`; return; }
      const start = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - start) / 480);
        n.textContent = `+${fmt(Math.round(end * (1 - (1 - k) ** 3)))}`;
        if (k < 1 && n.isConnected) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  function flip(i) {
    if (opened.has(i)) return;
    opened.add(i);
    const el = cardEls[i];
    el.classList.add('is-open');
    el.querySelector('.rv-card__inner').setAttribute('aria-label', shown[i].name);
    countUp(el);
    if (opened.size === shown.length) finish();
  }
  function finish() {
    timers.forEach(clearTimeout);
    if (best >= 0 && best < cardEls.length) cardEls[best].classList.add('is-best');
    foot.textContent = summary;
    skip.hidden = true;
    done.focus();
  }
  function openAll() { shown.forEach((_, i) => flip(i)); }
  function close() {
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', onKey);
    root.remove();
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  // 開獎的數字先顯示 0，翻開時才跳到真正的數值
  root.querySelectorAll('[data-final]').forEach((n) => { n.textContent = '+0'; });
  document.body.append(root);
  document.addEventListener('keydown', onKey);
  skip.focus();
  if (reduceMotion()) { openAll(); return; }
  const gap = Math.max(140, Math.min(320, 2600 / shown.length)); // 張數越多翻得越快，總長約 3 秒內
  shown.forEach((_, i) => timers.push(setTimeout(() => flip(i), 500 + i * gap)));
}
