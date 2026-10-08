// ============================================================
// 「等 GM 匯入角色」畫面：登入後伺服器沒有你的角色（本機也只有示範角色）時，
// 取代修整日／背包／跑團等頁面，免得新玩家看到並玩到別人的示範角色。地圖頁不受影響。
// 也可以自己建立空白角色（技能與數值都是 0，之後由 GM 匯入或補數值）。
// 顯示與否由 main.js 決定；文字走 textContent。
// ============================================================
import { h } from './dom.js';

export const NEW_NAME_MAX = 40;

/** onCreate(名稱)：玩家按「建立空白角色」時呼叫（名稱已去掉前後空白、長度檢查過） */
export function mountWaitNotice(root, { onCreate }) {
  const input = h('input', { class: 'field', type: 'text', maxlength: String(NEW_NAME_MAX), placeholder: '角色名稱', 'aria-label': '角色名稱' });
  const msg = h('p', { class: 'wait-notice__msg', role: 'status' });
  const go = () => {
    const name = input.value.trim();
    if (!name) { msg.textContent = '先輸入角色名稱。'; return; }
    if (name.length > NEW_NAME_MAX) { msg.textContent = `名稱最多 ${NEW_NAME_MAX} 字。`; return; }
    if (!confirm(`建立空白角色「${name}」？\n技能與數值都是 0，之後再請 GM 匯入或補上。`)) return;
    onCreate(name);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  root.replaceChildren(
    h('section', { class: 'card wait-notice' },
      h('h2', { class: 'section-title', text: '還沒有你的角色' }),
      h('p', { class: 'wait-notice__text', text: '如果你有舊的機器人存檔或角色卡，請 GM 幫你匯入，匯入完成後這個畫面會自動換成你的角色，不用重新整理。' }),
      h('p', { class: 'wait-notice__text', text: '如果你是新玩家，可以自己建立一張空白角色：' }),
      h('div', { class: 'wait-notice__form' }, input, h('button', { type: 'button', class: 'btn btn--primary', onclick: go }, '建立空白角色')),
      msg,
      h('p', { class: 'wait-notice__sub', text: '在這之前可以先逛世界地圖。' })));
}
