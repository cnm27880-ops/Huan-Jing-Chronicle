// ============================================================
// 角色存檔同步（階段 2）：本機 localStorage 仍是主要存檔，登入並連上房間後再同步到伺服器。
// - 每次存檔後 1.5 秒（防抖）把整份角色上傳；用版本號（樂觀鎖）避免手機與電腦互相悄悄覆蓋。
// - 連不上就先存本機，標記「待上傳」，下次連上房間時處理。
// - 遇到兩邊都有不同的存檔：問玩家要用哪一份，不會自己決定。
// - 全新裝置、伺服器也沒有存檔時，本機只是示範角色（不是這位玩家的）：不上傳，標記「等待中」，
//   等 GM 匯入後自動採用（以前會把示範角色傳上去，變成每位玩家都顯示 GM 的角色）。
// 伺服器端規則見 worker/src/room-core.js 的「角色存檔」。
// ============================================================
import * as defaultRoom from './rollLog.js';

const { roomRequest } = defaultRoom;

const META_KEY = 'huanjing:character:sync:v1';
const DEBOUNCE_MS = 1500;

function readMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    if (m && Number.isInteger(m.version)) return { uid: m.uid ?? null, version: m.version, dirty: Boolean(m.dirty), waiting: Boolean(m.waiting) };
  } catch { /* 讀不到就當作沒同步過 */ }
  return { uid: null, version: 0, dirty: false, waiting: false };
}
function writeMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* 忽略 */ }
}

const when = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '不明');

/**
 * getState()：目前的角色；adopt(data)：把伺服器的角色套用到畫面與本機；
 * hasLocalSave()：這台裝置有沒有存過角色；confirmFn(文字)：要玩家選擇時用；notify(文字)：提示訊息。
 * room：房間介面（預設就是 rollLog.js；測試時換成另一份模組實例）。
 */
