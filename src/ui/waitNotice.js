// ============================================================
// 「等 GM 匯入角色」畫面：登入後伺服器沒有你的角色（本機也只有示範角色）時，
// 取代修整日／背包／跑團等頁面，免得新玩家看到並玩到別人的示範角色。地圖頁不受影響。
// 顯示與否由 main.js 決定；文字走 textContent。
// ============================================================
import { h } from './dom.js';

export function mountWaitNotice(root) {
  root.replaceChildren(
    h('section', { class: 'card wait-notice' },
      h('h2', { class: 'section-title', text: '等待 GM 匯入你的角色' }),
      h('p', { class: 'wait-notice__text', text: '你的角色還沒有建立。請 GM 幫你匯入機器人存檔或角色卡，匯入完成後這個畫面會自動換成你的角色，不用重新整理。' }),
      h('p', { class: 'wait-notice__sub', text: '在這之前可以先逛世界地圖。' })));
}
