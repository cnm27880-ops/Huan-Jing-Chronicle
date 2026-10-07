// ============================================================
// 擲骰紀錄：所有「大家都該看到」的結果（檢定、自訂骰、鑑定、出招、喝藥水）都從這裡發布。
// 目前只存在這台裝置；之後接上 Cloudflare 時，只改這個檔案：
//   publish() 改成送到伺服器、subscribe() 改成收 WebSocket 廣播，其他程式不用動。
//
// 事件格式（伺服器也用同一份）：
//   { id, t, who, kind, label, big, tone, lines }
//   kind：check 檢定｜dice 自訂骰｜identify 鑑定｜attack 出招｜defend 承受攻擊｜potion 藥水｜note 備註
//   big：醒目的大數字或短文字；tone：'ok' | 'fail' | 'crit' | 'warn' | undefined；lines：說明文字陣列
// ============================================================
const KEY = 'huanjing:rolllog:v1';
const MAX = 100;
const subs = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(raw)) return raw.slice(0, MAX);
  } catch {
    /* 讀不到就從空的開始 */
  }
  return [];
}
let log = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* 儲存失敗不中斷遊戲 */
  }
}

/** 發布一個事件，回傳完整事件（含 id 與時間） */
export function publish(ev) {
  const e = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    t: Date.now(),
    lines: [],
    ...ev,
  };
  log.unshift(e);
  if (log.length > MAX) log.length = MAX;
  persist();
  subs.forEach((fn) => fn(e));
  return e;
}

export const getLog = () => log;

/** 有新事件時呼叫 fn(event)；回傳取消訂閱的函式 */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function clearLog() {
  log = [];
  persist();
  subs.forEach((fn) => fn(null));
}
