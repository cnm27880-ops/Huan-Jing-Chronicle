// ============================================================
// 收到東西的通知面板：右下角浮動，不擋操作、不要求同意（東西已經收進背包）。
// 離線時寄來的，上線後會一起跳出來。文字一律走 textContent。
// ============================================================
import { h } from './dom.js';

let box = null;
let list = null;
const entries = [];

function draw() {
  if (!box) {
    list = h('ul', { class: 'mailbox__list' });
    box = h('aside', { class: 'mailbox', role: 'status', 'aria-live': 'polite', 'aria-label': '收到的東西' },
      h('header', { class: 'mailbox__head' },
        h('strong', { text: '📬 收到的東西' }),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { entries.length = 0; draw(); } }, '知道了')),
      list);
    document.body.append(box);
  }
  box.hidden = entries.length === 0;
  list.replaceChildren(...entries.map((e) => h('li', { class: 'mailbox__item' },
    h('strong', { text: e.title }),
    ...e.lines.map((l) => h('span', { class: 'mailbox__line', text: l })))));
}

/** 跳出一則通知：{ title, lines[] }（新的在最上面） */
export function showMailNotice(entry) {
  entries.unshift({ title: entry.title, lines: entry.lines ?? [] });
  if (entries.length > 20) entries.length = 20;
  draw();
}