export function createCharSync({ getState, adopt, hasLocalSave, confirmFn = (t) => window.confirm(t), notify = () => {}, room = defaultRoom }) {
  const { roomRequest: request, getRoomStatus, subscribeRoom } = room;
  let timer = null;
  const waitSubs = new Set();
  let lastWaiting = readMeta().waiting;
  const notifyWaiting = () => { const w = readMeta().waiting; if (w === lastWaiting) return; lastWaiting = w; waitSubs.forEach((fn) => fn(w)); };
  let gen = 0; // 每次修改 +1，用來判斷上傳期間又有新修改
  let chain = Promise.resolve();

  const online = () => getRoomStatus().phase === 'online';
  let wasOnline = online();
  const myUid = () => getRoomStatus().me?.uid ?? null;
  // 一次只做一件事；失敗只提示，不讓後面的同步卡死
  const run = (fn) => { chain = chain.then(fn).catch(() => notify('角色存檔同步失敗，會在下次連線時再試。')); return chain; };

  async function push(base) {
    const sent = gen;
    const res = await request({ t: 'charPut', base, data: getState() });
    if (res.ok) {
      writeMeta({ uid: myUid(), version: res.version, dirty: gen !== sent });
      if (gen !== sent) schedule();
      return;
    }
    await resolveConflict(); // 伺服器上有別的版本
  }

  /** 伺服器與這台裝置各有一份：問玩家用哪一份 */
  async function resolveConflict() {
    const res = await request({ t: 'charGet' });
    if (res.data === null) return push(0);
    const useServer = confirmFn(
      `伺服器上已有你的角色存檔（第 ${res.version} 版，${when(res.updatedAt)} 更新）。\n\n`
      + '按「確定」：使用伺服器的存檔（這台裝置目前的存檔會被取代）。\n'
      + '按「取消」：用這台裝置的存檔覆蓋伺服器。');
    if (useServer) {
      adopt(res.data);
      writeMeta({ uid: myUid(), version: res.version, dirty: false });
      notify('已使用伺服器的角色存檔。');
    } else {
      await push(res.version);
      notify('已用這台裝置的存檔覆蓋伺服器。');
    }
  }

  /** 連上房間時：比對伺服器與本機 */
  async function reconcile() {
    if (!online()) return;
    let meta = readMeta();
    if (meta.uid !== null && meta.uid !== myUid()) meta = { uid: myUid(), version: 0, dirty: true, waiting: meta.waiting }; // 這台裝置的存檔同步給另一個帳號
    const res = await request({ t: 'charGet' });
    if (res.data === null) {
      if (meta.waiting || !hasLocalSave()) { // 本機只有示範角色：不上傳，等 GM 匯入
        if (!meta.waiting) notify('伺服器還沒有你的角色，請 GM 匯入；匯入後會自動套用。這台裝置的示範角色不會上傳。');
        writeMeta({ uid: myUid(), version: 0, dirty: false, waiting: true });
        notifyWaiting();
        return;
      }
      await push(0); // 伺服器還沒有：把本機的上傳
      return;
    }
    if (meta.waiting) { // 之前在等 GM 匯入：現在有了，直接用（本機的只是示範角色）
      adopt(res.data);
      writeMeta({ uid: myUid(), version: res.version, dirty: false, waiting: false });
      notifyWaiting();
      return;
    }
    if (res.version === meta.version) { // 同一版：有待上傳的修改就上傳
      if (meta.dirty) await push(res.version); else writeMeta({ ...meta, uid: myUid() });
      return;
    }
    if (!meta.dirty && (meta.version > 0 || !hasLocalSave())) { // 本機沒有未上傳的修改（或這是全新裝置）：直接用伺服器的
      adopt(res.data);
      writeMeta({ uid: myUid(), version: res.version, dirty: false });
      return;
    }
    await resolveConflict();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => run(async () => {
      if (!online()) return;
      const meta = readMeta();
      if (!meta.dirty || meta.waiting) return;
      await push(meta.version);
    }), DEBOUNCE_MS);
  }

  subscribeRoom(() => {
    const now = online();
    if (now && !wasOnline) run(reconcile);
    wasOnline = now;
  });
  // 等 GM 匯入的玩家：GM 一匯入，紀錄裡會出現指向自己的異動事件 → 立刻重新比對並採用，不用重新整理
  room.subscribe?.((ev) => { if (ev?.kind === 'audit' && ev.target && ev.target === myUid() && readMeta().waiting && online()) run(reconcile); });
  if (wasOnline) run(reconcile); // 建立時已經在房間裡（通常是測試或重新建立）
  document.addEventListener('visibilitychange', () => { // 切到背景前盡快上傳，避免關掉分頁漏存
    if (document.visibilityState === 'hidden' && online() && readMeta().dirty && !readMeta().waiting) { clearTimeout(timer); run(() => push(readMeta().version)); }
  });

  return {
    /** 這台裝置正在等 GM 匯入角色（伺服器沒有存檔、本機只有示範角色） */
    isWaiting: () => readMeta().waiting,
    /** 等待狀態改變時呼叫 fn(是否等待中)；回傳取消訂閱的函式 */
    onWaitingChange(fn) { waitSubs.add(fn); return () => waitSubs.delete(fn); },
    /** 角色有修改（每次存檔後呼叫） */
    markDirty() {
      if (readMeta().waiting) return; // 等 GM 匯入期間，示範角色的修改不上傳
      gen++;
      writeMeta({ ...readMeta(), dirty: true });
      if (online()) schedule();
    },
  };
}

// ---------- GM 專用（階段 D 模擬戰會用）----------
/** GM：已存檔的玩家清單 [{ uid, name, charName, version, updatedAt }] */
export async function listCharacters() {
  return (await roomRequest({ t: 'charList' })).list;
}
/** GM：讀某位玩家的角色（回傳 { version, updatedAt, data }） */
export async function fetchCharacter(uid) {
  const { version, updatedAt, data } = await roomRequest({ t: 'charGet', uid });
  return { version, updatedAt, data };
}
