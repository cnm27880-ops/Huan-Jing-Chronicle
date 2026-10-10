// ============================================================
// 信箱：收到伺服器的信（別人送的東西或餵的藥）→ 領取（只有第一個分頁拿得到）→ 套用到自己的角色 → 存檔 → 跳通知。
// 對方不用同意。不在線時寄來的，上線（hello）才會送到。
// ============================================================
import { setMailListener, claimMail, sendMail } from './rollLog.js';
import { applyMail } from '../game/mail.js';
import { logActivity } from './activityLog.js';
import { showMailNotice } from '../ui/mailNotice.js';
import { toast } from '../ui/controls.js';

export function createMailbox({ getState, commit }) {
  const busy = new Set(); // 正在領的信（重新連線時伺服器會再送一次沒領完的）

  async function handle(mail) {
    if (!mail?.id || busy.has(mail.id)) return;
    busy.add(mail.id);
    try {
      const { mail: got } = await claimMail(mail.id);
      if (!got) return; // 已經被別的分頁領走
      const result = applyMail(getState(), got);
      logActivity(getState(), { cat: 'item', text: result.title, lines: result.lines ?? [] });
      commit();
      showMailNotice(result);
      if (result.bounce) { // 不能收（例如毒性已滿）：退回給寄件人
        try { await sendMail({ to: result.bounce.to, kind: 'gift', items: result.bounce.items, bounced: true }); } catch { /* 對方信箱滿了就算了 */ }
      }
    } catch { /* 連線中斷：下次連上，伺服器會再送沒領的信 */ } finally { busy.delete(mail.id); }
  }

  setMailListener((list) => { list.forEach(handle); });
  return { notify: toast };
}
