// ============================================================
// 共用小元件：物品格、數量選擇器、提示訊息
// ============================================================
import { h, fmt } from './dom.js';
import { iconOf, tierOf, plainName, TIERS } from './items.js';
import { RollError } from '../state/rollLog.js';

/** 物品格：圖示 + 名稱 + 數量，左側色條代表稀有度 */
export function itemTile(name, qty, { onClick, size = 'md', extra } = {}) {
  const tier = tierOf(name);
  return h(onClick ? 'button' : 'div', {
    type: onClick ? 'button' : null,
    class: `tile tile--${size}`,
    dataset: { tier: tier ?? 'none' },
    title: tier !== null ? `${TIERS[tier]}級` : null,
    onclick: onClick,
  },
  h('span', { class: 'tile__icon', 'aria-hidden': 'true', text: iconOf(name) }),
  h('span', { class: 'tile__name', text: plainName(name) }),
  qty != null ? h('span', { class: 'tile__qty', text: `×${fmt(qty)}` }) : null,
  extra ?? null);
}

/**
 * 數量選擇器：快速按鈕 + 可直接輸入
 * 不用一下一下按：1 / 10 / 50 / 100 / 全部，也可以點數字直接改
 */
export function amountPicker({ value, max = Infinity, onChange, quick = [1, 10, 50, 100] }) {
  const clamp = (n) => Math.max(1, Math.min(Number.isFinite(max) ? max : n, Math.floor(n) || 1));
  const input = h('input', {
    class: 'amount__input', type: 'number', inputmode: 'numeric', min: 1,
    max: Number.isFinite(max) ? max : null, value, 'aria-label': '數量',
    onchange: (e) => onChange(clamp(Number(e.target.value))),
  });
  const btn = (label, n) =>
    h('button', {
      type: 'button', class: 'amount__chip', 'aria-pressed': String(value === n),
      onclick: () => onChange(clamp(n)),
    }, label);
  return h('div', { class: 'amount' },
    h('div', { class: 'amount__row' },
      h('button', { type: 'button', class: 'amount__step', 'aria-label': '減 1', onclick: () => onChange(clamp(value - 1)) }, '－'),
      input,
      h('button', { type: 'button', class: 'amount__step', 'aria-label': '加 1', onclick: () => onChange(clamp(value + 1)) }, '＋')),
    h('div', { class: 'amount__chips' },
      quick.filter((n) => !Number.isFinite(max) || n < max).map((n) => btn(String(n), n)),
      Number.isFinite(max) && max > 0 ? btn(`全部 ${fmt(max)}`, max) : null)
  );
}

let toastTimer;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) t = document.body.appendChild(h('div', { class: 'toast', role: 'status' }));
  t.textContent = msg;
  t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.dataset.show = 'false'), 2200);
}

/** 擲骰失敗（房間連線問題）時用：顯示原因；不是擲骰錯誤就原樣丟出去，不吞掉真正的 bug */
export function rollFailed(e) {
  if (e instanceof RollError) return toast(e.message);
  throw e;
}
