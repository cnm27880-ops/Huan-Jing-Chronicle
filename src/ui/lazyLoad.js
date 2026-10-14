// ============================================================
// 動態載入（import()）的共用工具：GM 工具面板與各分頁 view 都是「用到才下載」。
// 會遇到的失敗只有兩種：
//   1. 離線，而且這個檔案還沒下載過 → 提示「目前離線」，連上網路後請玩家自己重新整理
//      （瀏覽器可能記住載入失敗，同一個網址不會重試，所以只能重新整理；離線時不自動重新整理，免得變成瀏覽器的錯誤頁）
//   2. 網站剛部署新版，舊頁面要的檔案（檔名有雜湊）已經不在了 → 自動重新整理一次載入新版
//      （角色存檔每次操作都已經寫進本機，重新整理不會掉資料；30 秒內不重複，免得卡成無限重新整理）
// 判斷邏輯是純函式（chunkErrorText、shouldAutoReload），可以直接測試。
// ============================================================

const RELOAD_KEY = 'huanjing:chunk-reload';
export const RELOAD_COOLDOWN_MS = 30_000;

/** 載入失敗時顯示給玩家的說明（online：navigator.onLine） */
export function chunkErrorText(online = true) {
  return online
    ? '載入失敗，請稍後再試；如果一直失敗，請重新整理頁面。'
    : '目前離線，這個功能還沒下載過。連上網路後請重新整理頁面。';
}

/** 偵測到檔案載不到時，要不要自動重新整理：要有網路，而且 30 秒內沒有自動重新整理過 */
export function shouldAutoReload({ now, last = 0, online = true }) {
  return Boolean(online) && now - last > RELOAD_COOLDOWN_MS;
}

/** 載入一個模組：importer 要寫成 () => import('./x.js')（路徑要寫死，Vite 才能分檔）。失敗丟錯誤 */
export async function loadModule(importer) {
  const mod = await importer();
  if (!mod) throw new Error('chunk-load-failed'); // vite:preloadError 被 preventDefault 後，import() 會得到 undefined
  return mod;
}

/** 網站啟動時呼叫一次：監聽 Vite 的 vite:preloadError（動態載入的檔案載不到）。notify(文字)：提示訊息 */
export function installChunkErrorHandler(notify) {
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault(); // 不要讓錯誤直接炸掉；呼叫端會拿到失敗並顯示說明
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* 讀不到就當作沒重新整理過 */ }
    const online = navigator.onLine !== false;
    if (!shouldAutoReload({ now: Date.now(), last, online })) return;
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* 忽略 */ }
    notify('網站剛更新過，正在重新載入新版…');
    setTimeout(() => location.reload(), 900);
  });
}
