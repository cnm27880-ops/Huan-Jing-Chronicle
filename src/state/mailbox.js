// ============================================================
// 信箱：收到伺服器的信（別人送的東西或餵的藥）→ 領取（只有第一個分頁拿得到）→ 套用到自己的角色 → 存檔 → 跳通知。
// 對方不用同意。不在線時寄來的，上線（hello）才會送到。
// ============================================================
import * as defaultRoom from './rollLog.js';
import { applyMail } from '../game/mail.js';
import { logActivity } from './activityLog.js';
import { showMailNotice } from '../ui/mailNotice.js';
import { toast } from '../ui/controls.js';

/**
 * ready()：回傳 Promise，等它完成才領信（main.js 傳 sync.idle：連上房間時角色存檔還在跟伺服器比對，
 * 這時候把信套用到角色，接著比對採用伺服器版，領到的東西就會被蓋掉——而信在伺服器端領了就刪掉，等於永遠消失）。
 * room：房間介面（預設是 rollLog.js；測試時換成假的）。
 */
export function createMailbox({ getState, commit, ready = () => Promise.resolve(), room = defaultRoom }) {
  const { setMailListener, claimMail, sendMail, notifyTradeChange } = room;
  const busy = new Set(); // 正在領的信（重新連線時伺服器會再送一次沒領完的）
  const seenTrades = new Set(); // 已經通知過的交易單（重新連線時伺服器會再送一次還沒回覆的）

  async function handle(mail) {
    if (!mail?.id || busy.has(mail.id)) return;
    if (mail.kind === 'trade') { // 交易單不能領走：要在交易頁按接受或拒絕，這裡只跳通知、叫交易頁更新
      if (!seenTrades.has(mail.id)) {
        seenTrades.add(mail.id);
        showMailNotice({ title: `${mail.fromName || '某位玩家'} 向你提出交易`, lines: ['到背包頁的「🎁 贈送／交易」→「📥 待回覆」回覆（接受或拒絕）'] });
      }
      notifyTradeChange();
      return;
    }
    busy.add(mail.id);
    try {
      await ready(); // 角色比對完成才領；領了就立刻套用到「比對後」的角色
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
