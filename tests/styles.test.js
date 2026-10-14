// 樣式規則守門員：色碼只能寫在 theme.css；按鈕與輸入框的外觀與高度只能寫在 base.css（其他檔案只能管它在版面裡的位置）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../src/styles/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.css'));
const read = (f) => readFileSync(new URL(f, DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('色碼只能寫在 theme.css（其他 CSS 檔用 var(--…) 或 rgba(var(--…-rgb), 透明度)）', () => {
  const bad = [];
  for (const f of files.filter((x) => x !== 'theme.css')) {
    const s = read(f);
    for (const m of s.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('按鈕與輸入框的外觀、高度只能寫在 base.css；其他檔案的 .btn／.field 規則不能設 height、font-size、背景、邊框、顏色', () => {
  const bad = [];
  const FORBIDDEN = /(^|[;\s])(min-height|height|font-size|background(-color)?|border(-[a-z]+)?|color|box-shadow|border-radius)\s*:/;
  for (const f of files.filter((x) => x !== 'base.css')) {
    for (const m of read(f).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1];
      // 選擇器的「最後一段」是 .btn／.btn--xxx／.field／.amount__input（例如 .trade-row__act .btn）；.amount__input 是修整日數量步進器專用，B1 步驟重做才算在改按鈕本身
      const last = selector.split(',').map((x) => x.trim().split(/\s+/).pop().replace(/:[\w-]+(\([^)]*\))?/g, ''));
      if (!last.some((x) => /^(\.btn(--[a-z]+)?|\.field)+$/.test(x.replace(/^[a-z]*/, '')))) continue;
      // 引用 --ctl-*／--radius-ctl 變數的宣告是合法的（例如緊湊格子用 min-height: var(--ctl-h-sm)）
      const body = m[2].split(';').filter((d) => !/var\(--(ctl|radius-ctl)/.test(d)).join(';');
      if (FORBIDDEN.test(body)) bad.push(`${f}: ${selector.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('base.css 的按鈕高度只用 tokens.css 的變數（不寫死 px），手機放大也由 tokens.css 的媒體查詢處理', () => {
  const base = read('base.css');
  const bad = [...base.matchAll(/(min-height|height)\s*:\s*(\d+px)/g)].map((m) => m[0]);
  assert.deepEqual(bad, []);
  const tokens = read('tokens.css');
  assert.match(tokens, /--ctl-h:\s*36px/);
  assert.match(tokens, /--ctl-h-sm:\s*28px/);
  assert.match(tokens, /@media \(max-width: 759px\), \(pointer: coarse\)\s*\{\s*:root\s*\{[^}]*--ctl-h:\s*44px/);
});
