// 彈窗堆疊：層級排序、Esc 只關最上層、鎖定計畫（純函式），以及 tokens.css 的 z-index 要和 JS 的層級順序一致
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TIERS, insertIndex, decideEscape, inertPlan } from '../src/ui/modalStack.js';

const L = (tier, extra = {}) => ({ tier, modal: true, dismissible: true, ...extra });

test('層級：新的一層插在同層級或更低的後面，同層級先開的在下', () => {
  const stack = [L('sheet', { id: 1 }), L('confirm', { id: 2 })];
  assert.equal(insertIndex(stack, 'popover'), 1); // 比確認框低 → 插在它前面
  assert.equal(insertIndex(stack, 'sheet'), 1); // 同層級 → 排在舊的 sheet 後面
  assert.equal(insertIndex(stack, 'confirm'), 2); // 同層級 → 最上面
  assert.equal(insertIndex([], 'nudge'), 0);
  assert.throws(() => insertIndex(stack, 'nope'), /未知/);
});

test('Esc：只關最上層，其他層不受影響', () => {
  const sheet = L('sheet'); const reveal = L('reveal');
  const d = decideEscape([sheet, reveal]);
  assert.equal(d.consume, true);
  assert.equal(d.close, reveal);
});

test('Esc：戰鬥提醒在最上面時只吞掉，不關任何東西（底下的面板也不會被關）', () => {
  const sheet = L('sheet'); const nudge = L('nudge', { dismissible: false });
  assert.deepEqual(decideEscape([sheet, nudge]), { consume: true, close: null });
});

test('Esc：戰鬥提醒不在最上面（確認框更高）時，先關確認框', () => {
  const nudge = L('nudge', { dismissible: false }); const confirm = L('confirm');
  assert.equal(decideEscape([nudge, confirm]).close, confirm);
});

test('Esc：沒有任何彈窗、輸入法組字中、封面還在時，都不處理', () => {
  assert.equal(decideEscape([]).consume, false);
  assert.equal(decideEscape([L('sheet')], { composing: true }).consume, false);
  assert.equal(decideEscape([L('sheet')], { coverActive: true }).consume, false);
});

test('鎖定計畫：沒有 modal 不鎖；有 modal 鎖背景，並鎖住被最上面 modal 蓋住的其他層', () => {
  assert.deepEqual(inertPlan([]), { page: false, inertIdx: [] });
  assert.deepEqual(inertPlan([L('drawer', { modal: false })]), { page: false, inertIdx: [] }); // 抽屜、情報面板不鎖背景
  assert.deepEqual(inertPlan([L('sheet')]), { page: true, inertIdx: [] });
  assert.deepEqual(inertPlan([L('sheet'), L('popover')]), { page: true, inertIdx: [0] });
  // 貼在按鈕旁的確認框（不鎖背景）開在 sheet 上：sheet 還是最上面的 modal，不能被鎖
  assert.deepEqual(inertPlan([L('sheet'), L('confirm', { modal: false })]), { page: true, inertIdx: [] });
});

// ---------- tokens.css 的 z-index 要和 JS 的層級順序一致 ----------
const css = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8');
const tokens = Object.fromEntries([...css('tokens.css').matchAll(/--z-([a-z-]+):\s*(\d+)\s*;/g)].map((m) => [m[1], Number(m[2])]));

test('z-index：堆疊的六個層級，tokens.css 的數字由小到大和 TIERS 順序一致', () => {
  const nums = TIERS.map((t) => tokens[t]);
  assert.ok(nums.every((n) => Number.isInteger(n)), `tokens.css 缺少 --z-${TIERS.join('、--z-')} 其中一個`);
  assert.deepEqual([...nums].sort((a, b) => a - b), nums, `TIERS 順序 ${TIERS.join(' < ')} 和 tokens.css 不一致：${nums.join(', ')}`);
  assert.equal(new Set(nums).size, nums.length, '層級的數字不能重複');
});

test('z-index：通知在所有彈窗之下；特效與吐司在所有彈窗之上；封面最高', () => {
  const top = tokens.confirm;
  assert.ok(tokens.notice < tokens.sheet, '通知要在 sheet 之下');
  assert.ok(tokens['more-menu'] < tokens.sheet, '「更多」選單要在 sheet 之下（以前兩者同為 60）');
  assert.ok(tokens.fx > top + 1, '特效要在確認框（含它的 +1）之上');
  assert.ok(tokens.toast > tokens.fx, '吐司要在特效之上');
  assert.ok(tokens.cover > tokens.toast, '封面最高');
  assert.ok(tokens.tip > tokens.sheet && tokens.tip < tokens.popover, '技能提示在 sheet 之上、數值面板之下');
});

test('z-index：樣式檔裡 25 以上的 z-index 一律用 var(--z-…)，不再寫死數字', () => {
  const bad = [];
  for (const file of readdirSync(new URL('../src/styles/', import.meta.url)).filter((f) => f.endsWith('.css') && f !== 'tokens.css')) {
    for (const m of css(file).matchAll(/z-index:\s*(-?\d+)/g)) if (Number(m[1]) >= 25) bad.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});
